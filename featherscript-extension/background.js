// SPDX-License-Identifier: GPL-3.0-or-later
// background.js - service worker.
// Owns ONE resilient WebSocket to the local bridge (ws://127.0.0.1:PORT).
// Keeping the socket here (not in the content script) avoids https→ws mixed
// content issues and centralises reconnect / timeout logic.
//
// Contract with content.js: every sendMessage ALWAYS gets a response object,
// even when the bridge is offline. The agentic loop must never hang waiting.

importScripts("core/theme-presets.js");
importScripts("core/commands.js");
importScripts("core/audio-broker.js");
const extensionAudio = ZSAudioBroker.create(chrome, {broadcast: broadcastAudio});
const themeIds = new Set(["auto", ...FSThemePresets.map((preset) => preset.id)]);

const PORT = 17613;
const URL = `ws://127.0.0.1:${PORT}`;

// Chat sites where a FeatherScript provider content script runs. Status pushes go
// to every tab matching these. Add the new provider's URL pattern here (and in
// manifest.json content_scripts + host_permissions) when integrating another AI.
const PROVIDER_URLS = ["https://aistudio.google.com/*", "https://chat.deepseek.com/*", "https://chatgpt.com/*", "https://chat.openai.com/*", "https://gemini.google.com/*", "https://www.kimi.ai/*", "https://kimi.ai/*", "https://chat.z.ai/*", "https://chat.qwen.ai/*", "https://arena.ai/*", "https://www.meta.ai/*", "https://meta.ai/*", "https://c.vani.ai/*", "https://www.notion.so/*", "https://notion.so/*", "https://app.notion.com/*", "https://aistudio.xiaomimimo.com/*", "https://www.genspark.ai/*", "https://genspark.ai/*"];

const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 5000;
// A socket that never finishes its handshake (bridge wedged mid-accept) would
// otherwise sit in CONNECTING forever: waitForConnection would time out on every
// call and the reconnect path would never run.
const CONNECT_TIMEOUT_MS = 7000;
const HEARTBEAT_MS = 10000;
// If no message (incl. pong) arrives within this window while we believe we're
// connected, the socket is half-open: force a reconnect instead of letting
// pending requests slowly time out.
const STALE_SOCKET_MS = 25000;
const REQUEST_TIMEOUT_DEFAULT = 130000; // a bit above the 120s tool timeout
// MV3 terminates an idle service worker, taking setTimeout with it. While the
// worker is alive we retry on a timer; this alarm is the backstop that wakes it
// back up (Chrome clamps periods below one minute, so 1 min is the floor).
const RECONNECT_ALARM = "zs-reconnect";
const RECONNECT_ALARM_MINUTES = 1;

let ws = null;
let connected = false;
let reconnectDelay = RECONNECT_MIN;
let reconnectTimer = null;
let connectTimer = null;
let heartbeatTimer = null;
let bridgeIdentity = null, reconnectCount = 0, ackLatency = null;
const commandInFlight = new Map(), commandResults = new Map();
let lastMessageAt = 0; // timestamp of the last frame received from the bridge
let nextId = 1;
const pending = new Map(); // id -> {resolve, timer}
// Callers parked in waitForConnection. Resolved together when a socket opens.
let openWaiters = [];
let toolsCache = [];
let skillsCache = [];
let mcpAlive = false;
let serversCache = [];
// true/false = a PLACE is loaded and usable in Roblox Studio; null = unknown.
// The MCP process stays alive when Studio is closed or its MCP option is off,
// so this is probed separately (bridge "studio_status").
let studioConnected = null;
// true/false = a Roblox Studio app is connected to the MCP server at all; null =
// unknown. studioApp=true with studioConnected=false means "Studio open but no
// place"; studioApp=false means "Studio closed OR its MCP option disabled".
let studioApp = null;
// true/false = a Roblox Studio WINDOW/PROCESS exists on this machine (checked
// bridge-side via tasklist); null = unknown/old bridge. Distinguishes the two
// studioApp=false sub-cases the UI must word differently: Studio genuinely not
// launched ("open Roblox Studio") vs Studio OPEN but its MCP plugin never
// registered with the bridge - the documented fix for the latter is opening
// Assistant Settings > MCP Servers inside Studio (validated live 3x), which
// "open Roblox Studio" wording completely fails to convey.
let studioProc = null;

function log(...a) {
  console.log("[zs-bg]", ...a);
}

const isOpen = () => connected && ws !== null && ws.readyState === WebSocket.OPEN;

// ── WebSocket lifecycle ─────────────────────────────────────────────────
function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  let sock;
  try {
    sock = new WebSocket(URL);
  } catch (e) {
    log("WebSocket ctor failed", e);
    scheduleReconnect();
    return;
  }
  ws = sock;
  clearTimeout(connectTimer);
  connectTimer = setTimeout(() => {
    if (sock === ws && sock.readyState === WebSocket.CONNECTING) {
      log("connect timed out, retrying");
      try { sock.close(); } catch {}
    }
  }, CONNECT_TIMEOUT_MS);

  // Every handler checks that ITS socket is still the live one: a superseded
  // socket's late onclose/onerror must never tear down the connection that
  // replaced it (that race silently failed every in-flight request).
  sock.onopen = () => {
    if (sock !== ws) return;
    clearTimeout(connectTimer);
    connected = true;
    reconnectCount++;
    reconnectDelay = RECONNECT_MIN;
    lastMessageAt = Date.now();
    log("connected to bridge");
    clearReconnectAlarm();
    startHeartbeat();
    flushOpenWaiters();
    broadcastStatus();
  };

  sock.onmessage = (ev) => {
    if (sock !== ws) return;
    lastMessageAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    try {
      handleBridgeMessage(msg);
    } catch (e) {
      log("bad bridge message", e);
    }
  };

  sock.onclose = () => {
    if (sock !== ws) return;
    clearTimeout(connectTimer);
    ws = null;
    connected = false;
    mcpAlive = false;
    studioConnected = null;
    studioApp = null;
    studioProc = null;
    serversCache = [];
    stopHeartbeat();
    failAllPending("bridge connection closed");
    broadcastStatus();
    scheduleReconnect();
  };

  sock.onerror = () => {
    // onclose will follow; nothing to do here but avoid an unhandled error.
    if (sock !== ws) return;
    try { sock.close(); } catch {}
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.7, RECONNECT_MAX);
  ensureReconnectAlarm();
}

function ensureReconnectAlarm() {
  try {
    if (chrome.alarms) chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: RECONNECT_ALARM_MINUTES });
  } catch {}
}

function clearReconnectAlarm() {
  try {
    if (chrome.alarms) chrome.alarms.clear(RECONNECT_ALARM);
  } catch {}
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!isOpen()) return;
    // Half-open socket: the WS still reports OPEN but nothing comes through.
    // The pong (and every other frame) refreshes lastMessageAt; if it has
    // gone stale, drop the dead socket so onclose triggers a reconnect.
    if (lastMessageAt && Date.now() - lastMessageAt > STALE_SOCKET_MS) {
      log("socket stale, forcing reconnect");
      try { ws.close(); } catch {}
      return;
    }
    // Keeps the MV3 service worker alive AND detects a half-open socket.
    send({ type: "ping" }).catch(() => {});
    refreshStudioStatus();
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function flushOpenWaiters() {
  const waiters = openWaiters;
  openWaiters = [];
  for (const w of waiters) {
    clearTimeout(w.timer);
    w.resolve(true);
  }
}

// Resolve once the socket is OPEN (event-driven, no polling), or false after
// `timeout` ms.
function waitForConnection(timeout = 8000) {
  if (isOpen()) return Promise.resolve(true);
  connect(); // nudge a (re)connection - important after a worker wake-up
  return new Promise((resolve) => {
    const waiter = { resolve, timer: null };
    waiter.timer = setTimeout(() => {
      const i = openWaiters.indexOf(waiter);
      if (i >= 0) openWaiters.splice(i, 1);
      resolve(isOpen());
    }, timeout);
    openWaiters.push(waiter);
  });
}

// ── request/response over the socket ────────────────────────────────────
async function send(obj, timeout = REQUEST_TIMEOUT_DEFAULT, tabId = null) {
  // The MV3 service worker can be suspended; the first message after a wake-up
  // arrives before the socket has re-opened. Wait for it instead of failing -
  // otherwise Kimi wrongly hears "bridge offline".
  if (!isOpen()) await waitForConnection(8000);
  return new Promise((resolve) => {
    if (!isOpen()) {
      resolve({ ok: false, kind: "disconnected", error: "bridge not connected" });
      return;
    }
    const id = nextId++;
    const sock = ws;
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        const entry=pending.get(id);clearTimeout(entry.ackTimer);clearTimeout(entry.parkTimer);pending.delete(id);
        resolve({ ok: false, kind: obj.command_id ? "indeterminate" : "timeout", may_have_executed:!!obj.command_id, error: "No final bridge result arrived. Inspect state before retrying a write." });
      }
    }, timeout);
    const entry={ resolve, timer, obj, tabId, command_id:obj.command_id, bridge_id:obj.bridge_id, sentAt:Date.now(), acked:false };
    pending.set(id,entry);
    if(obj.command_id)entry.ackTimer=setTimeout(()=>resolvePending(id,{ok:false,kind:'unacknowledged',may_have_executed:true,error:'The bridge did not acknowledge this submitted command. Do not blindly retry.'}),8000);

    try {
      sock.send(JSON.stringify({ ...obj, id }));
      publishCommandState(entry,"sent");
    } catch (e) {
      clearTimeout(timer);clearTimeout(entry.ackTimer);clearTimeout(entry.parkTimer);
      pending.delete(id);
      resolve({ ok: false, kind: "disconnected", error: String(e) });
    }
  });
}

// Ask the bridge whether a Roblox Studio instance is actually connected to the
// MCP server. Broadcasts only on change so the UI updates promptly but quietly.
let studioProbing = false;
async function refreshStudioStatus() {
  if (studioProbing || !connected) return;
  studioProbing = true;
  try {
    const r = await send({ type: "studio_status" }, 12000);
    // A timeout or a dropped socket says nothing about Studio - keep the last
    // known value instead of flashing the status back to "unknown" (which the
    // UI renders as a grey dot) every time a probe is slow.
    if (!r || !r.ok) return;
    const v = typeof r.studio === "boolean" ? r.studio : null;
    if (v !== studioConnected) {
      studioConnected = v;
      broadcastStatus();
    }
  } finally {
    studioProbing = false;
  }
}

function publishCommandState(request,state) {
  if(!request?.tabId || !request.command_id)return;
  try {const result=chrome.tabs.sendMessage(request.tabId,{type:'zs-command-state',command_id:request.command_id,state});result?.catch?.(()=>{});}catch{}
}
function handleBridgeMessage(msg) {
  if(msg.type==='call_ack' || msg.type==='command_state') {
    const request=pending.get(msg.id);
    if(request && request.command_id===msg.command_id){
      if(msg.type==='call_ack'){clearTimeout(request.ackTimer);request.acked=true;const latency=Date.now()-request.sentAt;ackLatency=ackLatency===null?latency:ackLatency*.8+latency*.2;}
      publishCommandState(request,msg.state);
    }
    return; // ACK is not a result.
  }
  if(msg.type==='command_status'){resolvePending(msg.id,msg);return;}
  if (themeIds.has(msg.theme)) {
    try {
      chrome.storage.local.get("zsTheme")
        .then(({ zsTheme }) => {
          if (zsTheme !== msg.theme) return chrome.storage.local.set({ zsTheme: msg.theme });
        })
        .catch(() => {});
    } catch {}
  }
  if ("studio" in msg && (typeof msg.studio === "boolean" || msg.studio === null)) {
    studioConnected = msg.studio;
  }
  if ("studio_app" in msg && (typeof msg.studio_app === "boolean" || msg.studio_app === null)) {
    studioApp = msg.studio_app;
  }
  if ("studio_proc" in msg && (typeof msg.studio_proc === "boolean" || msg.studio_proc === null)) {
    studioProc = msg.studio_proc;
  }
  if (msg.type === "vault_settings" || msg.type === "theme_updated" || msg.type === "project_memory") {
    resolvePending(msg.id, msg);
    return;
  }
  if (msg.type === "studio_status") {
    resolvePending(msg.id, { ok: true, studio: studioConnected });
    broadcastStatus();
    return;
  }
  if (msg.type === "connected") {
    bridgeIdentity=typeof msg.bridge_id==='string'?msg.bridge_id:null;
    for(const [id,request] of pending){
      if(!request.parked)continue;
      if(!bridgeIdentity || request.bridge_id!==bridgeIdentity){resolvePending(id,{ok:false,kind:'indeterminate',may_have_executed:true,error:'Bridge identity changed. Inspect state before any retry.'});continue;}
      request.parked=false;clearTimeout(request.parkTimer);
      try{ws.send(JSON.stringify({...request.obj,id}));}catch{request.parked=true;}
    }
    mcpAlive = !!msg.mcp_alive;
    if (Array.isArray(msg.tools)) toolsCache = msg.tools;
    if (Array.isArray(msg.servers)) serversCache = msg.servers;
    if (Array.isArray(msg.skills)) skillsCache = msg.skills;
    broadcastStatus();
    return;
  }
  if (msg.type === "pong") {
    resolvePending(msg.id, { ok: true });
    return;
  }
  if (msg.type === "tools") {
    if (Array.isArray(msg.tools)) toolsCache = msg.tools;
    if (Array.isArray(msg.servers)) serversCache = msg.servers;
    if (Array.isArray(msg.skills)) skillsCache = msg.skills;
    mcpAlive = !!msg.mcp_alive;
    resolvePending(msg.id, { ok: true, tools: toolsCache, skills: skillsCache });
    broadcastStatus();
    return;
  }
  if (msg.type === "tool_result") {
    const request=pending.get(msg.id);
    if(request?.command_id && msg.command_id!==request.command_id)return;
    resolvePending(msg.id, {...msg,images:msg.images||[],meta:msg.meta||null});
    return;
  }
  if (msg.type === "mcp_status") {
    mcpAlive = !!msg.alive;
    if (Array.isArray(msg.tools)) toolsCache = msg.tools;
    if (Array.isArray(msg.servers)) serversCache = msg.servers;
    if (Array.isArray(msg.skills)) skillsCache = msg.skills;
    resolvePending(msg.id, { ok: !!msg.ok, alive: msg.alive, error: msg.error });
    broadcastStatus();
    return;
  }
  if (msg.type === "server_changed") {
    // The bridge acks, then restarts itself to reload config.json. The socket
    // will drop right after this - the content script shows a spinner until the
    // reconnect lands and a fresh status arrives.
    resolvePending(msg.id, { ok: !!msg.ok, error: msg.error, restarting: !!msg.restarting });
    return;
  }
  if (msg.type === "error") {
    resolvePending(msg.id, { ok: false, error: msg.error });
    return;
  }
}

function resolvePending(id, value) {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(value);
}

function failAllPending(reason) {
  for (const [id, p] of pending) {
    if(p.command_id && p.bridge_id) {p.parked=true;if(!p.parkTimer)p.parkTimer=setTimeout(()=>resolvePending(id,{ok:false,kind:'indeterminate',may_have_executed:true,error:'Reconnect grace expired. Inspect state before retrying.'}),20000);continue;}
    clearTimeout(p.timer);pending.delete(id);
    p.resolve({ ok: false, kind: "disconnected", error: reason });
  }
}

// ── status push to any open provider tab + popup ─────────────────────────
function statusObj() {
  return { type: "zs-status", health:{state:connected?"connected":"disconnected",lastMessageAgeMs:lastMessageAt?Date.now()-lastMessageAt:null,reconnectCount,ackLatencyMs:ackLatency,bridgeId:bridgeIdentity,pending:pending.size,inFlight:commandInFlight.size}, connected, mcpAlive, studio: studioConnected, studioApp, studioProc, tools: toolsCache.length, servers: serversCache, skills: skillsCache };
}

function broadcastStatus() {
  const payload = statusObj();
  try {
    const p = chrome.runtime.sendMessage(payload);
    if (p && p.catch) p.catch(() => {});
  } catch {}
  try {
    chrome.tabs.query({ url: PROVIDER_URLS }, (tabs) => {
      if (chrome.runtime.lastError) return;
      for (const t of Array.isArray(tabs) ? tabs : []) {
        try {
          const p = chrome.tabs.sendMessage(t.id, payload);
          if (p && p.catch) p.catch(() => {});
        } catch {}
      }
    });
  } catch {}
}

function broadcastAudio(payload) {
  try { chrome.runtime.sendMessage(payload).catch(()=>{}); } catch {}
  try { chrome.tabs.query({url:PROVIDER_URLS},tabs=>{if(chrome.runtime.lastError)return;for(const tab of tabs||[])try{chrome.tabs.sendMessage(tab.id,payload).catch(()=>{});}catch{}}); } catch {}
}

// ── messages from content.js / popup.js ─────────────────────────────────
// The async body is wrapped so a throw can never leave the caller's
// sendResponse pending (which the content script would see as a hang).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if(msg?.target === "fs-audio-player" || msg?.target === "fs-audio-ui") return false;
  let responded = false;
  const respond = (value) => {
    if (responded) return;
    responded = true;
    try { sendResponse(value); } catch {}
  };
  const fail = (error) => respond({ ok: false, error: String(error && error.message || error) });
  (async () => {
    switch (msg && msg.type) {
      case "fs_audio_get": respond(await extensionAudio.get(msg.legacySound)); break;
      case "fs_project": {const {type,...request}=msg;respond(await send({type:'project_memory',request},16000));break;}
      case "fs_audio_set": respond(await extensionAudio.set(msg.patch)); break;
      case "status":
        if (!connected) connect(); // self-heal after a worker wake-up
        respond(statusObj());
        break;
      case "list_tools": {
        // Prefer a live refresh; fall back to cache so the loop never stalls.
        // 10s, not 25s: a catalogue request only blocks this long when one of the
        // MCP servers is dead (typically Roblox in a degraded, Blender-only
        // session), and in that exact case we already hold a perfectly good cached
        // catalogue. Waiting the full 25s just froze the boot for no new data.
        const r = await send({ type: "list_tools" }, 10000);
        if (r.ok) respond({ ok: true, tools: r.tools, skills: skillsCache });
        else respond({ ok: toolsCache.length > 0, tools: toolsCache, skills: skillsCache, error: r.error });
        break;
      }
      case 'command_status':
      case 'cancel_command': {
        respond(await send({type:msg.type,command_id:msg.command_id},5000));break;
      }
      case "call_tool": {
        const fingerprint=ZSCommands.canonical({name:msg.name,arguments:msg.arguments||{}});
        const cached=msg.command_id && commandResults.get(msg.command_id),inFlight=msg.command_id && commandInFlight.get(msg.command_id);
        if(cached || inFlight){
          const existing=cached||inFlight;
          if(existing.fingerprint!==fingerprint){respond({ok:false,kind:'rejected',may_have_executed:false,error:'Command ID was reused with different arguments.'});break;}
          respond(cached?cached.result:await inFlight.promise);break;
        }
        const timeout = Math.max(1000,Math.min(900000,Number(msg.timeout)||120000));
        if(msg.command_id && !bridgeIdentity){respond({ok:false,kind:'unacknowledged',may_have_executed:false,error:'Bridge identity not available. Update/reconnect the bridge before executing.'});break;}
        const promise=send({type:'call_tool',name:msg.name,arguments:msg.arguments,timeout,command_id:msg.command_id,bridge_id:bridgeIdentity},timeout+10000,_sender?.tab?.id);
        if(msg.command_id)commandInFlight.set(msg.command_id,{promise,fingerprint});
        try {
          const result=await promise;
          if(msg.command_id && result.type==='tool_result' && !result.images?.length && JSON.stringify(result).length<=65536){
            commandResults.set(msg.command_id,{result,fingerprint});
            if(commandResults.size>100)commandResults.delete(commandResults.keys().next().value);
          }
          respond(result);
        } finally {if(msg.command_id)commandInFlight.delete(msg.command_id);}
        break;
      }
      case "restart_mcp": {
        const r = await send({ type: "restart_mcp" }, 30000);
        respond(r);
        break;
      }
      case "get_vault":
      case "configure_vault":
      case "set_theme": {
        respond(await send({ type: msg.type, settings: msg.settings, theme: msg.theme }, 15000));
        break;
      }
      case "add_server": {
        const r = await send({
          type: "add_server", server_id: msg.server_id,
          command: msg.command, args: msg.args, env: msg.env,
        }, 15000);
        respond(r);
        break;
      }
      case "remove_server": {
        const r = await send({ type: "remove_server", server_id: msg.server_id }, 15000);
        respond(r);
        break;
      }
      case "reconnect":
        reconnectDelay = RECONNECT_MIN;
        if (ws) {
          const old = ws;
          ws = null;
          connected = false;
          try { old.close(); } catch {}
        }
        connect();
        respond({ ok: true });
        break;
      case "open_dashboard":
        // The dashboard is an extension page; a content script cannot navigate
        // to chrome-extension:// URLs, so open it from the worker.
        try {
          const p = chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
          if (p && p.catch) p.catch(() => {});
        } catch {}
        respond({ ok: true });
        break;
      default:
        respond({ ok: false, error: "unknown message" });
    }
  })().catch(fail);
  return true; // async sendResponse
});

// Wake/keepalive hooks.
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
// Fired by the alarm when retries must continue after the worker was suspended.
if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT_ALARM && !connected) connect();
  });
}

connect();
