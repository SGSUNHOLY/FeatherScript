// SPDX-License-Identifier: GPL-3.0-or-later
// providers/vani-net.js - Vani Chat network tap + request shaper (MAIN world).
//
// WHY THIS EXISTS (two separate jobs):
//  1. REQUEST SHAPER. Vani prepends its own ~700-token platform prompt (web
//     search first, Document / Slides / Design side panels, "tools" the model
//     may propose), and it hands the model its own tool list on a logged-in
//     account. Models then drift: they search the web before answering, write a
//     "document" instead of a command, or answer "I can't use JSON blocks".
//     FeatherScript's protocol arrives in a USER message, after Vani's prompt, so
//     we pin a short protocol note at the TOP of the LAST user message on every
//     outgoing chat request. Nothing on screen changes - the page's own transcript
//     state is untouched; only the request body is shaped.
//  2. STREAM TAP. Vani streams SSE deltas; the DOM re-renders them (a fenced
//     command can be split across line elements). The tap folds the deltas into
//     one verbatim string and publishes it into #zs-vani-net, which
//     providers/vani.js reads as the source of truth for the latest turn.
//
// Both jobs are gated on <html data-zs-vani-agent="1">, which providers/vani.js
// sets when the agent actually starts (ensureComposerReady / typeAndSend). A
// normal Vani chat with the extension installed but not started is never touched.
// Registered as a content script with "world": "MAIN", run_at "document_start"
// so the fetch wrap is installed before Vani's app uses it.
(() => {
  "use strict";
  if (window.__zsVaniNet) return;
  window.__zsVaniNet = true;

  // Marker so a second pass over the same body does not pin twice.
  const MARK = "[FeatherScript]";
  const CHAT_URL_RE = /\/api\/(public\/chat|chat\/stream|chat\/completions|chat|conversations\/[^/]+\/messages|messages)(\?|$)/i;
  const PIN = [
    MARK + " This chat is live-linked to the user's Roblox Studio by a browser extension that EXECUTES the command you write and pastes the result back as the next user message.",
    "Reply with exactly ONE command as a complete JSON object inside a fenced code block labelled json - for example {\"command\": \"execute_luau\", \"params\": {\"code\": \"return workspace.Name\"}} - or a ###LUA### ... ###END_LUA### block for Studio code; then stop and wait for the result.",
    "Writing the block IS the tool call: never say you cannot run commands or use JSON blocks, never describe a command instead of writing it, and never show Luau in a bare lua fence without the ###LUA### markers (shown code is not executed).",
    "You are NOT being asked to execute anything yourself and you do not need any tool for this: the extension on this page runs the block the moment you post it. Vani's own tools (web search, Document, Slides, Design, code execution) cannot reach Roblox Studio - ignore them while this chat is linked.",
    "Do not search the web. Do not create a Document, Slides, Design, canvas or any side-panel artifact, and do not propose Vani tools - everything goes in this chat reply as text. One short line of prose at most; the command block is the work.",
    "Write the fence as real markdown: a line that is only ```, the block lines, a line that is only ```. Never escape backticks, quotes or braces with backslashes and never put the block inside quotation marks or inline code.",
  ].join(" ");

  const agentOn = () => {
    try { return document.documentElement.getAttribute("data-zs-vani-agent") === "1"; } catch { return false; }
  };

  // ── Stream tap node ───────────────────────────────────────────────────────
  const NODE_ID = "zs-vani-net";
  const node = () => {
    let n = document.getElementById(NODE_ID);
    if (!n) {
      n = document.createElement("script");
      n.type = "application/json";
      n.id = NODE_ID;
      (document.body || document.documentElement).appendChild(n);
    }
    return n;
  };
  const publish = (obj) => { try { node().textContent = JSON.stringify(obj); } catch {} };

  // One rid per outgoing request. providers/vani.js records the rid it has
  // already consumed, so a finished response from the PREVIOUS turn can never be
  // read as this turn's reply.
  let seq = 0;
  const newRid = () => `v${++seq}-${Date.now()}`;

  const contentText = (c) => {
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map((p) => (p && typeof p.text === "string" ? p.text : "")).join("\n");
    if (c && typeof c === "object" && typeof c.text === "string") return c.text;
    return "";
  };
  const textField = (m) => {
    if (!m || typeof m !== "object") return "";
    for (const k of ["content", "text", "message", "parts"]) if (m[k] != null && contentText(m[k])) return k;
    return "";
  };
  function withPrefix(c, prefix) {
    if (typeof c === "string") return prefix + c;
    if (Array.isArray(c)) {
      const i = c.findIndex((p) => p && typeof p.text === "string");
      if (i === -1) return undefined;
      const out = c.slice(); out[i] = Object.assign({}, c[i], { text: prefix + c[i].text }); return out;
    }
    if (c && typeof c === "object" && typeof c.text === "string") return Object.assign({}, c, { text: prefix + c.text });
    return undefined;
  }

  // Prepend the protocol note to the last user message. Returns the new body
  // string, or null when nothing had to change.
  function pinBody(body) {
    if (!agentOn()) return null;
    if (typeof body !== "string" || body.length < 2 || body.length > 8 * 1024 * 1024) return null;
    if (body[0] !== "{" || !/"messages"\s*:/.test(body)) return null;
    let obj;
    try { obj = JSON.parse(body); } catch { return null; }
    if (!obj || !Array.isArray(obj.messages) || !obj.messages.length) return null;
    let li = -1;
    for (let i = obj.messages.length - 1; i >= 0; i--) if (obj.messages[i] && obj.messages[i].role === "user") { li = i; break; }
    if (li < 0) return null;
    const m = obj.messages[li];
    const k = textField(m) || "content";
    const text = contentText(m[k]);
    if (!text || text.includes(MARK)) return null;
    const nc = withPrefix(m[k], PIN + "\n\n");
    if (nc === undefined) return null;
    obj.messages[li] = Object.assign({}, m, { [k]: nc });
    try { obj.messages = obj.messages; } catch {}
    try { return JSON.stringify(obj); } catch { return null; }
  }

  // ── SSE folding ───────────────────────────────────────────────────────────
  // Vani: data:{"type":"content.delta","text":…} … {"type":"message.complete"}
  // OpenAI-ish shapes are accepted too, so a transport change keeps working.
  function foldLine(line, acc) {
    const s = line.trim();
    if (!s.startsWith("data:")) return acc;
    const js = s.slice(5).trim();
    if (!js) return acc;
    if (js === "[DONE]") { acc.done = true; return acc; }
    let o;
    try { o = JSON.parse(js); } catch { return acc; }
    const type = String(o.type || o.event || "").toLowerCase();
    if (type === "message.complete" || type === "response.completed" || type === "done" || type === "message.completed") {
      acc.done = true;
      return acc;
    }
    if (type === "error" || o.error) {
      const e = o.error || o;
      acc.err = String((e && (e.message || e.text || e.code)) || "stream error").slice(0, 200);
      acc.done = true;
      return acc;
    }
    // Text deltas, whichever envelope Vani ships today. Reasoning/thinking
    // streams are excluded: folding them into the reply would put the model's
    // internal notes in front of the command it wrote.
    const answer = !/reason|think|thought|analysis|plan/.test(type);
    const pieces = [];
    if (answer && typeof o.text === "string" && /delta|chunk|token|content|part|text/.test(type)) pieces.push(o.text);
    if (answer && typeof o.delta === "string") pieces.push(o.delta);
    if (answer && o.delta && typeof o.delta === "object" && typeof o.delta.text === "string") pieces.push(o.delta.text);
    const d = o.choices && o.choices[0] && o.choices[0].delta;
    if (d && typeof d.content === "string") pieces.push(d.content);
    if (pieces.length) acc.text += pieces.join("");
    return acc;
  }

  async function readStream(resp, st) {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const acc = { rid: st.rid, text: "", done: false, err: "" };
    const emit = () => publish({ rid: acc.rid, startedAt: st.startedAt, text: acc.text, done: acc.done, err: acc.err, t: Date.now() });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n")) >= 0) {
          foldLine(buf.slice(0, idx), acc);
          buf = buf.slice(idx + 1);
        }
        emit();
        if (acc.done) break;
      }
      if (buf) foldLine(buf, acc);
    } catch (e) { acc.err = String(e && e.message || e).slice(0, 200); }
    acc.done = true;
    emit();
  }

  // Non-SSE reply (Vani answers some endpoints with plain JSON). Always publishes
  // a final state so the reader never waits out the "thinking" bound on a reply
  // it could not parse.
  async function readJson(resp, st) {
    let text = "", err = "";
    try {
      const o = await resp.json();
      const msg = (o && (o.message || o.reply || o.text)) || (o && o.choices && o.choices[0] && o.choices[0].message) || null;
      text = typeof msg === "string" ? msg : contentText(msg && (msg.content || msg.text));
      if (!text && o && o.error) err = String(o.error.message || o.error.code || o.error).slice(0, 200);
    } catch (e) { err = String(e && e.message || e).slice(0, 200); }
    publish({ rid: st.rid, startedAt: st.startedAt, text, done: true, err, t: Date.now() });
  }

  // Vani replies with SSE; treat anything that is not declared JSON as a stream
  // so a missing/renamed content-type cannot silently turn the tap off.
  const looksStream = (resp) => {
    try {
      const ct = (resp.headers && resp.headers.get("content-type")) || "";
      return !/json/i.test(ct);
    } catch { return true; }
  };

  // A failed request is reported as a finished turn with the body as `err`, so
  // the provider surfaces "allowance used up" / "one reply at a time" instead of
  // waiting for a reply that will never arrive.
  function watchResponse(p, url, st) {
    try {
      p.then(async (res) => {
        try {
          if (!res) { publish({ rid: st.rid, startedAt: st.startedAt, text: "", done: true, err: "no response", status: 0, t: Date.now() }); return; }
          if (!res.ok) {
            let body = "";
            try { body = (await res.clone().text()).slice(0, 300); } catch {}
            publish({ rid: st.rid, startedAt: st.startedAt, text: "", done: true, err: body || "HTTP " + res.status, status: res.status, t: Date.now() });
            return;
          }
          if (!res.body) { publish({ rid: st.rid, startedAt: st.startedAt, text: "", done: true, err: "", status: res.status, t: Date.now() }); return; }
          if (looksStream(res)) readStream(res.clone(), st);
          else readJson(res.clone(), st);
        } catch {}
      }).catch(() => { publish({ rid: st.rid, startedAt: st.startedAt, text: "", done: true, err: "request failed", t: Date.now() }); });
    } catch {}
  }

  // ── fetch ─────────────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (...args) {
      try {
        if (!agentOn()) return origFetch.apply(this, args);
        const input = args[0];
        const init = args[1];
        // Shape a string body, then watch the response of a chat request.
        const shapeAndWatch = (url, body) => {
          const patched = pinBody(body);
          const st = { rid: newRid(), startedAt: Date.now() };
          publish({ rid: st.rid, startedAt: st.startedAt, text: "", done: false, err: "", t: Date.now() });
          const nextInit = patched ? Object.assign({}, init, { body: patched }) : init;
          const p = body === undefined && !init ? origFetch.call(this, input) : origFetch.call(this, input, nextInit);
          watchResponse(p, url, st);
          return p;
        };
        if (typeof Request !== "undefined" && input instanceof Request && !(init && init.body != null)) {
          const method = String(input.method || "GET").toUpperCase();
          if (method === "POST" && (CHAT_URL_RE.test(input.url || "") || /json/i.test((input.headers && input.headers.get("content-type")) || ""))) {
            const req = input;
            return req.clone().text().then((body) => {
              const patched = pinBody(body);
              const st = { rid: newRid(), startedAt: Date.now() };
              publish({ rid: st.rid, startedAt: st.startedAt, text: "", done: false, err: "", t: Date.now() });
              const p = patched ? origFetch.call(this, new Request(req, { body: patched })) : origFetch.call(this, req);
              watchResponse(p, req.url, st);
              return p;
            }).catch(() => origFetch.apply(this, args));
          }
          return origFetch.apply(this, args);
        }
        const url = input instanceof Request ? input.url : String(input || "");
        const method = String((init && init.method) || "GET").toUpperCase();
        const body = init && typeof init.body === "string" ? init.body : "";
        if (method === "POST" && (CHAT_URL_RE.test(url) || (body[0] === "{" && /"messages"\s*:\s*\[/.test(body)))) {
          return shapeAndWatch(url, init && init.body !== undefined ? init.body : undefined);
        }
      } catch {}
      return origFetch.apply(this, args);
    };
  }

  // ── XMLHttpRequest (not used by Vani today; a transport change cannot switch
  // the pin off) ─────────────────────────────────────────────────────────────
  try {
    const XP = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (XP && XP.open && XP.send) {
      const origOpen = XP.open, origSend = XP.send;
      XP.open = function (method, url, ...rest) {
        try { this.__zsVUrl = String(url || ""); this.__zsVMethod = String(method || "GET").toUpperCase(); } catch {}
        return origOpen.call(this, method, url, ...rest);
      };
      XP.send = function (body) {
        try {
          if (agentOn() && this.__zsVMethod === "POST" && typeof body === "string") {
            const patched = pinBody(body);
            if (patched) body = patched;
          }
        } catch {}
        return origSend.call(this, body);
      };
    }
  } catch {}

  try { document.documentElement.setAttribute("data-zs-vani-net", "1"); } catch {}
})();
