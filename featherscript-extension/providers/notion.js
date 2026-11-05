// SPDX-License-Identifier: GPL-3.0-or-later
// providers/notion.js - the Notion AI provider (app.notion.com / notion.so, /ai
// and /chat). Exports the same ZSProvider interface as providers/qwen.js; the
// core (core/main.js) is provider-agnostic. To DISABLE Notion support, remove
// this file from manifest.json (and its URLs from background.js PROVIDER_URLS +
// main.js AI_SITES).
//
// Notion's class names are hashed and change between bundles, so every lookup
// here is tag/class-agnostic with layered fallbacks. Invariants used:
//  - ONLY /ai and /chat are AI surfaces. A normal /p/... document is also
//    contenteditable, but Enter there creates a page block; selecting that as
//    the composer would type the whole system prompt into the user's page. The
//    route guard is therefore strict: a false negative is a clear error, a false
//    positive writes into a document.
//  - Transcript rows carry data-agent-service-scroll-anchor. User rows align
//    flex-end, assistant rows flex-start, centered rows are status/progress.
//    Newer builds also render replies as Notion block editor roots
//    ([data-content-editable-root='true'] with [data-block-id]); those are read
//    with a block-aware walker, because Notion renders each line as its own block
//    and plain textContent would glue "p.Parent = workspace" to "print(...)".
//  - Notion DOM-locks the reply editor, so a chip inserted inside a response can
//    be reverted. Chips are anchored on the row wrapper OUTSIDE the editable root
//    (see chipAnchor); the core re-asserts them.
//  - Notion's own tools (page/database/web search) act on Notion's cloud and can
//    never reach Roblox Studio - promptExtra says so, because a Notion tool call
//    aimed at Roblox always fails and wastes the turn.
// eslint-disable-next-line no-unused-vars
const ZSProvider = (() => {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let diag = () => {};

  const AI_LANDING_RE = /^\/ai\/?$/;
  const AI_CHAT_PATH_RE = /^\/chat(?:\/|$)/;
  const isChatPath = () => AI_CHAT_PATH_RE.test(location.pathname || "");
  const paramThreadId = () => {
    try {
      for (const [k, v] of new URLSearchParams(location.search || "")) {
        if (/^(?:t|thread|threadid|thread_id|chat|chatid|chat_id)$/i.test(k) && v) return v;
      }
    } catch {}
    return "";
  };
  const threadId = () => {
    const path = location.pathname || "";
    const m = path.match(/^\/chat\/([^/]+)/);
    return m ? m[1] : isChatPath() ? paramThreadId() : "";
  };
  const isAiSurface = () => AI_LANDING_RE.test(location.pathname || "") || isChatPath();
  const routeKey = () => `${location.pathname || ""}${location.search || ""}`;

  // ── Safe DOM reads (a framework remount can throw mid-read) ────────────────
  const safeRead = (read, fallback) => { try { return read(); } catch { return fallback; } };
  const safeQueryAll = (root, sel) => safeRead(() => [...root.querySelectorAll(sel)], []);
  const safeQuery = (root, sel) => safeRead(() => root.querySelector(sel), null);
  const safeClosest = (node, sel) => safeRead(() => node.closest(sel), null);
  const _txt = (el) => safeRead(() => el.textContent, "") || "";
  function visible(el) {
    if (!el || !safeRead(() => el.isConnected, false) || safeRead(() => el.hidden, true)) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width >= 80 && r.height >= 12 && r.bottom > 0 && r.top < innerHeight + 120) return true;
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
    } catch { return false; }
  }
  const ariaOf = (el) => safeRead(() => el.getAttribute("aria-label"), "") || "";
  const CONTROL_SEL = "button, [role='button']";
  const controlDisabled = (el) =>
    !el || safeRead(() => el.disabled, true) === true || safeRead(() => el.getAttribute("aria-disabled"), "") === "true";

  // ── Composer discovery ────────────────────────────────────────────────────
  // Placeholder wording Notion's full-page AI composer has used; kept as
  // alternatives because Notion A/B-tests the copy.
  const COMPOSER_TEXT_RE = /(do anything with|anything with ai|ask notion ai|ask notion|ask ai|ask anything|ask,? search|ask (?:the )?agent|ask a question|what would you like|plan,? search|search,? ask|message.*(?:ai|notion)|type (?:a|your) message|start typing|your message)/i;
  const COMPOSER_PLACEHOLDER_RE = /how can i help|frag(?:e)? (?:die )?ki|comment puis-je|comment (?:puis|peux).*aider|c[óo]mo puedo ayudar|como posso ajudar/i;
  const EDITOR_SEL =
    "textarea, input[type='text'], [contenteditable], .ProseMirror, .tiptap, [role='textbox']";
  const isTextControl = (el) => /^(INPUT|TEXTAREA)$/.test(safeRead(() => el.tagName, ""));
  const EDITABLE_SEL = "textarea, input[type='text'], [contenteditable], [role='textbox']";

  let _editor = null, _editorAt = 0, _strictMissSince = 0, _route = "";
  function resetForRoute() {
    const k = routeKey();
    if (k === _route) return;
    _route = k;
    _editor = null; _editorAt = 0; _strictMissSince = 0;
  }
  const editableNear = (el) => {
    if (!el) return null;
    if (safeRead(() => el.matches(EDITABLE_SEL), false)) return el;
    const direct = safeClosest(el, EDITABLE_SEL);
    if (direct) return direct;
    // The visible placeholder can be an overlay sibling rather than an
    // attribute on the editor: walk a few local wrappers and look inside each.
    let n = safeRead(() => el.parentElement, null);
    for (let i = 0; n && i < 6; n = safeRead(() => n.parentElement, null), i++) {
      const own = safeRead(() => n.matches(EDITABLE_SEL), false) ? n : safeQuery(n, EDITABLE_SEL);
      if (own && safeRead(() => own.isConnected, false)) return own;
    }
    return null;
  };
  function placeholderEditor() {
    if (!isAiSurface()) return null;
    for (const n of safeQueryAll(document, "[data-placeholder], [aria-placeholder], [placeholder], [aria-label]")) {
      if (safeClosest(n, "#zs-root")) continue;
      const hint = (
        (safeRead(() => n.getAttribute("data-placeholder"), "") || "") + " " +
        (safeRead(() => n.getAttribute("aria-placeholder"), "") || "") + " " +
        (safeRead(() => n.getAttribute("placeholder"), "") || "") + " " +
        (safeRead(() => n.getAttribute("aria-label"), "") || "")
      ).slice(0, 200);
      if (!COMPOSER_TEXT_RE.test(hint) && !COMPOSER_PLACEHOLDER_RE.test(hint)) continue;
      const ed = editableNear(n);
      if (ed && visible(ed)) return ed;
    }
    return null;
  }
  const SEND_RE = /send|submit|senden|abschicken|envoyer|enviar/i;
  const STOP_RE = /(?:^|\b)(?:stop|cancel|interrupt|arr[êe]ter|stoppen|anhalten|abbrechen)(?:\b|$)/i;
  function controlsNear(el, depth) {
    const out = [];
    let n = safeRead(() => el.parentElement, null);
    for (let i = 0; n && n !== document.body && i < depth; n = safeRead(() => n.parentElement, null), i++) {
      out.push(...safeQueryAll(n, CONTROL_SEL).filter((b) => !safeClosest(b, "#zs-root")));
    }
    return out;
  }
  function editorScore(el, attrHint) {
    let s = 0;
    const tag = safeRead(() => el.tagName, "");
    if (tag === "TEXTAREA") s += 8;
    else if (tag === "INPUT") s += 4;
    if (safeRead(() => el.isContentEditable, false)) s += 2;
    if (safeRead(() => el.matches("[role='textbox'], .ProseMirror, .tiptap"), false)) s += 3;
    const ph = (
      (safeRead(() => el.getAttribute("placeholder"), "") || "") + " " +
      (safeRead(() => el.getAttribute("data-placeholder"), "") || "") + " " +
      (safeRead(() => el.getAttribute("aria-placeholder"), "") || "") + " " +
      (safeRead(() => el.getAttribute("aria-label"), "") || "")
    ).slice(0, 240);
    if (COMPOSER_TEXT_RE.test(ph) || COMPOSER_PLACEHOLDER_RE.test(ph) || attrHint) s += 9;
    // Notion's own send control within a few wrappers is definitive: the editor
    // is the AI composer even when the placeholder copy changes again.
    const controls = controlsNear(el, 6);
    if (controls.some((b) => sendControlLike(b) || stopControlLike(b))) s += 5;
    // content-editable-leaf is used for BOTH page blocks and the AI composer; a
    // page block has no composer evidence around it, so penalise only that case.
    if (/content-editable-leaf/i.test(String(safeRead(() => el.className, "") || "")) && s < 9) s -= 12;
    return s;
  }
  // Strict ranking can keep missing after a Notion redesign; only then fall back
  // to the lowest visible chat-shaped editable in the bottom half of the page.
  function relaxedEditor() {
    const now = Date.now();
    if (!_strictMissSince) { _strictMissSince = now; return null; }
    if (now - _strictMissSince < 2500) return null;
    const vh = Math.max(200, innerHeight || 0);
    let best = null, bestScore = -Infinity;
    for (const el of safeQueryAll(document, EDITOR_SEL)) {
      if (!visible(el) || safeRead(() => el.disabled, false) === true) continue;
      if (!isTextControl(el) && safeRead(() => el.getAttribute("contenteditable"), "") === "false") continue;
      const r = safeRead(() => el.getBoundingClientRect(), null);
      if (!r || r.width < 200 || r.top < vh * 0.4) continue;
      let sc = r.bottom;
      if (safeRead(() => el.tagName, "") === "TEXTAREA") sc += 400;
      if (controlsNear(el, 6).some((b) => sendControlLike(b) || stopControlLike(b))) sc += 600;
      if (sc > bestScore) { bestScore = sc; best = el; }
    }
    if (best) diag("notion.editor.relaxed", { tag: safeRead(() => best.tagName, ""), path: location.pathname });
    return best;
  }
  function getEditor() {
    resetForRoute();
    // Never inspect a normal Notion page editor (see the route note above).
    if (!isAiSurface()) return null;
    if (_editor && visible(_editor) && safeRead(() => _editor.isConnected, false)) return _editor;
    _editor = null;
    const now = Date.now();
    if (_editorAt && now - _editorAt < 1200) return null; // negative result cached briefly
    const direct = placeholderEditor();
    if (direct) {
      _editor = direct; _editorAt = now; _strictMissSince = 0;
      diag("notion.editor.found", { how: "placeholder", tag: safeRead(() => direct.tagName, "") });
      return direct;
    }
    const cands = safeQueryAll(document, EDITOR_SEL)
      .filter((el) => visible(el) && !safeClosest(el, "#zs-root"))
      .map((el) => ({ el, score: editorScore(el, false) }))
      .sort((a, b) => b.score - a.score);
    if (cands.length && cands[0].score >= 9) {
      _editor = cands[0].el; _editorAt = now; _strictMissSince = 0;
      diag("notion.editor.found", { how: "score", score: cands[0].score, tag: safeRead(() => cands[0].el.tagName, ""), path: location.pathname });
      return _editor;
    }
    const relaxed = relaxedEditor();
    if (relaxed) { _editor = relaxed; _editorAt = now; return relaxed; }
    _editorAt = now;
    return null;
  }
  const editorText = (el) => {
    const e = el || getEditor();
    if (!e) return "";
    if (isTextControl(e)) return safeRead(() => e.value, "") || "";
    return (safeRead(() => e.innerText, "") || safeRead(() => e.textContent, "") || "").replace(/\u00a0/g, " ");
  };

  // ── Send / stop controls ──────────────────────────────────────────────────
  const sendControlLike = (b) => !!b &&
    (/^(?:agent-send-message-button|agent-chat-send-button)$/.test(safeRead(() => b.getAttribute("data-testid"), "") || "") ||
      SEND_RE.test(ariaOf(b)) ||
      SEND_RE.test(safeRead(() => b.getAttribute("data-testid"), "") || "") ||
      SEND_RE.test(safeRead(() => b.title, "") || ""));
  const stopControlLike = (b) => {
    if (!b) return false;
    const testId = safeRead(() => b.getAttribute("data-testid"), "") || "";
    const text = _txt(b).trim();
    return /agent-(?:stop|interrupt)/i.test(testId) ||
      STOP_RE.test(ariaOf(b)) || STOP_RE.test(testId) || STOP_RE.test(safeRead(() => b.title, "") || "") ||
      (STOP_RE.test(text) && text.length <= 40);
  };
  function composerFrame() {
    if (!isAiSurface()) return null;
    const ed = getEditor();
    if (!ed) return null;
    let n = safeRead(() => ed.parentElement, null);
    for (let i = 0; n && n !== document.body && i < 7; n = safeRead(() => n.parentElement, null), i++) {
      const ctrls = safeQueryAll(n, CONTROL_SEL);
      if (ctrls.some((b) => sendControlLike(b) || stopControlLike(b) || safeRead(() => b.type, "") === "submit")) return n;
    }
    return safeRead(() => ed.parentElement, null);
  }
  function sendButton() {
    const frame = composerFrame();
    if (!frame) return null;
    const controls = safeQueryAll(frame, CONTROL_SEL);
    const exact = controls.filter((b) =>
      /^(?:agent-send-message-button|agent-chat-send-button)$/.test(safeRead(() => b.getAttribute("data-testid"), "") || ""));
    const pool = exact.length ? exact : controls.filter(sendControlLike);
    return pool.find((b) => !controlDisabled(b) && visible(b)) || null;
  }
  function stopButton() {
    const frame = composerFrame();
    if (!frame) return null;
    return safeQueryAll(frame, CONTROL_SEL).find((b) => stopControlLike(b) && !controlDisabled(b) && visible(b)) || null;
  }

  // ── Transcript rows ───────────────────────────────────────────────────────
  const AGENT_ROW_SEL = "[data-agent-service-scroll-anchor]";
  const BLOCK_ROOT_SEL = "[data-content-editable-root='true']";
  const AI_MARK_RE = /\b(GPT|ChatGPT|Claude|Opus|Sonnet|Haiku|Gemini|Notion AI)\b/i;
  const AI_AFFORD_RE = /copy|regenerate|retry|like|dislike|thumbs/i;
  const rowAlign = (row) => {
    const inline = safeRead(() => row.style && row.style.justifyContent, "");
    if (inline) return inline;
    return safeRead(() => getComputedStyle(row).justifyContent, "");
  };
  // Notion can keep the thread the user just left mounted behind the new chat
  // (display:none). Those turns are not this conversation's content - counting
  // them made a blank New chat look non-empty and still showing "Agent active".
  // offsetParent is null for a display:none row or any display:none ancestor,
  // and unlike visible() it does NOT care about scroll position, so real turns
  // scrolled out of view still count.
  function laidOut(el) {
    try {
      if (!el || !el.isConnected) return false;
      if (el.offsetParent !== null) return true;
      return getComputedStyle(el).position === "fixed" &&
        el.getClientRects().length > 0;
    } catch { return true; }
  }
  function topAgentRows() {
    if (!isAiSurface()) return [];
    return safeQueryAll(document, AGENT_ROW_SEL).filter((r) =>
      laidOut(r) &&
      !safeClosest(r, "#zs-root") &&
      !(safeRead(() => r.parentElement, null) && safeClosest(r.parentElement, AGENT_ROW_SEL)));
  }
  const _userItems = new WeakSet();
  function hasEndAlignedAncestor(el) {
    for (let n = el, i = 0; n && n !== document.body && i < 6; n = safeRead(() => n.parentElement, null), i++) {
      const jc = safeRead(() => n.style && n.style.justifyContent, "") || safeRead(() => getComputedStyle(n).justifyContent, "");
      const fd = safeRead(() => n.style && n.style.flexDirection, "") || safeRead(() => getComputedStyle(n).flexDirection, "");
      // A column flex-end container merely pins the transcript to the bottom;
      // only horizontal end alignment identifies a user bubble.
      if ((jc === "flex-end" || jc === "end") && !/^column/.test(fd)) return true;
    }
    return false;
  }
  function blockRoots() {
    // Page blocks only appear in an AI THREAD (/chat...). On the /ai landing
    // page the same shape is used by suggestion cards, which must never count
    // as turns (they would make a fresh chat look non-empty).
    if (!isChatPath()) return [];
    const ed = getEditor();
    return safeQueryAll(document, BLOCK_ROOT_SEL).filter((r) => {
      if (!safeRead(() => r.isConnected, false) || !laidOut(r) || safeClosest(r, "#zs-root")) return false;
      if (ed && (r === ed || safeRead(() => r.contains(ed), false) || safeRead(() => ed.contains(r), false))) return false;
      if (safeRead(() => r.parentElement, null) && safeClosest(r.parentElement, BLOCK_ROOT_SEL)) return false;
      if (!safeQuery(r, "[data-block-id]")) return false;
      const t = _txt(r);
      if (!/\S/.test(t) && !safeQuery(r, "img, video, pre, code")) return false;
      if (hasEndAlignedAncestor(r)) _userItems.add(r); else _userItems.delete(r);
      return true;
    });
  }
  let _itemsCache = { at: 0, list: null };
  const invalidateItems = () => { _itemsCache = { at: 0, list: null }; };
  function collectItems() {
    const now = Date.now();
    if (_itemsCache.list && now - _itemsCache.at < 150) return _itemsCache.list;
    const out = [];
    for (const row of topAgentRows()) {
      const align = rowAlign(row);
      if (align === "flex-end") { out.push(row); continue; }
      if (align !== "flex-start") continue; // centered status/progress row
      const key = (safeRead(() => row.getAttribute("data-agent-service-scroll-anchor"), "") || "").toLowerCase();
      if (/^(running-placeholder|interrupting|interrupt-sent):/.test(key)) continue;
      // An assistant row enters the DOM before its first token; omit that empty
      // shell until text arrives (generation state comes from the stop control).
      if (!_txt(row).trim() && !safeQuery(row, "pre, code, img")) continue;
      out.push(row);
    }
    // Newer Notion views mix anchored user rows with block-root assistant
    // replies. A global fallback lost the reply whenever ANY user row existed,
    // leaving startup waiting even though its acknowledgement was on screen.
    for(const block of blockRoots())if(!out.some(row=>row===block||safeRead(()=>row.contains(block)||block.contains(row),false)))out.push(block);
    out.sort((a, b) => (safeRead(() => a.compareDocumentPosition(b) & 2, false) ? 1 : -1));
    _itemsCache = { at: now, list: out };
    return out;
  }
  const allItems = collectItems;
  function isUserItem(item) {
    if (!item) return false;
    if (safeRead(() => item.matches(AGENT_ROW_SEL), false)) return rowAlign(item) === "flex-end";
    if (safeRead(() => item.matches(BLOCK_ROOT_SEL), false)) return _userItems.has(item) || hasEndAlignedAncestor(item);
    if (_userItems.has(item)) return true;
    const role = safeRead(() => item.getAttribute("data-message-role") || item.getAttribute("data-role"), "");
    if (role) return /user|human/i.test(role);
    const t = _txt(item).trim();
    if (!t) return false;
    if (safeQueryAll(item, "[aria-label]").some((b) => AI_AFFORD_RE.test(ariaOf(b)))) return false;
    if (AI_MARK_RE.test(t.slice(0, 160))) return false;
    return true;
  }
  const isAssistantItem = (item) => !!item && !isUserItem(item);

  // Notion renders every line of a reply as its own block element, so plain
  // textContent glues lines together ("p.Parent = workspaceprint"): a multi-line
  // ###LUA### block read that way is a Luau syntax error, and a JSON command
  // split over lines no longer parses. Add a newline at every block boundary.
  const BLOCK_TAG_RE = /^(?:P|DIV|LI|UL|OL|PRE|TR|H[1-6]|BLOCKQUOTE|SECTION|ARTICLE|TABLE|THEAD|TBODY|HR|DT|DD|FIGURE|FIGCAPTION|SUMMARY|DETAILS)$/;
  function blockAwareText(root) {
    let out = "";
    const walk = (n) => {
      if (n.nodeType === 3) { out += n.nodeValue || ""; return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEMPLATE") return;
      if (tag === "BR") { out += "\n"; return; }
      if (n.matches && n.matches(".zs-chip, .zs-hidden")) return;
      if (tag === "BUTTON" || (n.getAttribute && n.getAttribute("role") === "toolbar")) return;
      const block = BLOCK_TAG_RE.test(tag) || n.hasAttribute("data-block-id");
      if (block && out && !out.endsWith("\n")) out += "\n";
      for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
      if (block && out && !out.endsWith("\n")) out += "\n";
    };
    walk(root);
    return out.endsWith("\n") ? out.slice(0, -1) : out;
  }
  const itemText = (item) => (item ? blockAwareText(item) : "");
  const classifyText = (item) => (item ? blockAwareText(item) : "");

  const assistantItems = () => allItems().filter(isAssistantItem);
  const assistantCount = () => assistantItems().length;
  const userCount = () => allItems().filter(isUserItem).length;
  const lastAssistant = () => { const it = assistantItems(); return it.length ? it[it.length - 1] : null; };
  const _idMap = new WeakMap();
  let _idSeq = 0;
  function itemKey(item) {
    if (!item) return null;
    const stable = safeRead(() => item.getAttribute("data-agent-service-scroll-anchor"), "");
    if (stable) return stable;
    const blockId = safeRead(() => safeQuery(item, "[data-block-id]").getAttribute("data-block-id"), "");
    if (blockId) return `block:${blockId}`;
    let id = _idMap.get(item);
    if (!id) { id = ++_idSeq; _idMap.set(item, id); }
    return id;
  }
  const lastAssistantId = () => itemKey(lastAssistant());

  const chatIsEmpty = () => !isAiSurface() || allItems().length === 0;
  const isFreshChat = () => isAiSurface() && chatIsEmpty() && !!getEditor();

  // Overflow / context messages in Notion's own UI.
  function scanError() {
    for (const el of safeQueryAll(document, "[role='alert'], [class*='error'], [class*='toast']")) {
      if (!visible(el) || safeClosest(el, "#zs-root")) continue;
      const t = (_txt(el) || "").trim();
      if (t.length > 8 && t.length < 600 && /context|limit|too long|message is too long|token/i.test(t)) return t.slice(0, 240);
    }
    return null;
  }
  const isTooLongMsg = (text) => /context.{0,20}(limit|length)|message is too long|too many tokens/i.test(text);
  const isBusyMsg = (text) => /rate limit|too many requests|temporarily unavailable|overloaded|try again (later|in)/i.test(text);

  // ── Generation state ──────────────────────────────────────────────────────
  let _streamMax = -1, _streamAt = 0, _streamItem = null;
  function sampleStream() {
    const item = lastAssistant();
    const len = item ? blockAwareText(item).length : 0;
    const now = Date.now();
    if (item !== _streamItem || len < _streamMax - 400) {
      _streamItem = item; _streamMax = len; _streamAt = now; return;
    }
    if (len > _streamMax) { _streamMax = len; _streamAt = now; }
  }
  const grewWithin = (ms) => _streamMax > 1 && Date.now() - _streamAt < ms;
  function streamLen(item) {
    const it = item === undefined ? lastAssistant() : item;
    return it ? blockAwareText(it).length : 0;
  }
  function snapshot() {
    try {
      const it = lastAssistant();
      return { th: 0, rp: it ? _txt(it).length : 0 };
    } catch { return {}; }
  }

  let _stopSince = 0;
  function genActive() {
    sampleStream();
    const stop = !!stopButton();
    const now = Date.now();
    if (stop) {
      // Trust a continuously present stop control for a long planning turn.
      if (!_stopSince) _stopSince = now;
      return now - _stopSince < 300000;
    }
    _stopSince = 0;
    // A CLOSED command block that stopped growing 3s ago is a finished turn -
    // do not sit out the full 9s quiet window that plain prose needs.
    const idle = now - _streamAt;
    if (_streamMax > 1 && idle >= 3000 && idle < 9000) {
      try {
        const reply = classifyText(lastAssistant());
        if (!ZSParse.hasOpenToolBlock(reply) && ZSParse.parseToolCalls(reply).length > 0) return false;
      } catch {}
    }
    return grewWithin(9000);
  }
  const isGenerating = genActive;
  const isBusyNow = genActive;
  const isHardGenerating = () => !!stopButton();

  const turnHalted = () => false;
  const findContinueBtn = () =>
    safeQueryAll(document, CONTROL_SEL).find((b) => visible(b) && /^(continue|continue generating|keep going)$/i.test(_txt(b).trim())) || null;
  const clickContinueBtn = () => { const b = findContinueBtn(); if (!b) return false; try { b.click(); return true; } catch { return false; } };

  function readAssistant() {
    const item = lastAssistant();
    if (!item) return { present: false, reply: "", thinking: "", item: null };
    return { present: true, reply: blockAwareText(item).trim(), thinking: "", item };
  }

  async function waitFor(pred, timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (pred()) return true;
      await sleep(120);
    }
    return false;
  }

  // ── Sending ───────────────────────────────────────────────────────────────
  // Notion silently drops very large messages; the bridge's compact catalogue
  // keeps the bootstrap small, and a big tool result is trimmed head+tail here.
  const SEND_MAX = 60000;
  function truncateForSend(text) {
    if (!text || text.length <= SEND_MAX) return text;
    const omitted = text.length - SEND_MAX;
    const marker = `\n\n[…FeatherScript: result truncated to fit Notion's input budget - ${omitted} of ${text.length} characters omitted. Do NOT re-run the command; work with the head and tail shown here…]\n\n`;
    const budget = SEND_MAX - marker.length;
    const headLen = Math.floor(budget * 0.85);
    const tailLen = budget - headLen;
    return text.slice(0, headLen) + marker + text.slice(text.length - tailLen);
  }
  function setTextareaValue(el, v) {
    const proto = window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype;
    const setter = proto && Object.getOwnPropertyDescriptor(proto, "value");
    if (setter && setter.set) setter.set.call(el, v);
    else el.value = v;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function setRichText(el, value) {
    if (isTextControl(el)) { setTextareaValue(el, value); return; }
    el.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
    let ok = false;
    try { ok = document.execCommand("insertText", false, value); } catch {}
    if (ok) return;
    // Notion's block editor prefers a paste event; fall back to plain textContent
    // plus an input event so the framework still sees a change.
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", value);
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      if (editorText(el).trim() === value.trim()) return;
    } catch {}
    el.textContent = value;
    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  function pressEnter(editor) {
    for (const type of ["keydown", "keyup"]) {
      editor.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
  }

  // Commit at most once. A delayed acknowledgement must never trigger a second
  // click/Enter: that can submit identical tool results twice on slow Notion tabs.
  async function commitSend(editor, text, pre) {
    const tail = String(text || "").replace(/\s+/g, " ").trim().slice(-60);
    const stillTyped = () => {
      const t = editorText().replace(/\s+/g, " ").trim();
      if (!t) return false;
      return t.length >= tail.length ? t.includes(tail) : tail.includes(t);
    };
    const proof = () => (!stillTyped() ? "cleared" : isHardGenerating() ? "generating" : userCount() > pre.users ? "userRow" : "");
    // Check the actual composer BEFORE sending. An insertion failure previously
    // looked like a cleared composer and was incorrectly marked delivered.
    if (!stillTyped()) return { sent: false, attempted: false, how: "not-typed", proof: "" };
    let how = "", attempted = false;
    const button = sendButton();
    try {
      if (button && !controlDisabled(button)) {
        how = "click"; attempted = true; button.click();
      } else if (!isHardGenerating()) {
        const form = safeClosest(editor, "form");
        how = form && typeof form.requestSubmit === "function" ? "form" : "enter";
        attempted = true;
        if (how === "form") form.requestSubmit(); else pressEnter(editor);
      }
    } catch {
      // Even a throwing site handler may have accepted the event. Do not retry.
    }
    if (!attempted) return { sent: false, attempted: false, how: "unavailable", proof: "" };
    let p = "";
    await waitFor(() => !!(p = proof()), 3000);
    return { sent: !!p, attempted, how, proof: p };
  }

  let _attachedText = "";
  async function typeAndSend(text, images) {
    const editor = getEditor();
    if (!editor) throw new Error("Notion AI chat box not found - open a Notion AI chat at notion.so/chat");
    text = truncateForSend(text);
    // The core locks the composer for the WHOLE run (setInputLock) by flipping
    // contenteditable=false. Notion's block editor ignores every insertion into a
    // non-editable root: execCommand returns false, its paste handler does
    // nothing, the send control never enables - so the injected tool result was
    // never sent and the run hung on the old reply. Unlock for the injection
    // only, then put the lock back (same pattern as chatgpt/gemini/kimi).
    const relock = isTextControl(editor)
      ? safeRead(() => editor.hasAttribute("readonly"), false)
      : safeRead(() => editor.getAttribute("contenteditable") === "false", false);
    if (relock) {
      if (isTextControl(editor)) editor.removeAttribute("readonly");
      else editor.setAttribute("contenteditable", "true");
    }
    try {
      editor.focus();
      await sleep(40);
      setRichText(editor, text);
      await sleep(80);
      // submitAndGetBase retries this call; attach only once per message, or every
      // retry pastes another duplicate of the same screenshot.
      if (images && images.length && _attachedText !== text) {
        if (!(await attachImages(images))) throw Error('Notion AI photo upload failed. No message was sent.');
        _attachedText = text;
      }
      await waitFor(() => !!(sendButton() || stopButton()), 2500);
      const r = await commitSend(editor, text, { users: userCount() });
      if (r.sent) _attachedText = "";
      diag("notion.send", { len: text.length, sent: r.sent, attempted: r.attempted, how: r.how, proof: r.proof });
      return { sent: r.sent, attempted: r.attempted };
    } finally {
      // Re-lock the CURRENT editor: Notion can replace the composer node while
      // the message is sent, and the old node would be a no-op.
      if (relock) {
        const e2 = getEditor() || editor;
        if (isTextControl(e2)) e2.setAttribute("readonly", "");
        else e2.setAttribute("contenteditable", "false");
      }
    }
  }

  function stopGeneration() {
    const b = stopButton();
    if (b) { try { b.click(); } catch {} }
  }

  function setInputLock(on) {
    const ed = getEditor();
    if (!ed) return;
    if (isTextControl(ed)) {
      if (on) {
        // Keep the site's own placeholder so unlocking restores it (Arena/GLM/
        // DeepSeek/Qwen/Vani/MiMo all do the same); otherwise the composer stays
        // labelled "Agent working…" after the run ends.
        if (ed.dataset.zsPlaceholder == null) ed.dataset.zsPlaceholder = ed.getAttribute("placeholder") || "";
        ed.setAttribute("readonly", "");
        ed.setAttribute("placeholder", "⏳ Agent working… please wait");
      } else {
        ed.removeAttribute("readonly");
        if (ed.dataset.zsPlaceholder != null) ed.setAttribute("placeholder", ed.dataset.zsPlaceholder);
      }
      return;
    }
    ed.setAttribute("contenteditable", on ? "false" : "true");
  }

  const COMPOSER_WAIT_MS = 60000;
  function enforceComposer() { return { ready: !!getEditor() }; }
  async function ensureComposerReady(reason) {
    if (!isAiSurface()) {
      diag("notion.composer.wrongRoute", { reason, path: location.pathname });
      return { ready: false, error: "Notion AI chat is not open." };
    }
    let ed = getEditor();
    if (!ed) {
      const t0 = Date.now();
      // Edge cold starts can take far longer than Chrome to hydrate Notion's
      // editor after the page shell paints, so wait it out (unless stopped).
      while (!ed && Date.now() - t0 < COMPOSER_WAIT_MS && isAiSurface()) {
        await waitFor(() => !!getEditor() || !isAiSurface(), 1000);
        ed = getEditor();
      }
      diag("notion.composer.waited", { found: !!ed, ms: Date.now() - t0, reason, path: location.pathname });
    }
    return {
      ready: !!ed,
      error: ed ? "" : "Notion did not load its AI editor at " + (location.pathname || "/ai") + " after 60 seconds. Open a new AI chat in Notion, then retry; if that page itself fails to load, reload Notion. On Microsoft Edge, also turn off Efficiency mode / sleeping tabs for notion.so.",
    };
  }

  function modeWarning() {
    if (isAiSurface()) return "";
    return "<b>Notion</b> - open <b>notion.so/chat</b> (Notion AI) to use FeatherScript. This page: <code>" + (location.pathname || "/") + "</code>";
  }

  // ── Layout hooks ──────────────────────────────────────────────────────────
  // The composer card, not the whole frame: the bar sits just above it.
  function barAnchor() {
    const ed = getEditor();
    if (!ed) return null;
    let n = safeRead(() => ed.parentElement, null);
    for (let i = 0; n && n !== document.body && i < 6; n = safeRead(() => n.parentElement, null), i++) {
      const r = safeRead(() => n.getBoundingClientRect(), null);
      if (r && r.width >= 320 && safeQueryAll(n, CONTROL_SEL).some((b) => sendControlLike(b) || stopControlLike(b))) return n;
    }
    return composerFrame();
  }

  // ── Image attachment ──────────────────────────────────────────────────────
  function fileFromImage(img, i) {
    const mime = img.mimeType || "image/jpeg";
    const bin = atob(img.data);
    const arr = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
    const ext = mime.includes("png") ? "png" : "jpg";
    return new File([arr], `featherscript_${Date.now()}_${i}.${ext}`, { type: mime });
  }
  const composerFileInput = () => {
    const frame = composerFrame();
    return (frame && safeQuery(frame, 'input[type="file"]')) || safeQuery(document, 'input[type="file"]');
  };
  const visionAvailable = () => {
    try { return !!getEditor() && !!composerFileInput(); } catch { return false; }
  };
  function imageEvidence() {
    const frame = composerFrame();
    if (!frame) return [];
    return safeQueryAll(frame,
      'img, [data-testid*="attachment" i], [data-testid*="upload-preview" i], [aria-label*="remove attachment" i], [aria-label*="remove image" i]')
      .filter(node => !safeClosest(node, '#zs-root'))
      .map(node => `${node.tagName}:${safeRead(() => node.getAttribute('src'), '') || ''}:${safeRead(() => node.getAttribute('data-testid'), '') || ''}:${safeRead(() => node.getAttribute('aria-label'), '') || ''}`);
  }
  async function attachImages(images) {
    if (!images || !images.length) return false;
    const input = composerFileInput();
    const before = imageEvidence();
    const dt = new DataTransfer();
    images.forEach((img, i) => { try { dt.items.add(fileFromImage(img, i)); } catch {} });
    if (!dt.items.length) return false;
    let dispatched = false;
    if (input) {
      try {
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        dispatched = true;
      } catch {}
    }
    if (!dispatched) {
      const ed = getEditor();
      if (!ed) return false;
      try { ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); dispatched = true; }
      catch { return false; }
    }
    // A synthetic change/paste event is not proof the site accepted the upload.
    // Require a new preview (or an updated preview) before sending the text.
    return dispatched && await waitFor(() => {
      const after = imageEvidence();
      return after.length >= before.length + images.length ||
        (after.length > before.length) || after.some(value => !before.includes(value));
    }, 15000);
  }
  function clearAttachments() {
    try {
      const frame = composerFrame();
      if (!frame) return;
      for (const b of safeQueryAll(frame, "[aria-label*='remove' i], [aria-label*='delete' i]")) {
        try { b.click(); } catch {}
      }
    } catch {}
  }

  // "" = a transient chat with no thread id. The /ai landing AND a brand-new
  // /chat share one path, so returning it as the key persisted that path as a
  // started session - a fresh empty chat then inherited "Agent active" with no
  // Start (same class as Gemini's /app bug). A started thread whose id is not
  // in the URL is still recognised from our own turns (domHasZsSignal).
  const conversationKey = () => {
    const id = threadId();
    return id ? `chat:${id}` : "";
  };

  function installSendHooks(handlers) {
    document.addEventListener("keydown", (e) => {
      if (!e.isTrusted) return;
      if (e.key !== "Enter" || e.shiftKey) return;
      const ed = getEditor();
      if (!ed || !(e.target === ed || (e.target && safeRead(() => ed.contains(e.target), false)))) return;
      if (handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (!chatIsEmpty()) return;
        handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(assistantCount());
    }, true);
    document.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      const frame = composerFrame();
      const b = e.target && safeRead(() => e.target.closest(CONTROL_SEL), null);
      if (!b || !frame || !safeRead(() => frame.contains(b), false)) return;
      if (stopControlLike(b)) { handlers.onNativeStop(); return; }
      if (!sendControlLike(b)) return;
      if (handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (!chatIsEmpty()) return;
        handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(assistantCount());
    }, true);
  }

  // Hiding the raw command block: Notion renders code as block elements, so mark
  // the blocks that carry a command. A fenced ###LUA###…###END_LUA### command can
  // span SEVERAL sibling blocks (Notion runs one block per line), so hiding only
  // the block that holds the opening marker left the rest of the script on
  // screen. Hide the whole run when the opener stands alone on its block (the
  // per-line layout), plus the card that wrapped it. Hide classes are sticky for
  // the life of the turn (chip() does not reset them), so a bare JSON command -
  // which has no closing fence to bound it - only ever hides its own block.
  // React re-creates blocks on scroll/hover and strips these classes; the core's
  // rawVisible check now also watches [data-block-id], so the sweep notices the
  // command came back and re-runs this. Chips never go inside the locked
  // editable root (see chipAnchor).
  const CMD_START = /"(?:command|tool)"\s*:\s*"|###\s*(?:lua|mcp_tool)/i;
  const CMD_END = /###\s*end_lua/i;
  const CMD_LINE_ONLY = /^\s*###\s*(?:lua|mcp_tool)[^\n]*$/i;
  function findToolBlockSpot(item /*, chip */) {
    if (!item) return null;
    let blocks = safeQueryAll(item, "[data-block-id]");
    // Leaf blocks only: a container's text includes its children, so matching on
    // it could hide unrelated content.
    blocks = blocks.length
      ? blocks.filter((b) => !safeQuery(b, "[data-block-id]"))
      : safeQueryAll(item, "pre, code");
    // Text of a wrapper that is NOT already hidden. Notion wraps a code block in
    // its own bordered card, so hiding the lines alone left an empty code box
    // (the reported screenshot) - the wrapper has to go with them.
    const strayText = (root) => {
      let out = "";
      const walk = (n) => {
        if (n.nodeType === 3) { out += n.nodeValue || ""; return; }
        if (n.nodeType !== 1 || n.classList.contains("zs-tool-hide") || n.classList.contains("zs-chip")) return;
        for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
      };
      for (let c = root.firstChild; c; c = c.nextSibling) walk(c);
      return out.trim();
    };
    const hideBox = (block) => {
      // Walk out while the wrapper holds nothing but the command (a language
      // pill or icon is fine) and never past this turn or over our chip.
      let box = block;
      for (let n = safeRead(() => block.parentElement, null), i = 0; n && n !== item && i < 5;
           n = safeRead(() => n.parentElement, null), i++) {
        if (safeQuery(n, ".zs-chip") || strayText(n).length > 24) break;
        box = n;
      }
      if (box !== item) box.classList.add("zs-tool-hide");
    };
    let first = null;
    let runParent = null; // parent of a marker→end run being hidden
    let runStart = null;  // first hidden block of the current run
    const closeRun = () => {
      if (runStart) hideBox(runStart);
      runStart = null;
      runParent = null;
    };
    for (const block of blocks) {
      if (!safeRead(() => block.isConnected, false) || safeClosest(block, ".zs-chip")) continue;
      const t = _txt(block);
      const inRun = !!runParent && safeRead(() => block.parentElement, null) === runParent;
      if (!inRun) {
        if (runStart) closeRun();
        if (!CMD_START.test(t)) continue;
        // A bare JSON command has no closing fence, so only a marker-only Lua
        // opener may extend the run past its own block.
        if (CMD_LINE_ONLY.test(t)) runParent = safeRead(() => block.parentElement, null) || null;
      }
      block.classList.add("zs-tool-hide");
      if (!runStart) runStart = block;
      if (!first) first = block;
      if (CMD_END.test(t)) closeRun(); // run closed; a later command still hides
    }
    if (runStart) closeRun();
    return first ? { parent: safeRead(() => first.parentElement, null), ref: first } : null;
  }
  function chipAnchor(item) {
    if (!item) return item;
    // Walk out of ANY contenteditable root: Notion reverts DOM edits inside it.
    let n = item;
    for (let i = 0; n && i < 6; n = safeRead(() => n.parentElement, null), i++) {
      const editable = safeRead(() => n.isContentEditable, false) || safeRead(() => n.matches(BLOCK_ROOT_SEL), false);
      if (!editable) return n;
    }
    return safeRead(() => item.parentElement, null) || item;
  }

  const NOTION_SITE_RULES =
    "Notion AI rules: Notion's OWN tools (page search, page/database editing, web search) act on " +
    "Notion's cloud workspace and can NEVER read or change the user's Roblox Studio. Anything Roblox - " +
    "studio state, scripts, Luau, the game tree - happens ONLY through the FeatherScript commands " +
    "described above; those are intercepted by the extension in the user's browser and executed on " +
    "their machine. A Notion tool call aimed at Roblox always fails and wastes the turn. Always write " +
    "each command as PLAIN TEXT in the reply body, NEVER inside a Notion tool call: one complete JSON " +
    'object in a fenced json block (e.g. {"command": "get_studio_state"}) or a ###LUA### … ###END_LUA### ' +
    "block, then stop and wait for the result. If the user's message is informational (reference " +
    "material to read and remember, or a request to summarize/explain/answer), reply directly and " +
    "promptly with no Roblox planning and no commands. Between tool results, never restart broad " +
    "planning: choose the next safe action and write it immediately.";

  return {
    id: "notion",
    displayName: "Notion AI",
    get supportsVision() { return visionAvailable(); },
    timings: {
      WARMUP_MS: 90000,
      REASON_NOREPLY_MS: 180000,
      STABLE_MS: 15000,
      GEN_IDLE_MS: 9000,
      REASON_IDLE_MS: 30000,
      RESPONSE_TIMEOUT_MS: 900000,
    },
    get promptExtra() { return NOTION_SITE_RULES; },
    // The reply editor is DOM-locked: never append inside it. Chips are anchored
    // on the row wrapper outside the editable root.
    chipAtItemLevel: true,
    chipAnchor,
    chipAppend: true,
    reliableCounts: false,
    init({ diag: d } = {}) {
      if (d) diag = d;
      try { document.documentElement.setAttribute("data-zs-notion-ver", "1"); } catch {}
      setTimeout(() => {
        try {
          diag("notion.providerLoaded", {
            url: routeKey(), surface: isAiSurface(), thread: threadId(),
            editor: !!getEditor(), rows: topAgentRows().length, blocks: blockRoots().length, items: allItems().length,
          });
        } catch {}
      }, 0);
    },
    // turns
    allItems, invalidateItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, lastAssistantId, itemKey, readAssistant,
    streamLen, snapshot,
    // composer / state
    getEditor, editorText, chatIsEmpty, isFreshChat, isAiSurface, composerFrame, barAnchor,
    setInputLock, typeAndSend, stopGeneration,
    isGenerating, isBusyNow, isHardGenerating,
    enforceComposer, ensureComposerReady, modeWarning,
    turnHalted, findContinueBtn, clickContinueBtn,
    scanError, isTooLongMsg, isBusyMsg,
    // actions
    attachImages, clearAttachments, conversationKey,
    installSendHooks, findToolBlockSpot,
  };
})();
