// SPDX-License-Identifier: GPL-3.0-or-later
// providers/mimo-net.js - MiMo Studio (aistudio.xiaomimimo.com) network tap +
// request shaper (MAIN world).
//
// MiMo has two chat products on the same origin:
//   UltraSpeed  POST /open-apis/bot/chat    (v2 SSE, <think> reasoning markers)
//   MiMo Chat   POST /open-apis/react/chat  (v3 SSE, reasoningContent frames)
// Both take { msgId, conversationId, query, isEditedQuery, previousDialogueId,
// sceneType, params, modelConfig, multiMedias } and stream SSE frames shaped
// `event: <name>` + `data: <json>` separated by a blank line (validated from the
// site's own bundle, 2026-11):
//   event "message"  data.content is an ANSWER DELTA (append, not a snapshot)
//   event "finish"   terminal          event "error" / "quota_alert" / "sensitive_query"
//   event "dialogId" / "usage" / "web_search" / "doc" / "tip_*" are not reply text.
// v3 also sends data.reasoningContent deltas; v1/v2 put <think> ... </think>
// (the v2 wire uses a NUL after each marker) inside data.content.
//
// WHY THIS EXISTS (two jobs):
//  1. REQUEST SHAPER. MiMo hands the model its own search / deep-thinking /
//     native-tool instructions; models then search the web or emit a native tool
//     call instead of the FeatherScript command block. FeatherScript's protocol
//     arrives as the USER query, so we pin a short protocol note to the TOP of
//     `query` on every outgoing chat request. On the same pass we force the
//     turn's web search OFF (modelConfig.webSearchStatus / webSearchMode = 0):
//     search is a server-side tool, not a model choice, and models kept firing
//     search calls even after the note told them the only channel is text.
//     Nothing on screen changes.
//  2. STREAM TAP. The DOM re-renders every token (Shiki code blocks, reasoning
//     <details>), which can split a fenced command. The tap folds the SSE deltas
//     into one verbatim answer string and publishes it into #zs-mimo-net, which
//     providers/mimo.js reads as the source of truth for the latest turn.
//
// Both jobs are gated on <html data-zs-mimo-agent="1">, set only when the agent
// actually starts. A normal MiMo chat is never touched.
// Registered with "world": "MAIN", run_at "document_start".
(() => {
  "use strict";
  if (window.__zsMimoNet) return;
  window.__zsMimoNet = true;

  const MARK = "[FeatherScript]";
  const CHAT_URL_RE = /\/open-apis\/(?:bot|react)\/chat(?:\?|$)/i;
  const PIN = [
    MARK + " This chat is live-linked to the user's Roblox Studio by a browser extension that EXECUTES the command you write and pastes the result back as the next user message.",
    "Reply with exactly ONE command as a complete JSON object inside a fenced code block labelled json - for example {\"command\": \"execute_luau\", \"params\": {\"code\": \"return workspace.Name\"}} - or a ###LUA### ... ###END_LUA### block for Studio code; then stop and wait for the result.",
    "Writing the block IS the tool call: never say you cannot run commands or use JSON blocks, never describe a command instead of writing it, and never show Luau in a bare lua fence without the ###LUA### markers (shown code is not executed).",
    "You are NOT being asked to execute anything yourself and you do not need any tool for this: the extension on this page runs the block the moment you post it. MiMo's own web search, deep thinking, deep research, document and code tools cannot reach Roblox Studio - ignore them while this chat is linked.",
    "Do not search the web and do not emit native function calls. Do not create a document, canvas or artifact, and do not propose MiMo tools - everything goes in this chat reply as text. One short line of prose at most; the command block is the work.",
    "Write the fence as real markdown: a line that is only ```, the block lines, a line that is only ```. Never escape backticks, quotes or braces with backslashes and never put the block inside quotation marks or inline code.",
  ].join(" ");

  const agentOn = () => {
    try { return document.documentElement.getAttribute("data-zs-mimo-agent") === "1"; } catch { return false; }
  };

  // ── Stream tap node ───────────────────────────────────────────────────────
  const NODE_ID = "zs-mimo-net";
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
  let activeRid = null;
  const publish = (obj) => {
    if (activeRid && obj.rid !== activeRid) return;
    try { node().textContent = JSON.stringify(obj); } catch {}
  };

  // One rid per outgoing request. providers/mimo.js records the rid it already
  // consumed, so a finished response from the PREVIOUS turn can never be read as
  // this turn's reply.
  let seq = 0;
  const newRid = () => `m${++seq}-${Date.now()}`;

  // ── Request shaping ───────────────────────────────────────────────────────
  const isChatBody = (body) => {
    if (typeof body !== "string" || body.length < 2 || body.length > 8 * 1024 * 1024) return false;
    if (body[0] !== "{") return false;
    if (!/"query"\s*:/.test(body)) return false;
    return /"conversationId"\s*:/.test(body) || /"msgId"\s*:/.test(body);
  };

  // Force the turn's web search off and prepend the protocol note to the
  // outgoing user query. Returns the new body string, or null when nothing had
  // to change.
  //
  // Web search on MiMo is a server-side built-in tool, and its on/off key moves
  // between model generations: v2 (UltraSpeed) sends modelConfig.webSearchMode,
  // v3 (MiMo Chat) sends modelConfig.webSearchStatus, and newer models (v2.6
  // Pro among them) carry it in their own nested configs. Patching one hard
  // -coded name silently missed every new shape, so search stayed enabled and
  // the model searched instead of calling feather_getskills. Match the KEY
  // instead: any search/research toggle anywhere in the request is forced off
  // (numbers to 0, booleans to false). Only toggles are touched - query text and
  // other string fields are never rewritten.
  const SEARCH_KEYS = new Set([
    "websearch", "websearchmode", "websearchstatus", "websearchenabled",
    "websearchenable", "websearchswitch", "websearchon", "websearchflag",
    "search", "searchmode", "searchstatus", "searchenabled", "enablesearch",
    "searchenable", "searchswitch", "searchflag", "searchon", "issearch",
    "usesearch", "searchtype", "searchlevel", "deepsearch", "deepsearchmode",
    "deepsearchstatus", "deepresearch", "deepresearchmode",
  ]);
  const normKey = (k) => String(k).replace(/[_\-\s]/g, "").toLowerCase();

  function disableSearchFlags(node, seen, underSearch) {
    if (!node || typeof node !== "object" || seen.has(node)) return false;
    seen.add(node);
    let changed = false;
    for (const key of Object.keys(node)) {
      const val = node[key];
      const here = underSearch || SEARCH_KEYS.has(normKey(key));
      if (val && typeof val === "object") {
        if (disableSearchFlags(val, seen, here)) changed = true;
        continue;
      }
      if (!here) continue;
      if (typeof val === "number" && val !== 0) { node[key] = 0; changed = true; }
      else if (typeof val === "boolean" && val) { node[key] = false; changed = true; }
    }
    return changed;
  }

  function shapeBody(body) {
    if (!agentOn()) return null;
    if (typeof body !== "string" || body.length < 2 || body.length > 8 * 1024 * 1024) return null;
    if (body[0] !== "{") return null;
    let obj;
    try { obj = JSON.parse(body); } catch { return null; }
    if (!obj || typeof obj !== "object" || typeof obj.query !== "string") return null;
    let changed = disableSearchFlags(obj, new Set(), false);
    if (obj.query.trim() && !obj.query.includes(MARK)) {
      obj.query = PIN + "\n\n" + obj.query;
      changed = true;
    }
    try { return changed ? JSON.stringify(obj) : null; } catch { return null; }
  }

  // ── Frame folding ─────────────────────────────────────────────────────────
  const pick = (o, keys) => {
    if (!o || typeof o !== "object") return "";
    for (const k of keys) if (typeof o[k] === "string" && o[k]) return o[k];
    return "";
  };
  const tryParse = (s) => { try { return JSON.parse(s); } catch { return null; } };

  // Stream message payloads are deltas, including repeated/identical tokens.
  // Guessing that a delta is a cumulative snapshot corrupts fast v2 streams.
  function appendContent(acc, chunk) {
    if (typeof chunk === "string") acc.raw += chunk;
  }
  function appendReasoning(acc, chunk) {
    if (typeof chunk === "string") acc.reasoning += chunk;
  }

  function eventData(obj) {
    if (!obj || typeof obj !== "object") return obj;
    if (obj.data === undefined) return obj;
    if (typeof obj.data === "string") return tryParse(obj.data) || obj;
    return obj.data && typeof obj.data === "object" ? obj.data : obj;
  }

  // Fold one SSE event. Returns true when it carried reply text / a terminal
  // state (used by the XHR reader to know it saw a stream).
  function foldEvent(event, obj, acc) {
    const name = String(event || "").toLowerCase();
    const d = eventData(obj);
    const content = pick(d, ["content", "delta", "text"]);
    const reasoning = pick(d, ["reasoningContent", "reasoning_content", "reasoning"]);
    if (name === "message" || name === "delta" || name === "chunk" || name === "token") {
      if (content) appendContent(acc, content);
      if (reasoning) appendReasoning(acc, reasoning);
      return true;
    }
    if (!name) {
      // No event line: accept plain data frames that carry text.
      if (content) appendContent(acc, content);
      if (reasoning) appendReasoning(acc, reasoning);
      return !!(content || reasoning);
    }
    if (name === "finish" || name === "done" || name === "complete" || name === "message.complete") {
      if (content && content !== acc.raw) {
        if (acc.raw && content.startsWith(acc.raw)) acc.raw = content;
        else appendContent(acc, content);
      }
      acc.done = true;
      return true;
    }
    if (name === "error") {
      acc.err = String(content || pick(d, ["message", "msg", "error"]) || "stream error").slice(0, 240);
      acc.done = true;
      return true;
    }
    if (name === "quota_alert") {
      acc.err = String(content || pick(d, ["message", "msg"]) || "MiMo quota is used up").slice(0, 240);
      acc.done = true;
      return true;
    }
    if (name === "sensitive_query") {
      acc.err = String(content || "MiMo rejected this message (sensitive content).").slice(0, 240);
      acc.done = true;
      return true;
    }
    // dialogId / usage / web_search / doc / tip_ratio / tip_truncate /
    // sensitive_title carry no reply text.
    return false;
  }

  function foldFrame(frame, acc) {
    let event = "";
    const data = [];
    for (const line of String(frame || "").split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^\s/, ""));
    }
    if (!data.length) return false;
    const js = data.join("\n").trim();
    if (!js) return false;
    if (js === "[DONE]") { acc.done = true; return true; }
    const obj = tryParse(js);
    if (!obj || typeof obj !== "object") return false;
    return foldEvent(event, obj, acc);
  }

  // ── Reasoning split ───────────────────────────────────────────────────────
  // v1/v2 put reasoning inside data.content as <think>...</think> (v2 puts a NUL
  // after each marker). v3 sends reasoningContent separately. The reply the
  // extension parses must never contain the model's private notes.
  const stripTags = (s) => String(s || "")
    .replace(/<summary>[\s\S]*?<\/summary>/gi, "")
    .replace(/<[^>]+>/g, "");

  function splitAnswer(acc) {
    let s = String(acc.raw || "").replace(/\u0000/g, "");
    let thinking = String(acc.reasoning || "");
    s = s.replace(/<details\s+type=["']reasoning["'][^>]*>([\s\S]*?)<\/details>/gi, (m, inner) => {
      thinking += "\n" + stripTags(inner);
      return "";
    });
    s = s.replace(/<think>\s*([\s\S]*?)\s*<\/think>/gi, (m, inner) => {
      thinking += "\n" + inner;
      return "";
    });
    const openDetails = s.search(/<details\s+[^>]*type=["']reasoning["'][^>]*>/i);
    if (openDetails >= 0) {
      thinking += "\n" + stripTags(s.slice(openDetails));
      s = s.slice(0, openDetails);
    }
    const open = s.toLowerCase().lastIndexOf("<think>");
    if (open >= 0) {
      thinking += "\n" + s.slice(open + 7);
      s = s.slice(0, open);
    }
    return {
      text: s.replace(/[ \t]+\n/g, "\n").trim(),
      thinking: thinking.trim(),
    };
  }

  // ── SSE reader ────────────────────────────────────────────────────────────
  async function readStream(resp, st) {
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    const acc = { rid: st.rid, startedAt: st.startedAt, raw: "", reasoning: "", done: false, err: "" };
    let buf = "";
    let lastEmit = 0;
    const emit = (force) => {
      const now = Date.now();
      if (!force && now - lastEmit < 120) return;
      lastEmit = now;
      const s = splitAnswer(acc);
      publish({
        rid: acc.rid, startedAt: st.startedAt, text: s.text, reasoning: s.thinking,
        done: acc.done, err: acc.err, t: now,
      });
    };
    emit(true);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf = (buf + dec.decode(value, { stream: true })).replace(/\r\n/g, "\n");
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          foldFrame(buf.slice(0, idx), acc);
          buf = buf.slice(idx + 2);
        }
        emit(false);
        if (acc.done) break;
      }
      buf = (buf + dec.decode()).replace(/\r\n/g, "\n");
      if (buf.trim()) foldFrame(buf, acc);
    } catch (e) {
      acc.err = String((e && e.message) || e).slice(0, 240);
    }
    acc.done = true;
    emit(true);
  }

  // Depth-limited search for the reply text in a non-SSE JSON reply.
  function findText(o, depth, cap) {
    if (!o || typeof o !== "object" || depth > 4) return cap;
    if (Array.isArray(o)) {
      for (let i = 0; i < o.length && i < 20; i++) findText(o[i], depth + 1, cap);
      return cap;
    }
    if (!cap.content && typeof o.content === "string" && o.content) cap.content = o.content;
    if (!cap.reasoning && typeof o.reasoningContent === "string" && o.reasoningContent) cap.reasoning = o.reasoningContent;
    for (const k of Object.keys(o)) {
      if (k === "content" || k === "reasoningContent") continue;
      const v = o[k];
      if (v && typeof v === "object" && findText(v, depth + 1, cap).content) break;
    }
    return cap;
  }

  async function readJson(resp, st) {
    let err = "";
    const cap = { content: "", reasoning: "" };
    try {
      const o = await resp.json();
      findText(o, 0, cap);
      if (!cap.content && !cap.reasoning) {
        const e = o && (o.message || o.msg || (o.error && (o.error.message || o.error)));
        if (e) err = String(e).slice(0, 240);
      }
    } catch (e) {
      err = String((e && e.message) || e).slice(0, 240);
    }
    const s = splitAnswer({ raw: cap.content, reasoning: cap.reasoning });
    publish({
      rid: st.rid, startedAt: st.startedAt, text: s.text, reasoning: s.thinking,
      done: true, err, t: Date.now(),
    });
  }

  // MiMo replies with SSE; treat anything not declared JSON as a stream so a
  // missing/renamed content-type cannot silently turn the tap off.
  const looksStream = (resp) => {
    try {
      const ct = (resp.headers && resp.headers.get("content-type")) || "";
      return !/json/i.test(ct);
    } catch { return true; }
  };

  // A failed request is reported as a finished turn carrying `err`, so the
  // provider surfaces "server busy" / "quota used up" / 429 instead of waiting
  // for a reply that will never arrive.
  function watchResponse(p, st) {
    try {
      p.then(async (res) => {
        try {
          if (!res) {
            publish({ rid: st.rid, startedAt: st.startedAt, text: "", reasoning: "", done: true, err: "no response", status: 0, t: Date.now() });
            return;
          }
          if (!res.ok) {
            let body = "";
            try { body = (await res.clone().text()).slice(0, 300); } catch {}
            publish({ rid: st.rid, startedAt: st.startedAt, text: "", reasoning: "", done: true, err: body || "HTTP " + res.status, status: res.status, t: Date.now() });
            return;
          }
          if (!res.body) {
            publish({ rid: st.rid, startedAt: st.startedAt, text: "", reasoning: "", done: true, err: "", status: res.status, t: Date.now() });
            return;
          }
          if (looksStream(res)) readStream(res.clone(), st);
          else readJson(res.clone(), st);
        } catch {}
      }).catch(() => {
        publish({ rid: st.rid, startedAt: st.startedAt, text: "", reasoning: "", done: true, err: "request failed", t: Date.now() });
      });
    } catch {}
  }

  const openState = (st) => { activeRid = st.rid; publish({
    rid: st.rid, startedAt: st.startedAt, text: "", reasoning: "", done: false, err: "", t: Date.now(),
  }); };

  // ── fetch ─────────────────────────────────────────────────────────────────
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (...args) {
      try {
        if (!agentOn()) return origFetch.apply(this, args);
        const input = args[0];
        const init = args[1];

        const shapeAndWatch = (url, body) => {
          const patched = shapeBody(body);
          const st = { rid: newRid(), startedAt: Date.now() };
          openState(st);
          const nextInit = patched ? Object.assign({}, init, { body: patched }) : init;
          const p = body === undefined && !init ? origFetch.call(this, input) : origFetch.call(this, input, nextInit);
          watchResponse(p, st);
          return p;
        };

        if (typeof Request !== "undefined" && input instanceof Request && !(init && init.body != null)) {
          const req = new Request(input, init);
          if (req.method.toUpperCase() === "POST" && CHAT_URL_RE.test(req.url)) {
            // Handle body-read failure separately: a network rejection must never
            // re-enter origFetch and submit a second copy of the same message.
            return req.clone().text().then((body) => {
              const patched = shapeBody(body);
              const st = { rid: newRid(), startedAt: Date.now() };
              openState(st);
              const next = patched ? new Request(req, { body: patched }) : req;
              const response = origFetch.call(this, next);
              watchResponse(response, st);
              return response;
            }, () => origFetch.call(this, req));
          }
          return origFetch.apply(this, args);
        }

        const url = input instanceof Request ? input.url : String(input || "");
        const method = String((init && init.method) || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
        const body = init && typeof init.body === "string" ? init.body : "";
        if (method === "POST" && (CHAT_URL_RE.test(url) || isChatBody(body))) {
          return shapeAndWatch(url, init && init.body !== undefined ? init.body : undefined);
        }
      } catch {}
      return origFetch.apply(this, args);
    };
  }

  // ── XMLHttpRequest (MiMo uses fetch today; a transport change cannot switch
  // the pin off) ────────────────────────────────────────────────────────────
  try {
    const XP = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (XP && XP.open && XP.send) {
      const origOpen = XP.open, origSend = XP.send;
      XP.open = function (method, url, ...rest) {
        try {
          this.__zsMUrl = String(url || "");
          this.__zsMMethod = String(method || "GET").toUpperCase();
        } catch {}
        return origOpen.call(this, method, url, ...rest);
      };
      XP.send = function (body) {
        try {
          if (agentOn() && this.__zsMMethod === "POST" && typeof body === "string" &&
              (CHAT_URL_RE.test(this.__zsMUrl || "") || isChatBody(body))) {
            const patched = shapeBody(body);
            if (patched) body = patched;
            const st = { rid: newRid(), startedAt: Date.now() };
            openState(st);
            const xhr = this;
            xhr.addEventListener("load", () => {
              let raw = "";
              try { raw = xhr.responseText || ""; } catch {}
              const acc = { rid: st.rid, startedAt: st.startedAt, raw: "", reasoning: "", done: true, err: "" };
              if (xhr.status < 200 || xhr.status >= 300) acc.err = raw.slice(0, 300) || "HTTP " + xhr.status;
              else {
                for (const frame of String(raw).replace(/\r\n/g, "\n").split("\n\n")) if (frame.trim()) foldFrame(frame, acc);
                if (!acc.err && !acc.done) {
                  const o = tryParse(raw);
                  if (o) foldEvent("", o, acc);
                }
              }
              acc.done = true;
              const s = splitAnswer(acc);
              publish({
                rid: acc.rid, startedAt: st.startedAt, text: s.text, reasoning: s.thinking,
                done: true, err: acc.err, status: xhr.status, t: Date.now(),
              });
            });
          }
        } catch {}
        return origSend.call(this, body);
      };
    }
  } catch {}

  try { document.documentElement.setAttribute("data-zs-mimo-net", "1"); } catch {}
})();
