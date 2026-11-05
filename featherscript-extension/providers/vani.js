// SPDX-License-Identifier: GPL-3.0-or-later
// providers/vani.js - the Vani Chat (c.vani.ai) provider.
// Exports the same ZSProvider interface as providers/qwen.js and
// providers/deepseek.js; the core (core/main.js) is provider-agnostic. To DISABLE
// Vani support, remove this file + providers/vani-net.js from manifest.json (and
// its URLs from background.js PROVIDER_URLS + main.js AI_SITES).
//
// Vani DOM notes (ported from a working adapter, 2026-10):
//  - Next.js app; guest chat lives at /c and /chat, logged-in threads at
//    /c/<id>. Only /login is a real gate - the "Sign up for free" panel beside a
//    guest chat is marketing and the composer still works.
//  - Class names are not stable enough to rely on. The transcript is discovered
//    by shape: explicit data-message-role / data-role markers first, then
//    message-ish class names, then a walk down from <main> to the level that has
//    several text-bearing rows. User vs assistant is decided by role attributes,
//    by "did we type this ourselves" (rememberSent), and by alignment.
//  - The composer is a textarea or a contenteditable; both are driven with the
//    native value setter / insertText so React's handlers fire.
//  - Vani prepends its own platform prompt (web search, Document / Slides /
//    Design panels, its own tools). providers/vani-net.js pins a short
//    FeatherScript protocol note to the TOP of the outgoing user message so the
//    model does not drift into "I can't use JSON blocks" or write a Document
//    instead of a command. That tap also publishes the streamed reply verbatim,
//    which is the source of truth for the latest turn (see netLatest()).
// eslint-disable-next-line no-unused-vars
const ZSProvider = (() => {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let diag = () => {}; // injected by core via init()

  const S = {
    editor:
      'textarea[placeholder*="Message" i], textarea[name="message"], textarea[aria-label*="message" i], ' +
      '[contenteditable="true"][role="textbox"], .ProseMirror, .tiptap, textarea, [contenteditable="true"], [role="textbox"]',
    // Accessible names of the send / stop controls (Vani labels those, not the
    // class names, so a redesign keeps them working).
    sendAria: /^(send|submit|send message|submit message|ask)$|send message|submit prompt/i,
    stopAria: /^stop$|stop (generating|generation|response)|cancel generation|abort/i,
    errorSurfaces: '[role="alert"],[role="status"],[class*="toast"],[class*="error"],[data-sonner-toast],[data-sonner-toaster] li',
  };

  const RE = {
    contextLimit: /context.{0,20}(limit|exceeded|window)|conversation.{0,20}too long|(token|context|input).{0,12}(limit|too long)|message is too long/i,
    tooLong: /conversation .{0,20}(too long|getting too long)|message is too long|too many tokens/i,
    busy: /rate limit|too many requests|try again (later|in)|temporarily unavailable|server is busy|high demand|overloaded|concurrency_limit|one (active )?(reply|conversation|request) at a time|one reply at a time/i,
    // Guest chat runs on one shared free allowance. When it is gone Vani keeps
    // accepting messages but never answers, so surface it as a hard stop.
    allowance: /allowance (used up|is used up|exhausted|exceeded)|(used up|exhausted) (your|the) (free |shared |guest )?allowance|out of (free )?(messages|allowance)|(^|[^0-9.])0% of your free allowance|no (free )?allowance left|free allowance is used up|weekly_limit/i,
    continueBtn: /^(continue|continue generating|keep going)$/i,
    // Composer chrome we must never treat as a transcript row.
    chrome: /^(new chat|see plans and pricing|sign up for free|log in|back to vani\.ai|decline|accept|try vani)$/i,
    // The guest allowance strip above the composer. It is a plain <main> child
    // with no role markers, so the shape fallback (the only pass that runs on an
    // EMPTY landing) counted it - and then its three spans - as turns, which made
    // chatIsEmpty() false: the bar said "No agent here" and Start was refused.
    marketing: /create a free account|text chat only|% of your free allowance (left|remaining)|no account needed/i,
  };

  const timings = {
    GEN_IDLE_MS: 600,
    REASON_IDLE_MS: 4000,
    // Guest models think for a long time before the first token; the network tap
    // reports the open stream as "generating", these only govern the DOM fallback.
    WARMUP_MS: 40000,
    REASON_NOREPLY_MS: 60000,
    STABLE_MS: 2500,
    RESPONSE_TIMEOUT_MS: 300000,
  };

  function visible(el) {
    if (!el || el.closest("#zs-root")) return false;
    try {
      const r = el.getBoundingClientRect();
      if (r.width < 16 || r.height < 10) return false;
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
    } catch { return false; }
    return true;
  }

  const CODE_CHROME_SEL =
    "[class*='line-number' i], [class*='linenumber' i], [class*='lineno' i], [class*='gutter' i], [data-line-number], " +
    ".react-syntax-highlighter-line-number, [class*='code-header' i], [class*='codeHeader'], [class*='code-toolbar' i], " +
    "[class*='CodeToolbar'], [class*='code-lang' i], [class*='language-label' i], [aria-hidden='true'][class*='line']";

  // Plain text of a <pre>/<code>: token spans concatenated, gutters skipped, one
  // newline per rendered line (highlighters wrap each line in a span or div with
  // no text newline between them, which glued JSON commands into one line).
  function codeText(node) {
    let out = "";
    const lineish = (el) =>
      el.nodeType === 1 &&
      (el.tagName === "DIV" ||
        (el.tagName === "SPAN" &&
          /\bline\b|^line|code-line|cm-line|token-line/i.test(String(el.className || "")) &&
          !/number|gutter/i.test(String(el.className || ""))));
    const walk = (n) => {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      if (n.matches && (n.matches(CODE_CHROME_SEL) || n.tagName === "BUTTON")) return;
      if (n.tagName === "BR") { out += "\n"; return; }
      const isLine = lineish(n);
      for (const c of n.childNodes) walk(c);
      if (isLine && !out.endsWith("\n")) out += "\n";
    };
    walk(node);
    return out.replace(/\u00a0/g, " ");
  }

  function textWithout(root, excludeSel) {
    if (!root) return "";
    const skip = excludeSel ? `.zs-chip, ${excludeSel}` : ".zs-chip";
    let t = "";
    const walk = (n) => {
      if (n.nodeType === 3) { t += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      if (n.matches && n.matches(skip)) return;
      if (n.tagName === "BR") { t += "\n"; return; }
      // Copy / regenerate / model-name toolbars under a reply are not reply text.
      if (n.tagName === "BUTTON" || (n.getAttribute && n.getAttribute("role") === "toolbar")) return;
      // Syntax-highlighter chrome would interleave with the JSON command and
      // break the parser ("1 { 2 \"command\": …").
      if (n.matches && n.matches(CODE_CHROME_SEL)) return;
      if (n.tagName === "PRE" || n.tagName === "CODE") {
        const code = codeText(n);
        if (t && !t.endsWith("\n")) t += "\n";
        t += code;
        if (!t.endsWith("\n")) t += "\n";
        return;
      }
      const isBlock = /^(P|DIV|PRE|LI|UL|OL|BLOCKQUOTE|H[1-6]|ARTICLE|SECTION|TABLE|TR)$/.test(n.tagName);
      if (isBlock && t && !t.endsWith("\n")) t += "\n";
      for (const c of n.childNodes) walk(c);
      if (isBlock && !t.endsWith("\n")) t += "\n";
    };
    walk(root);
    return t;
  }

  // ── Composer ──────────────────────────────────────────────────────────────
  const getEditor = () => {
    const sels = S.editor.split(",").map((s) => s.trim());
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        if (!visible(el)) continue;
        if (el.closest("nav, header, aside, [role='navigation'], [role='dialog'], [role='search']")) continue;
        // Search boxes / API-key fields in settings panels are never the composer.
        const ph = (el.getAttribute("placeholder") || el.getAttribute("aria-label") || "").toLowerCase();
        if (/search|api key|email|password|name your/.test(ph)) continue;
        return el;
      }
    }
    return null;
  };

  const editorText = () => {
    const e = getEditor();
    if (!e) return "";
    if (e.tagName === "TEXTAREA" || e.tagName === "INPUT") return e.value || "";
    return (e.innerText || e.textContent || "").replace(/\u00a0/g, " ");
  };

  // Texts this extension (or the user) sent, by their first 160 characters. The
  // most reliable user-row signal on a layout we cannot see: a transcript row
  // whose text starts like something we typed is the user's, whatever its CSS
  // says. Keeps the last 40.
  const _sentKeys = [];
  const sentKey = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, 160);
  function rememberSent(text) {
    const k = sentKey(text);
    if (k.length < 8) return;
    if (!_sentKeys.includes(k)) { _sentKeys.push(k); if (_sentKeys.length > 40) _sentKeys.shift(); }
  }
  function looksSent(item) {
    if (!_sentKeys.length) return false;
    const k = sentKey(item && (item.innerText || item.textContent));
    if (k.length < 8) return false;
    const head = k.slice(0, 60);
    return _sentKeys.some((sk) => sk.startsWith(head) || k.startsWith(sk.slice(0, 60)));
  }
  function roleOf(item) {
    if (!item) return "";
    const a = (item.getAttribute("data-message-role") || item.getAttribute("data-role") || item.getAttribute("data-author") || item.getAttribute("data-author-role") || "").toLowerCase();
    if (a) return a;
    const cls = String(item.className || "").toLowerCase();
    if (/\buser\b|human|from-user|msg-user|message-user/.test(cls)) return "user";
    if (/\bassistant\b|\bagent\b|\bai\b|from-assistant|msg-assistant|message-assistant|\bmodel\b/.test(cls)) return "assistant";
    const inner = item.querySelector("[data-message-role],[data-role],[data-author-role]");
    if (inner) return (inner.getAttribute("data-message-role") || inner.getAttribute("data-role") || inner.getAttribute("data-author-role") || "").toLowerCase();
    return "";
  }

  function transcriptRoot() {
    const ed = getEditor();
    const cands = [
      "[role='log']", "[role='feed']", "main [class*='messages' i]", "main [class*='thread' i]",
      "main [class*='conversation' i]", "main [class*='transcript' i]", "main [class*='chat' i] ol", "main ol", "main",
    ];
    for (const sel of cands) {
      for (const el of document.querySelectorAll(sel)) {
        if (!visible(el)) continue;
        if (ed && el.contains(ed) && sel !== "main") continue;
        return el;
      }
    }
    return document.querySelector("main") || document.body;
  }

  function looksLikeChrome(el) {
    const t = (el.innerText || "").trim();
    if (!t) return true;
    if (RE.chrome.test(t)) return true;
    if (el.closest("nav, header, aside, footer, form, [role='navigation'], [role='dialog'], #zs-root")) return true;
    const ed = getEditor();
    if (ed && (el.contains(ed) || ed.contains(el))) return true;
    return false;
  }

  // The core asks for the transcript several times per tick (readAssistant,
  // assistantCount, lastAssistantId, isGenerating), and every scan is a few
  // full-document queries. Memoise for one beat; a new row is picked up within
  // 120ms, which is far inside the loop's own 500ms settle window.
  let _itemsCache = { at: 0, list: null };
  const invalidateItems = () => { _itemsCache = { at: 0, list: null }; };
  function allItems() {
    const now = Date.now();
    if (_itemsCache.list && now - _itemsCache.at < 120) return _itemsCache.list;
    const list = allItemsUncached();
    _itemsCache = { at: now, list };
    return list;
  }
  function allItemsUncached() {
    const sels = [
      "[data-message-role]",
      "[data-message-id]",
      "[data-role='user'], [data-role='assistant']",
      "[data-author-role]",
      "article[data-testid*='message' i], [data-testid*='message' i]",
      ".message, [class*='ChatMessage'], [class*='chat-message'], [class*='message-row'], [class*='MessageRow']",
      "article",
    ];
    const out = [];
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        if (!visible(el) || looksLikeChrome(el)) continue;
        // Keep outermost rows only (a row that contains an already-collected
        // row would double-count).
        if (out.some((o) => o.contains(el) || el.contains(o))) continue;
        out.push(el);
      }
      if (out.length) break;
    }
    if (!out.length) {
      // Shape fallback: walk down from the transcript container through
      // single-child wrappers until a level with several text-bearing rows
      // (user bubbles / markdown bodies) appears.
      const log = transcriptRoot();
      if (log) out.push(...shapeRows(log));
    }
    return out;
  }

  function rowCandidates(parent) {
    const rows = [];
    for (const el of parent.children) {
      if (el.nodeType !== 1 || !visible(el) || looksLikeChrome(el)) continue;
      // Marketing strip, not a turn. The <pre> guard keeps a real reply (which
      // always carries the command block) from ever being dropped here.
      if (!el.querySelector("pre") && RE.marketing.test((el.innerText || "").trim())) continue;
      if (!textWithout(el).trim()) continue;
      rows.push(el);
    }
    return rows;
  }
  function shapeRows(root) {
    let node = root;
    for (let depth = 0; depth < 12 && node; depth++) {
      const rows = rowCandidates(node);
      if (rows.length >= 2) return rows;
      if (rows.length === 0) return node === root ? [] : [node];
      node = rows[0];
    }
    return node && node !== root ? [node] : [];
  }

  function isUserItem(item) {
    const r = roleOf(item);
    if (/user|human/.test(r)) return true;
    if (/assistant|agent|ai|model|system/.test(r)) return false;
    if (looksSent(item)) return true;
    const cls = String(item && item.className || "");
    if (/\bml-auto\b|justify-end|items-end|self-end|flex-row-reverse/.test(cls)) return true;
    // A user bubble is usually a right-aligned box without markdown chrome.
    try {
      const r2 = item.getBoundingClientRect();
      const parent = item.parentElement;
      const parentW = (parent && parent.getBoundingClientRect().width) || innerWidth;
      const parentX = parent ? parent.getBoundingClientRect().left : 0;
      const rightGap = parentW - (r2.left + r2.width - parentX);
      const leftGap = r2.left - parentX;
      if (leftGap > rightGap + 60 && !item.querySelector("pre, table, h1, h2, h3")) return true;
    } catch {}
    return false;
  }
  function isAssistantItem(item) {
    const r = roleOf(item);
    if (/assistant|agent|ai|model/.test(r)) return true;
    if (/user|human|system/.test(r)) return false;
    return !isUserItem(item) && !!(item && (item.innerText || "").trim());
  }

  const BODY_SEL = ".prose, .markdown, .markdown-body, [class*='prose'], [class*='markdown' i], [class*='message-content' i], [class*='MessageContent'], [data-testid*='content' i]";
  function itemText(item) {
    if (!item) return "";
    const body = item.querySelector(BODY_SEL) || item;
    return textWithout(body);
  }

  const assistantItems = () => allItems().filter(isAssistantItem);
  const assistantCount = () => assistantItems().length;
  const userCount = () => allItems().filter(isUserItem).length;
  const lastAssistant = () => { const it = assistantItems(); return it.length ? it[it.length - 1] : null; };

  const _idMap = new WeakMap();
  let _idSeq = 0;
  function itemKey(item) {
    if (!item) return null;
    let id = _idMap.get(item);
    if (!id) { id = ++_idSeq; _idMap.set(item, id); }
    return id;
  }
  const lastAssistantId = () => itemKey(lastAssistant());

  const chatIsEmpty = () => allItems().length === 0;
  const isFreshChat = () => chatIsEmpty() && !!getEditor();

  function composerFrame() {
    const ed = getEditor();
    if (!ed) return null;
    return ed.closest("form")
      || ed.closest("[class*='composer' i]")
      || ed.closest("[class*='chat-input' i], [class*='ChatInput'], [class*='prompt' i]")
      || ed.closest("footer")
      || ed.parentElement;
  }
  // Keep the bar just above the composer card rather than at the bottom of the
  // page: walk up while the wrapper keeps the composer's width.
  function barAnchor() {
    const ed = getEditor();
    if (!ed) return null;
    let n = ed;
    for (let i = 0; i < 10 && n; i++) {
      const cls = String(n.className || "");
      if (/rounded|composer|input-bar|chat-input|prompt/i.test(cls) && n.getBoundingClientRect().width >= ed.getBoundingClientRect().width) return n;
      n = n.parentElement;
    }
    return composerFrame();
  }
  const gateTarget = composerFrame;

  function setInputLock(on) {
    const ed = getEditor();
    if (!ed) return;
    if (ed.isContentEditable || ed.getAttribute("contenteditable") === "true") {
      ed.setAttribute("contenteditable", on ? "false" : "true");
      return;
    }
    if (on) {
      if (ed.dataset.zsPlaceholder == null) ed.dataset.zsPlaceholder = ed.getAttribute("placeholder") || "";
      ed.setAttribute("readonly", "");
      ed.setAttribute("placeholder", "⏳ Agent working… please wait");
    } else {
      ed.removeAttribute("readonly");
      if (ed.dataset.zsPlaceholder != null) ed.setAttribute("placeholder", ed.dataset.zsPlaceholder);
    }
  }

  // Only the dedicated /login route is a gate. The "Sign up for free / Log in"
  // panel next to guest chat is marketing - the composer still works.
  function loginGatePresent() {
    const p = (location.pathname || "").toLowerCase();
    if (/^\/(login|signin|signup|register|auth)(\/|$)/.test(p)) return true;
    return false;
  }

  function allowanceExhausted() {
    try {
      for (const el of document.querySelectorAll("p, div, span, [role='alert']")) {
        if (!visible(el) || el.closest("#zs-root")) continue;
        const t = (el.textContent || "").trim();
        if (t.length > 400 || t.length < 12) continue;
        if (RE.allowance.test(t)) return true;
      }
    } catch {}
    return false;
  }

  // ── Network tap (providers/vani-net.js, MAIN world) ───────────────────────
  // Publishes { rid, text, done, t } for the latest streamed reply: Vani's SSE
  // deltas are verbatim markdown, while the DOM re-renders (and can split a
  // fence across line elements). The tap is the SOURCE OF TRUTH for the latest
  // turn's text; the DOM still anchors rows, counts and chips.
  function netLatest() {
    try {
      const n = document.getElementById("zs-vani-net");
      if (!n || !n.textContent) return null;
      const o = JSON.parse(n.textContent);
      return o && typeof o.text === "string" ? o : null;
    } catch { return null; }
  }
  // rid of the response we LAST replied to. The tap keeps holding a finished
  // response until Vani opens the next one; reading that stale text as the new
  // turn's reply would miss its command and finalize the loop as plain text.
  let _sentRid = null, _sentAt = 0;
  function rememberSentResponse() {
    const net = netLatest();
    if (net && net.rid) _sentRid = net.rid;
    _sentAt = Date.now();
  }
  function netCurrent() {
    const net = netLatest();
    if (!net || !net.rid) return null;
    if (_sentRid && net.rid === _sentRid) return null; // the previous turn
    if (_sentAt && net.startedAt && net.startedAt < _sentAt - 1500) return null; // predates this send
    return net;
  }
  function netReplyFor(item) {
    if (item !== lastAssistant()) return null;
    const net = netCurrent();
    return net && net.text ? net.text : null;
  }
  // A failed request is reported by the tap as a finished turn carrying `err`;
  // surface it so the loop stops with the site's real reason.
  function netError() {
    const net = netCurrent();
    if (!net || !net.err) return null;
    if (net.text && net.text.length > 40) return null; // a reply that also carried a soft error
    return String(net.err);
  }

  function classifyText(item, excludeSel) {
    if (!item) return "";
    if (isAssistantItem(item)) {
      if (item === lastAssistant()) {
        const net = netReplyFor(item);
        if (net) return net;
      }
      const body = item.querySelector(BODY_SEL) || item;
      return textWithout(body, excludeSel);
    }
    return textWithout(item, excludeSel);
  }

  // ── Send / stop control ───────────────────────────────────────────────────
  const ariaOf = (b) => (b.getAttribute("aria-label") || b.title || b.getAttribute("data-tooltip") || (b.textContent || "").trim()).trim();
  const allButtons = () => [...document.querySelectorAll("button, [role='button']")].filter((b) => !b.closest("#zs-root"));
  function nearComposer(b) {
    const frame = composerFrame();
    return !frame || frame.contains(b) || (frame.parentElement && frame.parentElement.contains(b));
  }
  const sendButton = () =>
    allButtons().find((b) => S.sendAria.test(ariaOf(b)) && visible(b) && b.type !== "reset" && nearComposer(b)) ||
    allButtons().find((b) => b.type === "submit" && visible(b) && nearComposer(b)) ||
    allButtons().find((b) => S.sendAria.test(ariaOf(b)) && visible(b) && b.type !== "reset") ||
    null;
  const stopButton = () =>
    allButtons().find((b) => S.stopAria.test(ariaOf(b)) && visible(b)) || null;

  // ── Generation detection ──────────────────────────────────────────────────
  function streamLen(item) {
    const it = item === undefined ? lastAssistant() : item;
    if (it === lastAssistant()) {
      const net = netReplyFor(it);
      if (net) return net.length;
    }
    return it ? classifyText(it, ".zs-chip").trim().length : 0;
  }

  let _streamMax = -1, _streamAt = 0, _streamItem = null;
  function sampleStream() {
    const item = lastAssistant();
    const len = classifyText(item, ".zs-chip").length;
    const now = Date.now();
    if (item !== _streamItem || len < _streamMax - 400) {
      _streamItem = item; _streamMax = len; _streamAt = now; return;
    }
    if (len > _streamMax) { _streamMax = len; _streamAt = now; }
  }
  const grewWithin = (ms) => _streamMax > 1 && Date.now() - _streamAt < ms;

  // Authoritative generation state from the tap: 'streaming' / 'done' / null.
  // The tap opens a stream with EMPTY text, and Vani's guest models then think
  // silently for up to a minute - that silence IS generating. Only a closed
  // stream (or a text that stopped growing) counts as done. Bounded so a stream
  // that never closes cannot pin the watcher forever.
  const _net = { rid: null, len: 0, growAt: 0 };
  function netGenState() {
    const net = netCurrent();
    if (!net) return null;
    const now = Date.now();
    const len = (net.text || "").length;
    if (net.rid !== _net.rid) { _net.rid = net.rid; _net.len = len; _net.growAt = now; }
    else if (len !== _net.len) { _net.len = len; _net.growAt = now; }
    if (!len && !net.err) {
      return (!net.done && now - (net.startedAt || now) < 150000) ? "streaming" : null;
    }
    if (net.done) return "done";
    if (net.err && !len) return "done";
    if (!stopButton() && len > 0 && now - _net.growAt > 8000) return "done"; // lost close frame
    return "streaming";
  }

  const WEDGE_MS = 12000;
  let _stopSince = 0;
  function genActive() {
    sampleStream();
    const stop = !!stopButton();
    const now = Date.now();
    const g = netGenState();
    if (g === "streaming") return true;
    if (g === "done" && !stop) return false;
    if (stop) {
      // A stop control that stays up while the text is frozen is Vani's own
      // wedge (it sometimes leaves the stop button after the stream closed).
      if (!_stopSince) _stopSince = now;
      return (now - _streamAt < WEDGE_MS) || (now - _stopSince < 2500);
    }
    _stopSince = 0;
    // Typing / thinking indicator before the first token.
    try {
      const last = lastAssistant();
      if (last && last.querySelector("[class*='typing' i], [class*='thinking' i], [class*='loading' i], [aria-busy='true'], .animate-pulse, .animate-bounce") && now - _streamAt < WEDGE_MS) return true;
    } catch {}
    return grewWithin(timings.GEN_IDLE_MS);
  }
  const isGenerating = genActive;
  const isBusyNow = genActive;
  const isHardGenerating = () => !!stopButton() || netGenState() === "streaming";

  const turnHalted = () => false;
  const findContinueBtn = () => {
    try {
      return allButtons().find((b) => visible(b) && RE.continueBtn.test((b.textContent || "").trim())) || null;
    } catch { return null; }
  };
  const clickContinueBtn = () => { const b = findContinueBtn(); if (!b) return false; try { b.click(); return true; } catch { return false; } };

  function snapshot() {
    try {
      const it = lastAssistant();
      return { th: 0, rp: it ? streamLen(it) : 0 };
    } catch { return {}; }
  }
  function readAssistant() {
    const item = lastAssistant();
    if (!item) return { present: false, reply: "", thinking: "", item: null };
    return { present: true, reply: classifyText(item).trim(), thinking: "", item };
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
  // Guest chat shares a free allowance and the per-message cap is unknown, so
  // keep single messages well under any server-side limit.
  const SEND_MAX = 60000;
  function truncateForSend(text) {
    if (!text || text.length <= SEND_MAX) return text;
    const omitted = text.length - SEND_MAX;
    const marker = `\n\n[…FeatherScript: result truncated to fit Vani's input limit - ${omitted} of ${text.length} characters omitted. Do NOT re-run the command; work with the head and tail shown here…]\n\n`;
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

  function setRichText(el, text) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      setTextareaValue(el, text);
      return;
    }
    el.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
    let ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch {}
    if (!ok) {
      el.textContent = text;
      try {
        el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      } catch {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  function pressEnter(editor) {
    const o = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    editor.dispatchEvent(new KeyboardEvent("keydown", o));
    editor.dispatchEvent(new KeyboardEvent("keyup", o));
  }

  // Tell the MAIN-world tap that an agent session is live on this page. It only
  // pins the protocol note while this attribute is set, so a normal Vani chat
  // with the extension installed but not started is never touched.
  function markAgentOn() {
    try { document.documentElement.setAttribute("data-zs-vani-agent", "1"); } catch {}
  }

  // Commit a send EXACTLY ONCE (a delayed receipt never authorizes another
  // click - re-clicking on a slow acceptance duplicated messages). Proof that
  // the send landed: our text left the composer, the stop control is up, a new
  // user row appeared, or the tap saw the request. A second attempt uses a
  // DIFFERENT mechanism and only when our text is verifiably still typed.
  const netSawRequest = () => { const net = netLatest(); return !!(net && net.rid && net.rid !== _sentRid); };
  async function commitSend(editor, text, pre) {
    const tail = String(text || "").replace(/\s+/g, " ").trim().slice(-60);
    const stillTyped = () => {
      const t = editorText().replace(/\s+/g, " ").trim();
      if (!t) return false;
      return t.length >= tail.length ? t.includes(tail) : tail.includes(t);
    };
    const proof = () => (!stillTyped() ? "cleared" : isHardGenerating() ? "generating" : userCount() > pre.users ? "userRow" : netSawRequest() ? "netRequest" : "");
    const fire = (how) => {
      try {
        if (how === "click") {
          const b = sendButton();
          if (b && !b.disabled && b.getAttribute("aria-disabled") !== "true") { b.click(); return true; }
          return false;
        }
        const form = editor.closest("form");
        if (form && typeof form.requestSubmit === "function") { form.requestSubmit(); return true; }
        pressEnter(editor); return true;
      } catch { return false; }
    };
    const plan = fire("click") ? ["click", "submit"] : ["submit", "click"];
    if (plan[0] === "submit") fire("submit");
    let p = "";
    await waitFor(() => !!(p = proof()), 2500);
    if (p) return { sent: true, how: plan[0], proof: p };
    if (!fire(plan[1])) return { sent: false, how: plan[0] };
    await waitFor(() => !!(p = proof()), 2500);
    return { sent: !!p, how: plan[1], proof: p };
  }

  async function typeAndSend(text, images) {
    const editor = getEditor();
    if (!editor) throw new Error("Vani chat box not found - open c.vani.ai/chat");
    markAgentOn();
    // setInputLock flips contenteditable=false for the whole run. A locked
    // framework editor swallows execCommand/insertText and the send never fires,
    // so unlock for the injection only and put the lock back (same pattern as
    // chatgpt/gemini/kimi/notion).
    const isText = /^(TEXTAREA|INPUT)$/.test(editor.tagName);
    const relock = isText
      ? editor.hasAttribute("readonly")
      : editor.getAttribute("contenteditable") === "false";
    if (relock) {
      if (isText) editor.removeAttribute("readonly");
      else editor.setAttribute("contenteditable", "true");
    }
    try {
      editor.focus();
      await sleep(40);
      text = truncateForSend(text);
      rememberSentResponse();
      rememberSent(text);
      setRichText(editor, text);
      await sleep(80);
      // Attach images LAST, right before the send click (attaching before typing
      // can sever the site's binding between the upload and the message).
      // submitAndGetBase RETRIES typeAndSend up to 4x; only attach if nothing is
      // staged yet, else each retry pastes ANOTHER duplicate copy.
      if (images && images.length && !hasPendingAttachment() && !(await attachImages(images))) throw Error('Vani photo upload failed. No message was sent.');
      const sendReady = () => {
        const b = sendButton();
        return !!b && !b.disabled && b.getAttribute("aria-disabled") !== "true";
      };
      await waitFor(sendReady, 2500);
      const r = await commitSend(editor, text, { users: userCount() });
      diag("vani.send", { len: text.length, sent: r.sent, how: r.how, proof: r.proof });
    } finally {
      if (relock) {
        const e2 = getEditor() || editor;
        if (/^(TEXTAREA|INPUT)$/.test(e2.tagName)) e2.setAttribute("readonly", "");
        else e2.setAttribute("contenteditable", "false");
      }
    }
  }

  function stopGeneration() {
    const b = stopButton();
    if (b) { try { b.click(); } catch {} }
  }

  function enforceComposer() { return { ready: !!getEditor() }; }
  async function ensureComposerReady(reason) {
    if (!getEditor()) await waitFor(() => !!getEditor(), 4000);
    const ready = !!getEditor() && !loginGatePresent();
    if (ready) markAgentOn();
    diag("mode_ready", { reason, provider: "vani", ready, login: loginGatePresent() });
    return { ready };
  }

  // ── Error / limit detection ───────────────────────────────────────────────
  function scanError() {
    // A request that failed on the wire never renders an error toast reliably;
    // the tap knows the HTTP body, which is where Vani says "allowance used up".
    const ne = netError();
    if (ne) {
      if (RE.allowance.test(ne)) return "Vani's free allowance is used up - log in for your own allowance, then retry.";
      if (RE.contextLimit.test(ne) || RE.busy.test(ne)) return ne.slice(0, 240);
    }
    try {
      for (const el of document.querySelectorAll(S.errorSurfaces)) {
        if (!visible(el)) continue;
        if (el.closest("[data-message-role], article")) continue;
        const t = (el.innerText || "").trim();
        if (t.length > 8 && t.length < 600 && (RE.contextLimit.test(t) || RE.allowance.test(t) || RE.busy.test(t))) return t.slice(0, 240);
      }
    } catch {}
    if (allowanceExhausted()) return "Vani's free guest allowance is used up - log in for your own allowance, then retry.";
    if (!getEditor() && !loginGatePresent()) return "The input box disappeared (session ended?).";
    return null;
  }
  const isTooLongMsg = (text) => RE.tooLong.test(text);
  const isBusyMsg = (text) => RE.busy.test(text) || RE.allowance.test(text);

  function modeWarning() {
    if (loginGatePresent()) return "";
    if (allowanceExhausted()) return "<b>Vani Chat</b> - the free guest allowance is used up. <b>Log in</b> (own allowance) or wait, then reload.";
    if (!getEditor()) return "<b>Vani Chat</b> - open the chat at <b>c.vani.ai/chat</b>, then reload.";
    return "";
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
  // Image upload is a logged-in feature on Vani ("Attach images, PDFs and text
  // files" needs an account): the file input simply does not exist for guests.
  // supportsVision mirrors that, so screen_capture is only offered where an
  // attachment can actually be delivered - never as a claim that silently fails.
  const composerFileInput = () => {
    const frame = composerFrame();
    return (frame && frame.querySelector('input[type="file"]')) || document.querySelector('input[type="file"]');
  };
  const visionAvailable = () => {
    try { return !!getEditor() && !!composerFileInput(); } catch { return false; }
  };
  const pendingAttachments = () => {
    try {
      const ed = getEditor();
      if (!ed) return [];
      const frame = composerFrame();
      if (!frame) return [];
      return [...frame.querySelectorAll("[class*='attachment' i], [class*='file-card' i], img[src^='blob:']")]
        .filter((n) => !n.closest("[data-message-role], article"));
    } catch { return []; }
  };
  const hasPendingAttachment = () => pendingAttachments().length > 0;

  async function attachImages(images) {
    const editor = getEditor();
    if (!editor || !images || !images.length) return false;
    const dt = new DataTransfer();
    images.forEach((img, i) => { try { dt.items.add(fileFromImage(img, i)); } catch {} });
    if (!dt.items.length) return false;
    const fileInput = composerFileInput();
    if (fileInput) {
      try {
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event("change", { bubbles: true }));
        const ok = await waitFor(() => hasPendingAttachment() || userCount() > 0, 15000);
        diag("attach.input", { ok });
        return ok;
      } catch {}
    }
    try {
      editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      const ok = await waitFor(() => hasPendingAttachment(), 15000);
      diag("attach.paste", { ok });
      return ok;
    } catch { return false; }
  }
  function clearAttachments() {
    try {
      const frame = composerFrame();
      if (!frame) return;
      for (const b of frame.querySelectorAll("button[aria-label*='remove' i], button[aria-label*='delete' i], [class*='attachment' i] button")) {
        try { b.click(); } catch {}
      }
    } catch {}
  }

  // "" = a transient chat with no thread id. EVERY fresh guest chat lives at a
  // shared /c (or /chat) path, so returning that path as the key made the core
  // persist it as "started" - a brand-new empty chat then showed "Agent active"
  // with no Start (same class as Gemini's /app bug). Real threads are /c/<id>.
  const conversationKey = () => {
    const m = (location.pathname || "").match(/\/(?:c|chat|conversation|thread)\/([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    const q = new URLSearchParams(location.search || "");
    return q.get("c") || q.get("id") || q.get("thread") || "";
  };

  // ── User-send interception ────────────────────────────────────────────────
  function installSendHooks(handlers) {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      const ed = getEditor();
      if (!ed || !ed.contains(e.target)) return;
      if (editorText().trim() === "") return;
      rememberSent(editorText());
      rememberSentResponse();
      if (handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (!chatIsEmpty()) return;
        handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(assistantCount());
    }, true);
    document.addEventListener("click", (e) => {
      if (!getEditor()) return;
      const t = e.target;
      const btn = t.closest && t.closest("button, [role='button']");
      if (!btn || btn.closest("#zs-root")) return;
      if (S.stopAria.test(ariaOf(btn))) { handlers.onNativeStop(); return; }
      const isSend = (S.sendAria.test(ariaOf(btn)) || btn.type === "submit") && nearComposer(btn);
      if (!isSend) return;
      if (btn.disabled) return;
      rememberSent(editorText());
      rememberSentResponse();
      if (handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (!chatIsEmpty()) return;
        handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(assistantCount());
    }, true);
  }

  // ── Tool-block camouflage ─────────────────────────────────────────────────
  const CMD_SHAPE = /"(?:command|tool)"\s*:\s*"|\\"(?:command|tool)\\"\s*:|'(?:command|tool)'\s*:|[{,]\s*(?:command|tool)\s*:\s*["']|###\s*lua|###mcp_tool###/i;
  function findToolBlockSpot(item) {
    if (!item) return null;
    let parent = null, ref = null;
    for (const pre of item.querySelectorAll("pre")) {
      if (pre.closest && pre.closest(".zs-chip")) continue;
      if (!CMD_SHAPE.test(pre.textContent || "")) continue;
      pre.classList.add("zs-tool-hide");
      item.classList.add("zs-cmd-mask");
      if (!ref && pre.parentElement) { parent = pre.parentElement; ref = pre; }
    }
    return ref ? { parent, ref } : null;
  }

  // ── Site rules (Vani's own tools are a distraction, not a feature) ─────────
  const VANI_SITE_RULES =
    "Vani Chat rules: this is a plain markdown chat for Roblox work and Vani's own tools " +
    "(web search, Document, Slides, Design, code execution) CANNOT reach Roblox Studio - " +
    "ignore them and never propose them while this chat is linked. The ONLY way to act is to " +
    "write the command as text in your reply: ONE complete JSON object in a fenced json block " +
    '(e.g. {"command": "execute_luau", "params": {...}}), or a ###LUA### … ###END_LUA### block for ' +
    "Luau. Writing the block IS the action - never say you cannot run commands or use JSON blocks, " +
    "never only describe a command, and never answer by creating a Document. Do not search the web. " +
    "Keep prose to one short line; the command block is the work. Guest sessions are not saved, so " +
    "never rely on an earlier page load. If Vani reports that the free allowance is used up, stop and " +
    "ask the user to log in.";

  return {
    id: "vani",
    displayName: "Vani Chat",
    // Only offered where an attachment control exists (see visionAvailable).
    get supportsVision() { return visionAvailable(); },
    timings,
    thinkingSel: ".reasoning, [class*='thinking' i], [class*='reason' i], [class*='thought' i], [data-testid*='reasoning' i], details summary",
    get promptExtra() { return VANI_SITE_RULES; },
    // React re-renders the reply subtree on stream updates; anchor chips at the
    // turn element and trail them after the reply text (the model writes its
    // command at the end of the turn).
    chipAtItemLevel: true,
    chipAppend: true,
    reliableCounts: false,
    init({ diag: d } = {}) {
      if (d) diag = d;
      try { document.documentElement.setAttribute("data-zs-vani-ver", "1"); } catch {}
      diag("vani.init", { hasEditor: !!getEditor(), login: loginGatePresent(), path: location.pathname });
    },
    // turns
    allItems, invalidateItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, lastAssistantId, itemKey, readAssistant,
    streamLen, snapshot,
    // composer / state
    getEditor, editorText, chatIsEmpty, isFreshChat, composerFrame, gateTarget, barAnchor,
    setInputLock, typeAndSend, stopGeneration,
    isGenerating, isBusyNow, isHardGenerating,
    enforceComposer, ensureComposerReady,
    turnHalted, findContinueBtn, clickContinueBtn,
    scanError, isTooLongMsg, isBusyMsg, modeWarning,
    // actions
    attachImages, clearAttachments, conversationKey,
    installSendHooks, findToolBlockSpot,
  };
})();
