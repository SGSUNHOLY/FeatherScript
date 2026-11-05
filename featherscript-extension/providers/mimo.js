// SPDX-License-Identifier: GPL-3.0-or-later
// providers/mimo.js - the Xiaomi MiMo Studio (aistudio.xiaomimimo.com) provider.
// Exports the same ZSProvider interface as providers/vani.js and
// providers/qwen.js; the core (core/main.js) is provider-agnostic. To DISABLE
// MiMo support, remove this file + providers/mimo-net.js from manifest.json (and
// its URL from background.js PROVIDER_URLS + main.js AI_SITES).
//
// MiMo DOM / protocol notes (validated live and in the site's bundles, 2026-11):
//  - Hash-routed SPA. Two supported chat products on ONE origin:
//      UltraSpeed  #/ultra, #/ultra/<id>   POST /open-apis/bot/chat   (v2 SSE)
//      MiMo Chat   #/c,     #/c/<id>       POST /open-apis/react/chat (v3 SSE)
//    #/claw (MiMo Claw) is a different agent surface - explicitly unsupported.
//  - The transcript root is #message-list. Every turn row is
//    div.relative.mx-auto.flex.w-full: the user row carries alignment="rtl" +
//    .flex-row-reverse + a .whitespace-pre-wrap bubble, the assistant row
//    alignment="ltr" + .markdown-prose bodies. Reasoning renders as
//    <details type="reasoning"><summary>…</summary>…</details> and must never
//    leak into the parsed reply.
//  - Rows are a flex ROW (avatar | content column), so the chip is anchored into
//    the message column (chipAnchor) instead of item.firstChild, where it would
//    become the avatar's sibling and shove the layout sideways (Kimi pattern).
//  - The composer is a plain <textarea> inside .dialogue-container, driven with
//    the native value setter + an input event. The send and stop controls are
//    the SAME button, labelled from its tooltip ("Send message" / "Stop").
//  - providers/mimo-net.js (MAIN world) pins the FeatherScript protocol note to
//    the top of every outgoing query while an agent session is live, and taps
//    the SSE stream. Its folded text is the SOURCE OF TRUTH for the latest turn
//    (MiMo re-renders Shiki code blocks on every token, which can split a fence).
//  - A Xiaomi account is required to send. When signed out, both routes show a
//    "Sign in" control and no account avatar; ensureComposerReady / modeWarning
//    surface that instead of typing into a dead composer. Sending is redirected
//    to account.xiaomi.com, so the authenticated send/stream path is NOT
//    covered by a live end-to-end test in this build.
// eslint-disable-next-line no-unused-vars
const ZSProvider = (() => {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let diag = () => {}; // injected by core via init()

  const S = {
    editor:
      '.dialogue-container textarea, [class*="dialogue" i] textarea, ' +
      'textarea[placeholder], textarea[aria-label*="message" i], textarea, ' +
      '[contenteditable="true"][role="textbox"]',
    // MiMo labels the shared send/stop button through its tooltip, which the
    // button exposes as aria-label (or data-tooltip on some builds).
    sendAria: /^(send|send message|submit|submit message)$|send message/i,
    stopAria: /^(stop|stop generating|stop generation|stop response|stop responding)$|stop generat/i,
    errorSurfaces: '[role="alert"], [class*="toast" i], [class*="error" i], [data-sonner-toast], [data-sonner-toaster] li',
  };

  const RE = {
    contextLimit:
      /(this|the) conversation has reached the limit|conversation.{0,20}(too long|limit)|context.{0,20}(limit|exceeded|window)|text length limit exceeded|(token|input).{0,12}(limit|too long)|message is too long/i,
    tooLong:
      /conversation .{0,20}(too long|getting too long)|message is too long|too many tokens|text length limit exceeded|context.{0,20}(limit|exceeded)/i,
    busy: /too many requests|server is busy|system resources are currently busy|sending a message now|wait a minute or two|temporarily unavailable|high demand|overloaded|\b429\b/i,
    // submit() refuses an injected message with ONLY this toast while MiMo still
    // holds its previous run (it keeps the draft, so the send looks like it was
    // never accepted). See commitSend.
    sendWait: /sending a message now|wait a minute or two|当前有消息正在发送/i,
    // MiMo automatically truncates an over-long message and still SENDS it -
    // this toast is informational, not a conversation limit. It fires on our long
    // tool-result injections, so scanError must not read it as a dead end.
    truncated: /automatically truncated|自动截断/i,
    // MiMo's daily model quota: HTTP 429 with code 4004/4005.
    quota: /today'?s? quota has been used up|quota.{0,30}(used up|exhausted|exceeded|reached)|used up.{0,20}quota|\b4004\b|\b4005\b/i,
    sensitive: /sensitive|content (policy|violation)|violat\w+ .{0,20}(policy|guidelines)|blocked by (the )?safety/i,
    auth: /\b401\b|\b403\b|unauthori[sz]ed|not (logged|signed) in|login required|sign in to continue|please sign in|session expired/i,
    continueBtn: /^(continue|continue generating|keep going|resume)$/i,
    // Composer chrome we must never treat as a transcript row.
    chrome: /^(new chat|sign in|log in|settings|upgrade|learn more)$/i,
  };

  const timings = {
    GEN_IDLE_MS: 700,
    REASON_IDLE_MS: 4000,
    WARMUP_MS: 60000,
    REASON_NOREPLY_MS: 120000,
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
    "[class*='code-header' i], [class*='codeHeader'], [class*='code-toolbar' i], [class*='CodeToolbar'], " +
    "[class*='language-label' i], [class*='code-lang' i], [aria-hidden='true'][class*='line']";

  // Plain text of a <pre>/<code>: token spans concatenated, gutters skipped, one
  // newline per rendered line. Shiki wraps every line in a span.line with no text
  // newline between them; without this a fenced JSON command glued into one line.
  function codeText(node) {
    let out = "";
    const lineish = (el) => {
      if (el.nodeType !== 1) return false;
      const cls = String(el.className || "");
      if (el.tagName === "DIV") return true;
      if (el.tagName !== "SPAN") return false;
      // Shiki lines ("line"), Monaco ("view-line"), highlight.js ("hljs-ln-line").
      return (/\bline\b|^line|code-line|cm-line|token-line/i.test(cls) && !/number|gutter/i.test(cls));
    };
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
      // Copy / regenerate / model toolbars under a reply are not reply text.
      if (n.tagName === "BUTTON" || (n.getAttribute && n.getAttribute("role") === "toolbar")) return;
      if (n.matches && n.matches(CODE_CHROME_SEL)) return;
      if (n.tagName === "PRE" || n.tagName === "CODE") {
        const code = codeText(n);
        if (t && !t.endsWith("\n")) t += "\n";
        t += code;
        if (!t.endsWith("\n")) t += "\n";
        return;
      }
      const isBlock = /^(P|DIV|PRE|LI|UL|OL|BLOCKQUOTE|H[1-6]|ARTICLE|SECTION|TABLE|TR|DETAILS|SUMMARY)$/.test(n.tagName);
      if (isBlock && t && !t.endsWith("\n")) t += "\n";
      for (const c of n.childNodes) walk(c);
      if (isBlock && !t.endsWith("\n")) t += "\n";
    };
    walk(root);
    return t;
  }

  // ── Transcript ────────────────────────────────────────────────────────────
  const ROW_SEL = "div.relative.mx-auto.flex.w-full";
  const USER_BUBBLE_SEL = ".whitespace-pre-wrap, [class*='bg-mimo-bg-message' i]";
  const BODY_SEL = ".markdown-prose, [data-is-typing]";
  const REASON_SEL = "details[type='reasoning'], [type='reasoning']";

  const transcriptRoot = () =>
    document.querySelector("#message-list") ||
    document.querySelector("[data-testid='message-list']") ||
    null;

  // The content column inside a turn row: [avatar | COLUMN(reasoning, text,
  // actions)]. Chips and text reads live here so the avatar stays untouched.
  function messageColumn(item) {
    if (!item) return null;
    const body = item.querySelector(BODY_SEL);
    if (!body) return null;
    let n = body;
    while (n.parentElement && n.parentElement !== item) {
      const p = n.parentElement;
      const cls = String(p.className || "");
      if (/\bflex\b/.test(cls) && /\bflex-col\b/.test(cls) && /\bmin-w-0\b/.test(cls)) return p;
      n = p;
    }
    // Top-most content child of the row (the column beside the avatar).
    return n;
  }

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
    const root = transcriptRoot();
    const scope = root || document;
    let nodes = [...scope.querySelectorAll(ROW_SEL)];
    if (!nodes.length) {
      // Tailwind class order is not guaranteed; filter a cheaper superset.
      nodes = [...scope.querySelectorAll("div.flex.w-full")].filter((el) => {
        const cls = String(el.className || "");
        return /\brelative\b/.test(cls) && /\bmx-auto\b/.test(cls);
      });
    }
    const out = [];
    for (const el of nodes) {
      if (el === root || !visible(el)) continue;
      if (el.closest("#zs-root")) continue;
      // A real turn row carries a body, a reasoning block, a typing marker or
      // MiMo's alignment attribute; wrappers without any of those are skipped.
      if (!el.getAttribute("alignment") && !el.querySelector(`${BODY_SEL}, ${REASON_SEL}, ${USER_BUBBLE_SEL}`)) continue;
      if (out.some((o) => o.contains(el) || el.contains(o))) continue;
      out.push(el);
    }
    if (out.length) return out;
    // Last resort: climb from message bodies to their flex row.
    for (const body of scope.querySelectorAll(BODY_SEL)) {
      let n = body;
      for (let i = 0; i < 8 && n && n !== scope; i++) {
        const cls = String(n.className || "");
        if (/\bflex\b/.test(cls) && /\bw-full\b/.test(cls) && /\brelative\b/.test(cls)) {
          if (!out.includes(n) && visible(n)) out.push(n);
          break;
        }
        n = n.parentElement;
      }
    }
    return out;
  }

  // Texts this extension (or the user) sent, by their first 160 characters. A
  // row whose text starts like something we typed is the user's, whatever its
  // CSS says. Keeps the last 40.
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

  function isUserItem(item) {
    if (!item) return false;
    const align = String(item.getAttribute("alignment") || "").toLowerCase();
    if (align === "rtl") return true;
    if (align === "ltr") return false;
    if (item.querySelector("details[type='reasoning'], [data-is-typing]")) return false;
    const cls = String(item.className || "");
    if (/\bflex-row-reverse\b/.test(cls) || item.querySelector(".flex-row-reverse")) return true;
    if (!item.querySelector(".markdown-prose") && item.querySelector(USER_BUBBLE_SEL)) return true;
    if (looksSent(item)) return true;
    // A right-aligned bubble without markdown chrome is the user's.
    try {
      const r = item.getBoundingClientRect();
      const parent = item.parentElement;
      if (!parent) return false;
      const pr = parent.getBoundingClientRect();
      const leftGap = r.left - pr.left;
      const rightGap = pr.right - r.right;
      if (leftGap > rightGap + 60 && !item.querySelector("pre, table, h1, h2, h3")) return true;
    } catch {}
    return false;
  }
  function isAssistantItem(item) {
    if (!item) return false;
    const align = String(item.getAttribute("alignment") || "").toLowerCase();
    if (align === "ltr") return true;
    if (/(assistant|agent|ai|model)/i.test(align)) return true;
    if (isUserItem(item)) return false;
    return !!(item.querySelector(BODY_SEL) || (item.innerText || "").trim());
  }

  function itemText(item) {
    if (!item) return "";
    if (isUserItem(item)) return textWithout(item.querySelector(USER_BUBBLE_SEL) || item);
    return textWithout(messageColumn(item) || item, REASON_SEL);
  }

  // Reasoning lives in a <details> with its <summary> label; the core uses this
  // for the "thinking, no reply yet" wait. Never part of the parsed reply.
  function reasoningText(item) {
    if (!item) return "";
    const col = messageColumn(item) || item;
    const d = col.querySelector(REASON_SEL);
    if (!d) return "";
    let t = "";
    const walk = (n) => {
      if (n.nodeType === 3) { t += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      if (n.tagName === "SUMMARY" || n.tagName === "BUTTON") return;
      for (const c of n.childNodes) walk(c);
    };
    walk(d);
    return t.replace(/\s+/g, " ").trim();
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

  // ── Composer ──────────────────────────────────────────────────────────────
  const getEditor = () => {
    const sels = S.editor.split(",").map((s) => s.trim());
    for (const sel of sels) {
      for (const el of document.querySelectorAll(sel)) {
        if (!visible(el)) continue;
        if (el.closest("#message-list, nav, header, aside, [role='navigation'], [role='dialog'], [role='search']")) continue;
        // Search boxes / API-key fields in settings panels are never the composer.
        const ph = (el.getAttribute("placeholder") || el.getAttribute("aria-label") || "").toLowerCase();
        if (/search|api key|email|password|name your/.test(ph)) continue;
        // The signed-out "Sign in to continue chatting" placeholder is an empty
        // state, not a usable composer - still return it so signedOut() sees it.
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

  function composerFrame() {
    const ed = getEditor();
    if (!ed) return null;
    return ed.closest(".dialogue-container")
      || ed.closest("[class*='composer' i]")
      || ed.closest("[class*='chat-input' i], [class*='ChatInput']")
      || ed.closest("form")
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
      if (/rounded|composer|dialogue|input-bar|chat-input/i.test(cls) && n.getBoundingClientRect().width >= ed.getBoundingClientRect().width) return n;
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

  // ── Routes / sign-in gate ─────────────────────────────────────────────────
  const isClaw = () => /^#\/claw(\/|$)/.test(location.hash || "");

  function avatarPresent() {
    try {
      return !!document.querySelector(
        "img[alt*='avatar' i], img[alt*='profile' i], [class*='avatar' i] img"
      );
    } catch { return false; }
  }
  function visibleSignIn() {
    try {
      for (const el of document.querySelectorAll("button, a, [role='button']")) {
        if (!visible(el) || el.closest("#zs-root")) continue;
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (!t || t.length > 24) continue;
        if (/^(sign in|sign in to continue|log in|login)$/i.test(t)) return true;
      }
    } catch {}
    return false;
  }
  // MiMo requires a Xiaomi account to chat. Signed out, both routes still render
  // a composer, but the send redirects to account.xiaomi.com - so detect it and
  // refuse to start instead of typing into a dead box.
  function signedOut() {
    try {
      if (/account\.xiaomi\.com$/i.test(location.hostname)) return true;
      const ed = getEditor();
      const ph = (ed && (ed.getAttribute("placeholder") || ed.getAttribute("aria-label"))) || "";
      if (/sign\s*in|log\s*in/i.test(ph)) return true;
      return !avatarPresent() && visibleSignIn();
    } catch { return false; }
  }

  // ── Network tap (providers/mimo-net.js, MAIN world) ───────────────────────
  // Publishes { rid, startedAt, text, reasoning, done, err, status, t } for the
  // latest streamed reply. MiMo's SSE deltas are verbatim markdown while the DOM
  // re-renders Shiki code blocks per token; the tap is the SOURCE OF TRUTH for
  // the latest turn's text, the DOM still anchors rows, counts and chips.
  function netLatest() {
    try {
      const n = document.getElementById("zs-mimo-net");
      if (!n || !n.textContent) return null;
      const o = JSON.parse(n.textContent);
      return o && typeof o.text === "string" ? o : null;
    } catch { return null; }
  }
  // rid of the response we LAST replied to. The tap keeps holding a finished
  // response until the next request opens; reading that stale text as the new
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
    return net ? net.text : null;
  }
  function netThinkingFor(item) {
    if (item !== lastAssistant()) return "";
    const net = netCurrent();
    return net && net.reasoning ? net.reasoning : "";
  }
  // A failed request is reported by the tap as a finished turn carrying `err`.
  // Quota / sensitive / auth are hard stops even if a partial reply arrived.
  function netError() {
    const net = netCurrent();
    if (!net || !net.err) return null;
    const e = String(net.err);
    if (RE.quota.test(e) || RE.sensitive.test(e) || RE.auth.test(e)) return e;
    if (net.text && net.text.length > 40) return null; // a reply that also carried a soft error
    return e;
  }

  function classifyText(item, excludeSel) {
    if (!item) return "";
    if (isAssistantItem(item)) {
      if (item === lastAssistant()) {
        const net = netReplyFor(item);
        if (net !== null) return net;
      }
      const ex = excludeSel ? `${REASON_SEL}, ${excludeSel}` : REASON_SEL;
      return textWithout(messageColumn(item) || item, ex);
    }
    return textWithout(item.querySelector(USER_BUBBLE_SEL) || item, excludeSel);
  }

  // ── Send / stop control ───────────────────────────────────────────────────
  const ariaOf = (b) =>
    (b.getAttribute("aria-label") || b.title || b.getAttribute("data-tooltip") || (b.textContent || "").trim()).trim();
  const allButtons = () => [...document.querySelectorAll("button, [role='button']")].filter((b) => !b.closest("#zs-root"));
  function nearComposer(b) {
    const frame = composerFrame();
    return !frame || frame.contains(b) || (frame.parentElement && frame.parentElement.contains(b));
  }
  const usable = (b) => visible(b) && !b.disabled && b.getAttribute("aria-disabled") !== "true";
  const sendButton = () =>
    allButtons().find((b) => S.sendAria.test(ariaOf(b)) && usable(b) && b.type !== "reset" && nearComposer(b)) ||
    allButtons().find((b) => b.type === "submit" && !S.stopAria.test(ariaOf(b)) && usable(b) && nearComposer(b)) ||
    null;
  const stopButton = () =>
    allButtons().find((b) => S.stopAria.test(ariaOf(b)) && visible(b)) || null;

  // ── Generation detection ──────────────────────────────────────────────────
  function streamLen(item) {
    const it = item === undefined ? lastAssistant() : item;
    if (it === lastAssistant()) {
      const net = netReplyFor(it);
      if (net !== null) return net.length;
    }
    return it ? classifyText(it, ".zs-chip").trim().length : 0;
  }

  let _streamMax = -1, _streamAt = 0, _streamItem = null;
  function sampleStream() {
    const item = lastAssistant();
    const len = classifyText(item, ".zs-chip").length + reasoningText(item).length;
    const now = Date.now();
    if (item !== _streamItem || len < _streamMax - 400) {
      _streamItem = item; _streamMax = len; _streamAt = now; return;
    }
    if (len > _streamMax) { _streamMax = len; _streamAt = now; }
  }
  const grewWithin = (ms) => _streamMax > 1 && Date.now() - _streamAt < ms;

  // Authoritative generation state from the tap: 'streaming' / 'done' / null.
  // The tap opens a stream with EMPTY text, and MiMo may think (v3 streams
  // reasoningContent) before the first answer token - that silence IS generating.
  // Bounded so a stream that never closes cannot pin the watcher forever.
  const _net = { rid: null, len: 0, growAt: 0 };
  function netGenState() {
    const net = netCurrent();
    if (!net) return null;
    const now = Date.now();
    const len = (net.text || "").length + (net.reasoning || "").length;
    if (net.rid !== _net.rid) { _net.rid = net.rid; _net.len = len; _net.growAt = now; }
    else if (len !== _net.len) { _net.len = len; _net.growAt = now; }
    if (!len && !net.err) {
      return (!net.done && now - (net.startedAt || now) < 180000) ? "streaming" : null;
    }
    if (net.done) return "done";
    if (net.err && !net.text) return "done";
    // UltraSpeed can pause between bursts without mounting a Stop button.
    // Only a real terminal frame or a long dead transport ends this state.
    if (now - Math.max(_net.growAt, net.t || net.startedAt || 0) > 120000) return "done";
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
      // A stop control that stays up while the text is frozen is MiMo's own
      // wedge (the shared button sometimes lingers after the stream closed).
      if (!_stopSince) _stopSince = now;
      return (now - _streamAt < WEDGE_MS) || (now - _stopSince < 2500);
    }
    _stopSince = 0;
    // Typing marker before the first token ([data-is-typing] on the reply).
    try {
      const last = lastAssistant();
      if (last && last.querySelector("[data-is-typing='true'], [data-is-typing], [class*='animate-pulse'], [class*='animate-bounce'], [aria-busy='true']") && now - _streamAt < WEDGE_MS) return true;
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
    return {
      present: true,
      reply: classifyText(item).trim(),
      thinking: netThinkingFor(item) || reasoningText(item),
      item,
    };
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
  // The per-message cap differs per model; keep single messages well under any
  // server-side limit and tell the model not to re-run a truncated result.
  const SEND_MAX = 60000;
  function truncateForSend(text) {
    if (!text || text.length <= SEND_MAX) return text;
    const omitted = text.length - SEND_MAX;
    const marker = `\n\n[…FeatherScript: result truncated to fit MiMo's input limit - ${omitted} of ${text.length} characters omitted. Do NOT re-run the command; work with the head and tail shown here…]\n\n`;
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
    try {
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: v }));
    } catch {
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
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
  // pins the protocol note while this attribute is set, so a normal MiMo chat
  // with the extension installed but not started is never touched.
  function markAgentOn() {
    try { document.documentElement.setAttribute("data-zs-mimo-agent", "1"); } catch {}
  }

  // The shared send/stop control is MiMo's OWN readiness signal for a send: it
  // is disabled while an upload is pending (or a failed one is staged), and it
  // is replaced by Stop while a run is live. Clicking before it is a clickable
  // Send is a no-op - and the composer keeps the draft - which is what burned
  // the core's four retries and ended in "did not accept the injected message".
  const sendReadyNow = () => !!sendButton();

  // submit() answers a refused send with only a toast ("Sending a message now.
  // Wait a minute or two and try again." i18n error.message.sending_wait) and
  // keeps the draft, so nothing in the composer tells us what happened.
  function sendRefusal() {
    try {
      for (const el of document.querySelectorAll(S.errorSurfaces)) {
        if (!visible(el) || el.closest("#zs-root, #message-list")) continue;
        const t = (el.innerText || "").trim();
        if (t && RE.sendWait.test(t)) return t.slice(0, 240);
      }
    } catch {}
    return "";
  }

  // A Stop click WE make (unwedging the control mid-send) must not be read as
  // the user's own Stop - installSendHooks would tell the core to end the loop.
  // The site's handler runs synchronously inside .click(), so a flag set around
  // that single call is exact (a time window could swallow a real user Stop).
  let _selfStop = false;

  // Leaving the control on Stop outlives a settled reply on MiMo (the same wedge
  // exists on ChatGPT) and blocks every send. Wait it out; only if the reply is
  // no longer growing is it MiMo's wedge, and stopping the run is what returns
  // the control to Send. Never fires while text is still arriving.
  async function awaitSendIdle(ms = 6000) {
    if (!stopButton()) return true;
    if (await waitFor(() => !stopButton(), ms)) return true;
    const net = netLatest();
    if (net && !net.done && !net.err) return false;
    sampleStream();
    if (grewWithin(10000)) return false;
    diag("mimo.sendUnwedge", {});
    stopGeneration();
    const ok = await waitFor(() => !stopButton(), 6000);
    diag("mimo.sendUnwedge.done", { ok });
    return ok;
  }

  // Commit a send EXACTLY ONCE (a delayed receipt never authorizes another
  // click - re-clicking on a slow acceptance duplicated messages). Proof that
  // the send landed: our text left the composer, the stop control is up, a new
  // user row appeared, or the tap saw the request. A second attempt uses a
  // DIFFERENT mechanism and only when our text is verifiably still typed.
  const netSawRequest = () => { const net = netLatest(); return !!(net && net.rid && net.rid !== _sentRid); };
  async function commitSend(editor, text, pre) {
    if (!editor.isConnected) throw new Error("MiMo replaced its composer before submission.");
    if (stopButton() || !sendReadyNow()) throw new Error("MiMo is not ready for another message. Wait for the current turn to finish.");
    const proof = () => editorText().trim() === "" ? "cleared" :
      netSawRequest() ? "netRequest" : userCount() > pre.users ? "userRow" :
      isHardGenerating() ? "generating" : "";
    // Pick a single submission mechanism. A delayed acknowledgement is never
    // permission to fire another one, even if the draft remains visible.
    const button = sendButton();
    if (button) button.click();
    else {
      const form = editor.closest("form");
      if (form && typeof form.requestSubmit === "function") form.requestSubmit();
      else pressEnter(editor);
    }
    let receipt = "";
    await waitFor(() => !!(receipt = proof()), 15000);
    if (!receipt) {
      const refusal = sendRefusal();
      throw new Error(refusal || "MiMo has not confirmed delivery. FeatherScript did not resend the message; check the chat before continuing.");
    }
    return { sent: true, proof: receipt };
  }

  let delivery = null;
  function typeAndSend(text, images) {
    if (delivery) {
      if (delivery.text === text && delivery.images === images) return delivery.promise;
      return Promise.reject(new Error("MiMo already has a message being submitted. Wait for its receipt."));
    }
    const entry = { text, images, promise: null };
    delivery = entry;
    entry.promise = deliverOnce(text, images).finally(() => { if (delivery === entry) delivery = null; });
    return entry.promise;
  }

  async function deliverOnce(text, images) {
    const editor = getEditor();
    if (!editor) throw new Error("MiMo chat box not found - open aistudio.xiaomimimo.com/#/ultra or #/c");
    if (signedOut()) throw new Error("MiMo is signed out - sign in with a Xiaomi account at aistudio.xiaomimimo.com, then retry.");
    const previous = netLatest();
    if (previous && !previous.done && !previous.err) {
      const idle = await waitFor(() => { const net = netLatest(); return !net || net.done || !!net.err; }, 20000);
      if (!idle) throw new Error("MiMo is still processing the previous request. No second message was submitted.");
    }
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
      if (!editor.isConnected || getEditor() !== editor) throw new Error("MiMo replaced its composer during insertion.");
      setRichText(editor, text);
      await sleep(80);
      // Attach images LAST, right before the send click (attaching before typing
      // can sever the site's binding between the upload and the message).
      // submitAndGetBase RETRIES typeAndSend up to 4x; only attach if nothing is
      // staged yet, else each retry pastes ANOTHER duplicate copy.
      if (images && images.length && !hasPendingAttachment() && !(await attachImages(images))) throw Error('MiMo photo upload failed. No message was sent.');
      // Wait for MiMo's own Send control, not a fixed delay: an image upload
      // disables it until the file finishes (a screenshot can take several
      // seconds), and a failed upload disables it until the file is removed.
      const hadImages = !!(images && images.length);
      // A Stop control already up means MiMo is still holding its previous run,
      // where a send can only be refused - waiting on Send first would burn the
      // whole window. Let the unwedge path deal with it instead.
      let ready = sendReadyNow();
      if (!ready && !stopButton()) ready = await waitFor(sendReadyNow, hadImages ? 20000 : 8000);
      if (!ready) {
        await awaitSendIdle(8000);
        ready = await waitFor(sendReadyNow, 3000);
      }
      if (!ready && hadImages && hasPendingAttachment()) {
        diag("mimo.clearStuckAttachments", {});
        clearAttachments();
        ready = await waitFor(sendReadyNow, 4000);
      }
      diag("mimo.sendReady", { ready, stop: !!stopButton(), images: hadImages });
      if (!ready) throw new Error("MiMo is not ready to accept another message.");
      const r = await commitSend(editor, text, { users: userCount() });
      diag("mimo.send", { len: text.length, sent: r.sent, how: r.how, proof: r.proof, why: r.why, route: location.hash });
      return r;
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
    if (!b) return;
    _selfStop = true;
    try { b.click(); } catch {} finally { _selfStop = false; }
  }

  function enforceComposer() { return { ready: !!getEditor() }; }
  async function ensureComposerReady(reason) {
    if (!getEditor()) await waitFor(() => !!getEditor(), 5000);
    const ready = !!getEditor() && !signedOut() && !isClaw();
    if (ready) markAgentOn();
    diag("mode_ready", { reason, provider: "mimo", ready, signIn: signedOut(), claw: isClaw(), route: location.hash });
    return { ready };
  }

  // ── Error / limit detection ───────────────────────────────────────────────
  const quotaMsg = () => "MiMo's quota for this model is used up - switch to another model or wait for it to reset, then retry.";
  const authMsg = () => "Your MiMo session is signed out - sign in at aistudio.xiaomimimo.com, then retry.";

  function scanError() {
    // A request that failed on the wire never renders an error toast reliably;
    // the tap knows the HTTP body, which is where MiMo says "quota used up".
    const ne = netError();
    if (ne) {
      if (RE.quota.test(ne)) return quotaMsg();
      if (RE.auth.test(ne)) return authMsg();
      if (RE.sensitive.test(ne)) return "MiMo blocked this message (flagged as sensitive). Rephrase it and retry.";
      if (RE.contextLimit.test(ne)) return "This MiMo conversation has reached its context limit - start a new chat, then retry.";
      if (RE.busy.test(ne)) return "MiMo is busy right now (too many requests) - wait a few seconds, then retry.";
      return ne.slice(0, 240);
    }
    try {
      for (const el of document.querySelectorAll(S.errorSurfaces)) {
        if (!visible(el) || el.closest("#zs-root, #message-list")) continue;
        const t = (el.innerText || "").trim();
        if (t.length < 8 || t.length > 600) continue;
        if (RE.quota.test(t)) return quotaMsg();
        if (RE.sensitive.test(t)) return "MiMo blocked this message (flagged as sensitive). Rephrase it and retry.";
        // MiMo trims an over-long injected message and sends it anyway; that
        // toast also says "text length limit exceeded", so reading it as a
        // context wall would end a perfectly good turn.
        if (RE.truncated.test(t)) continue;
        if (RE.contextLimit.test(t)) return "This MiMo conversation has reached its context limit - start a new chat, then retry.";
        if (RE.busy.test(t) || RE.auth.test(t)) return t.slice(0, 240);
      }
    } catch {}
    if (signedOut()) return authMsg();
    if (!getEditor()) return "The MiMo input box disappeared (signed out or page changed?).";
    return null;
  }
  const isTooLongMsg = (text) => RE.tooLong.test(text);
  const isBusyMsg = (text) => RE.busy.test(text) || RE.quota.test(text);

  function modeWarning() {
    if (isClaw()) return "<b>MiMo Claw</b> isn't supported by FeatherScript. Open <b>UltraSpeed</b> or <b>MiMo Chat</b>, then reload.";
    if (signedOut()) return "<b>MiMo Studio</b> - sign in with a Xiaomi account, then reload. FeatherScript can't send from a signed-out chat.";
    if (!getEditor()) return "<b>MiMo Studio</b> - open <b>UltraSpeed</b> or <b>MiMo Chat</b> in a new chat, then reload.";
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
  const composerFileInput = () => {
    const frame = composerFrame();
    return (frame && frame.querySelector('input[type="file"]')) || document.querySelector('input[type="file"]');
  };
  // MiMo's upload input accepts images only while signed in, so vision is
  // offered only where an attachment can actually be delivered.
  const visionAvailable = () => {
    try { return !!getEditor() && !signedOut() && !!composerFileInput(); } catch { return false; }
  };
  const pendingAttachments = () => {
    try {
      const frame = composerFrame();
      if (!frame) return [];
      return [...frame.querySelectorAll("[class*='attachment' i], [class*='file-card' i], img[src^='blob:']")]
        .filter((n) => !n.closest("#message-list"));
    } catch { return []; }
  };
  const hasPendingAttachment = () => {
    if (pendingAttachments().length > 0) return true;
    try {
      const input = composerFileInput();
      return !!(input && input.files && input.files.length);
    } catch { return false; }
  };

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

  // "" = a transient chat with no conversation id. #/ultra and #/c are the
  // SHARED fresh-chat hashes, so keying them made the core persist "ultra"/"c"
  // as started session ids - a brand-new empty chat then showed "Agent active"
  // with no Start (same class as Gemini's /app bug). Real chats are #/*/<id>.
  const conversationKey = () => {
    const m = (location.hash || "").match(/#\/(?:ultra|c|chat|claw)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : "";
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
      if (S.stopAria.test(ariaOf(btn))) {
        if (_selfStop) return; // our own send-path unwedge
        handlers.onNativeStop();
        return;
      }
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
      if (pre.closest && pre.closest(".zs-chip, .zs-tool-hide")) continue;
      if (!CMD_SHAPE.test(pre.textContent || "")) continue;
      pre.classList.add("zs-tool-hide");
      // Shiki re-creates the wrapper on every stream tick, wiping this class;
      // the message column / markdown body keeps its identity, so mark it too
      // (see overlay.css html.zs-site-mimo rules).
      const body = pre.closest(".markdown-prose");
      if (body) body.classList.add("zs-cmd-mask");
      item.classList.add("zs-cmd-mask");
      const wrap = pre.parentElement;
      if (wrap) for (const label of wrap.querySelectorAll(".language-label, [class*='language-label' i]")) label.classList.add("zs-tool-hide");
      if (!ref) { parent = wrap; ref = pre; }
    }
    return ref ? { parent, ref } : null;
  }

  // ── Site rules (MiMo's own tools are a distraction, not a feature) ────────
  const MIMO_SITE_RULES =
    "MiMo Studio rules: this is a linked FeatherScript session for Roblox work. MiMo's own web " +
    "search, deep thinking, deep research, document/canvas tools and native function calls CANNOT " +
    "reach Roblox Studio - ignore them and never propose them while this chat is linked. The ONLY " +
    "way to act is to write the command as text in your reply: ONE complete JSON object in a fenced " +
    'json block (e.g. {"command": "execute_luau", "params": {...}}), or a ###LUA### … ###END_LUA### ' +
    "block for Luau. Writing the block IS the action - never say you cannot run commands or use JSON " +
    "blocks, never only describe a command, and never answer by creating a document or artifact. Do " +
    "not search the web - skills are read with the feather_getskills command, never found by searching. " +
    "Keep prose to one short line; the command block is the work. MiMo Chat and " +
    "UltraSpeed are separate conversations - never rely on an earlier page or chat. If MiMo reports " +
    "that the quota is used up, stop and ask the user to switch models or wait.";

  return {
    id: "mimo",
    displayName: "MiMo AI",
    // Only offered where an attachment control exists (see visionAvailable).
    get supportsVision() { return visionAvailable(); },
    timings,
    thinkingSel: "details[type='reasoning'], [type='reasoning']",
    get promptExtra() { return MIMO_SITE_RULES; },
    // The turn root is a flex ROW (avatar | content column). Anchor the chip in
    // the message column and trail it after the reply text (the model writes
    // its command at the end of the turn), like Kimi.
    chipAtItemLevel: true,
    chipAnchor: (item) => messageColumn(item) || item,
    chipAppend: true,
    reliableCounts: false,
    init({ diag: d } = {}) {
      if (d) diag = d;
      try { document.documentElement.setAttribute("data-zs-mimo-ver", "1"); } catch {}
      diag("mimo.init", {
        hasEditor: !!getEditor(), signIn: signedOut(), claw: isClaw(),
        route: location.hash, rows: allItems().length,
      });
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
