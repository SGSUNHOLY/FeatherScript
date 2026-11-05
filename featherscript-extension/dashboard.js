// FeatherScript dashboard - the local main menu, opened from the bar's gear.
// Kept as a plain extension page (no build step): status comes from the
// background worker over chrome.runtime messaging, storage from chrome.storage.

const VERSION = chrome.runtime.getManifest().version;

const AI_SITES = [
  { name: "Freebuff · website", url: "https://freebuff.com/" },
  { name: "Google AI Studio", url: "https://aistudio.google.com/prompts/new_chat" },
  { name: "DeepSeek", url: "https://chat.deepseek.com/" },
  { name: "ChatGPT", url: "https://chatgpt.com/" },
  { name: "Gemini", url: "https://gemini.google.com/app" },
  { name: "Kimi", url: "https://www.kimi.ai/" },
  { name: "GLM", url: "https://chat.z.ai/" },
  { name: "Qwen", url: "https://chat.qwen.ai/" },
  { name: "Arena", url: "https://arena.ai/text/direct" },
  { name: "Meta AI", url: "https://www.meta.ai/" },
  { name: "Vani Chat", url: "https://c.vani.ai/chat" },
  { name: "Notion AI", url: "https://www.notion.so/chat" },
  { name: "MiMo AI", url: "https://aistudio.xiaomimimo.com/" },
  { name: "Genspark AI Chat", url: "https://www.genspark.ai/agents?type=ai_chat" },
];

const ROBUX_PASSES = [
  { robux: 30, id: 1865342947 },
  { robux: 100, id: 1866782815 },
  { robux: 300, id: 1869176990 },
  { robux: 1000, id: 1865192973 },
];

const SITE_PATTERNS = [
  "chat.deepseek.com", "chatgpt.com", "chat.openai.com", "gemini.google.com",
  "www.kimi.ai", "kimi.ai", "chat.z.ai", "chat.qwen.ai", "arena.ai",
  "www.meta.ai", "meta.ai",
  "c.vani.ai", "www.notion.so", "notion.so", "app.notion.com",
  "aistudio.xiaomimimo.com", "aistudio.google.com",
  "www.genspark.ai", "genspark.ai",
];

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function bg(msg) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        void chrome.runtime.lastError; // background asleep / mid-restart is normal
        resolve(r || null);
      });
    } catch {
      resolve(null);
    }
  });
}

function flash(node, text, ms = 2000) {
  node.textContent = text;
  clearTimeout(node._fsTimer);
  node._fsTimer = setTimeout(() => {
    if (node.textContent === text) node.textContent = "";
  }, ms);
}

// ── static chrome ─────────────────────────────────────────────────────────
$("ver").textContent = `v${VERSION}`;
$("foot-ver").textContent = `v${VERSION}`;

$("site-count").textContent = `${AI_SITES.length} sites`;

for (const site of AI_SITES) {
  const btn = el("button", "fs-site");
  btn.type = "button";
  btn.title = site.url;
  const info = el("span");
  info.appendChild(el("b", null, site.name));
  let host = site.url;
  try { host = new URL(site.url).hostname.replace(/^www\./, ""); } catch {}
  info.appendChild(el("span", null, host));
  btn.appendChild(info);
  btn.appendChild(el("i", null, "\u2192"));
  btn.addEventListener("click", () => chrome.tabs.create({ url: site.url }));
  $("sites").appendChild(btn);
}

for (const pass of ROBUX_PASSES) {
  const btn = el("button", "fs-rbx-btn", `R$ ${pass.robux}`);
  btn.type = "button";
  btn.title = "Tip in Robux";
  btn.addEventListener("click", () =>
    chrome.tabs.create({ url: `https://www.roblox.com/game-pass/${pass.id}` }));
  if (!document.querySelector(".fs-rbx-label")) {
    $("rbx").appendChild(el("span", "fs-rbx-label", "or tip in Robux"));
  }
  $("rbx").appendChild(btn);
}

// ── bridge status ─────────────────────────────────────────────────────────
let lastStatus = null;

function renderStatus(s) {
  const wasConnected = !!lastStatus?.connected;
  if (lastStatus && !wasConnected && s?.connected) loadVault();
  lastStatus = s || { connected: false };

  const servers = lastStatus.servers || [];
  const up = servers.filter((x) => x.alive).length;
  const mcpOk = !!lastStatus.connected && (lastStatus.mcpAlive || up > 0 || lastStatus.tools > 0);
  const studioOff = mcpOk && lastStatus.studio === false;
  const ready = mcpOk && !studioOff;

  const pill = $("pill");
  const pillText = $("pill-text");
  if (!lastStatus.connected) {
    pill.dataset.tone = "off";
    pillText.textContent = "Bridge offline · start the FeatherScript app";
  } else if (!mcpOk) {
    pill.dataset.tone = "warn";
    pillText.textContent = "Bridge up · Studio not connected";
  } else if (studioOff) {
    pill.dataset.tone = "warn";
    pillText.textContent = "Studio open · enable its MCP server";
  } else {
    pill.dataset.tone = "on";
    pillText.textContent = `Online · ${lastStatus.tools || 0} tools ready`;
  }

  $("st-tools").textContent = lastStatus.connected ? (lastStatus.tools || 0) : "—";
  $("st-studio").textContent = !lastStatus.connected ? "—" : ready ? "Connected" : studioOff ? "No place" : "Offline";
  $("st-servers").textContent = lastStatus.connected
    ? `${servers.filter((x) => x.alive).length || (mcpOk ? 1 : 0)}/${Math.max(1, servers.length)}`
    : "—";

  renderMcp();
  renderTools();
  if (lastStatus.connected && (!toolsLoadedAt || Date.now() - toolsLoadedAt > 20000)) loadTools();
}

async function refreshStatus() {
  const s = await bg({ type: "status" });
  if (s) renderStatus(s);
}

// ── custom prompt ─────────────────────────────────────────────────────────
function loadPrompt() {
  try {
    chrome.storage.local.get("zsCustomPrompt", (r) => {
      $("prompt").value = (r && typeof r.zsCustomPrompt === "string") ? r.zsCustomPrompt : "";
    });
  } catch {}
}

$("save-prompt").addEventListener("click", () => {
  const value = $("prompt").value;
  try {
    chrome.storage.local.set({ zsCustomPrompt: value }, () => {
      if (chrome.runtime.lastError) {
        flash($("prompt-status"), "Couldn't save");
        return;
      }
      flash($("prompt-status"), "Saved ✓");
    });
  } catch {
    flash($("prompt-status"), "Couldn't save");
  }
});

// ── MCP servers ───────────────────────────────────────────────────────────
let customMcp = [];
let mcpBusy = false;

function loadMcp() {
  try {
    chrome.storage.local.get("zsCustomMcpServers", (r) => {
      if (r && Array.isArray(r.zsCustomMcpServers)) {
        // Older builds auto-healed the shipped servers (Blender, PC control) into
        // this addon cache, which gave them a remove button. Drop them for good.
        customMcp = r.zsCustomMcpServers.filter((x) => x && x.id && !ZSServerStatus.BUILTIN.includes(x.id));
        if (customMcp.length !== r.zsCustomMcpServers.length) saveMcp();
        renderMcp();
      }
    });
  } catch {}
}

function saveMcp() {
  try { chrome.storage.local.set({ zsCustomMcpServers: customMcp }); } catch {}
}

// The bridge's live server list is the source of truth for which addons exist;
// chrome.storage is only a display-name cache (they can drift if it is cleared
// or config.json is edited by hand).
// Just-removed ids are hidden until the restarted bridge drops them, otherwise
// the stale pre-restart list would "heal" the cache back and the row returns.
const pendingRemoved = new Set();

function mergedMcp() {
  const live = (((lastStatus && lastStatus.servers) || []))
    .filter((x) => !ZSServerStatus.BUILTIN.includes(x.id) && !pendingRemoved.has(x.id));
  const byId = new Map(customMcp.map((x) => [x.id, x]));
  // The bridge row is kept whole (state/fix/tools) so the verdict rendered below
  // is the bridge's own, not a guess from `alive`.
  const merged = live.map((sv) => ({
    ...sv,
    name: (byId.get(sv.id) && byId.get(sv.id).name) || sv.id,
    command: (byId.get(sv.id) && byId.get(sv.id).command) || sv.command,
  }));
  let healed = false;
  for (const sv of live) {
    if (!byId.has(sv.id)) {
      customMcp.push({ id: sv.id, name: sv.id });
      healed = true;
    }
  }
  if (healed) saveMcp();
  // Just added/removed, bridge still restarting: keep showing it, health unknown.
  for (const s of customMcp) {
    if (!merged.some((m) => m.id === s.id)) {
      merged.push({ ...s, alive: undefined, tools: undefined });
    }
  }
  return merged;
}

let mcpRenderKey = "";

// One row, worded by core/server-status.js so this page, the bar chip and the
// model's own list_mcp_servers can never disagree about a server's health.
// A server the bridge never reported (an addon mid-restart) gets no dot colour:
// "unknown" must not read as either healthy or broken.
function serverRow(name, sub, server, opts) {
  const o = opts || {};
  const item = el("div", "fs-mcp-item" + (o.primary ? " is-primary" : ""));
  const dot = el("span", "fs-mcp-dot");
  if (server) dot.classList.add(ZSServerStatus.state(server) === "working" ? "on" : "warn");
  item.appendChild(dot);
  const info = el("div", "fs-mcp-info");
  info.appendChild(el("span", "fs-mcp-name", name));
  info.appendChild(el("span", "fs-mcp-sub", sub));
  item.appendChild(info);
  if (o.title) item.title = o.title;
  return item;
}

function renderMcp() {
  const listEl = $("mcp-list");
  const s = lastStatus || {};
  const servers = s.servers || [];
  const primary = servers.find((x) => x.id === "roblox") || null;
  // Shipped servers get a status row of their own. They are not addons, so they
  // get no remove button: deleting one would edit config.json behind the app's
  // own switches.
  const builtins = ZSServerStatus.BUILTIN.filter((id) => id !== "roblox")
    .map((id) => servers.find((x) => x.id === id))
    .filter(Boolean);
  const addons = mergedMcp();

  // Rebuilding every status tick (2s) would drop hover/focus on the remove
  // buttons mid-click; only touch the DOM when something actually changed.
  const key = JSON.stringify([
    !!s.connected, !!s.mcpAlive, ZSServerStatus.state(primary), primary && primary.tools,
    builtins.map((x) => [x.id, ZSServerStatus.state(x), x.tools, x.fix]),
    mcpBusy, addons.map((x) => [x.id, x.name, x.command, ZSServerStatus.state(x), x.tools, x.fix]),
  ]);
  $("mcp-count").textContent = addons.length
    ? `${1 + builtins.length + addons.length} servers \u00b7 ${addons.length} addon${addons.length === 1 ? "" : "s"}`
    : `${builtins.length} shipped`;
  if (key === mcpRenderKey) return;
  mcpRenderKey = key;

  listEl.textContent = "";

  const primaryServer = primary || (s.connected ? { alive: !!s.mcpAlive, tools: s.tools || 0 } : null);
  listEl.appendChild(serverRow(ZSServerStatus.label("roblox"),
    `primary \u00b7 ${s.connected ? ZSServerStatus.describe(primaryServer) : "Bridge offline - start the FeatherScript app"}`,
    primaryServer, { primary: true }));

  for (const sv of builtins)
    listEl.appendChild(serverRow(ZSServerStatus.label(sv.id), ZSServerStatus.describe(sv), sv));

  for (const sv of addons) {
    // An addon the restarted bridge has not reported yet: keep the row, say so.
    const known = Boolean(sv.state) || sv.alive !== undefined;
    const item = serverRow(sv.name, known ? ZSServerStatus.describe(sv) : "waiting for the bridge to restart",
      known ? sv : null, { title: sv.command || sv.id });
    const rm = el("button", "fs-mcp-remove", "\u2715");
    rm.type = "button";
    rm.title = "Remove";
    rm.dataset.id = sv.id;
    rm.disabled = mcpBusy;
    rm.addEventListener("click", () => removeServer(sv.id));
    item.appendChild(rm);
    listEl.appendChild(item);
  }
}

function setMcpBusy(busy, label) {
  mcpBusy = busy;
  $("mcp-add").disabled = busy;
  for (const b of $("mcp-list").querySelectorAll(".fs-mcp-remove")) b.disabled = busy;
  if (busy) {
    $("mcp-status").textContent = label || "Restarting bridge…";
  } else {
    $("mcp-status").textContent = "";
  }
  mcpRenderKey = ""; // let the next render refresh the disabled state
}

function slug(name) {
  let s = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  // Never let a hand-added server take a shipped one's id: it would shadow the
  // built-in row and its remove button would delete the real config entry.
  if (!s || ZSServerStatus.BUILTIN.includes(s)) s = `addon-${s || "server"}`;
  let id = s;
  let n = 2;
  while (customMcp.some((x) => x.id === id)) id = `${s}-${n++}`;
  return id;
}

function splitCommand(raw) {
  const parts = String(raw || "").match(/"[^"]*"|'[^']*'|\S+/g) || [];
  const clean = parts.map((p) => p.replace(/^["']|["']$/g, ""));
  return { command: clean[0] || "", args: clean.slice(1) };
}

// The bridge rewrites config.json and restarts to load a server change; wait for
// it to come back (optionally until `id` shows up in server health).
async function waitForBridge(id, timeoutMs = 15000) {
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 1200));
  while (Date.now() - t0 < timeoutMs) {
    const s = await bg({ type: "status" });
    if (s && s.connected && (!id || (Array.isArray(s.servers) && s.servers.some((x) => x.id === id)))) {
      return true;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}

$("mcp-add").addEventListener("click", async () => {
  if (mcpBusy) return;
  const name = $("mcp-name").value.trim();
  const raw = $("mcp-cmd").value.trim();
  if (!name || !raw) {
    flash($("mcp-status"), "Name and command required");
    return;
  }
  const id = slug(name);
  const { command, args } = splitCommand(raw);
  setMcpBusy(true);
  const r = await bg({ type: "add_server", server_id: id, command, args });
  if (!r || !r.ok) {
    setMcpBusy(false);
    flash($("mcp-status"), (r && r.error) || "Couldn't add server", 3000);
    renderMcp();
    return;
  }
  customMcp.push({ id, name, command: raw });
  pendingRemoved.delete(id);
  saveMcp();
  const back = await waitForBridge(id);
  setMcpBusy(false);
  $("mcp-name").value = "";
  $("mcp-cmd").value = "";
  flash($("mcp-status"), back ? "Added ✓" : "Added · bridge still restarting…", 3000);
  await refreshStatus();
});

async function removeServer(id) {
  if (mcpBusy || !id) return;
  setMcpBusy(true);
  const r = await bg({ type: "remove_server", server_id: id });
  if (!r || !r.ok) {
    setMcpBusy(false);
    flash($("mcp-status"), (r && r.error) || "Couldn't remove server", 3000);
    renderMcp();
    return;
  }
  customMcp = customMcp.filter((x) => x.id !== id);
  pendingRemoved.add(id);
  saveMcp();
  await waitForBridge(null);
  setMcpBusy(false);
  flash($("mcp-status"), "Removed ✓");
  await refreshStatus();
}

// ── command chips ─────────────────────────────────────────────────────────
let tools = [];
let toolsLoadedAt = 0;
let toolsLoading = false;

async function loadTools() {
  if (toolsLoading || !lastStatus || !lastStatus.connected) return;
  toolsLoading = true;
  const r = await bg({ type: "list_tools" });
  toolsLoading = false;
  if (r && Array.isArray(r.tools)) {
    tools = r.tools
      .map((t) => (t && t.name) || (typeof t === "string" ? t : ""))
      .filter(Boolean);
    toolsLoadedAt = Date.now();
    renderTools();
  }
}

let toolsRenderKey = "";

function renderTools() {
  const host = $("tools");
  $("tools-count").textContent = tools.length ? `${tools.length} available` : "";

  const key = !lastStatus ? "checking" : !lastStatus.connected ? "offline" : tools.length ? `list:${tools.length}` : "loading";
  if (key === toolsRenderKey) return;
  toolsRenderKey = key;

  host.textContent = "";
  if (key === "checking") host.appendChild(el("span", "fs-empty", "Connecting to the bridge…"));
  else if (key === "offline") host.appendChild(el("span", "fs-empty", "Bridge offline - start the FeatherScript app to see the live command list."));
  else if (key === "loading") host.appendChild(el("span", "fs-empty", "Loading commands…"));
  else for (const name of tools) host.appendChild(el("span", "fs-chip", name));
}

// ── settings ──────────────────────────────────────────────────────────────
ZSAudioUI.mount(document);

$("set-reconnect").addEventListener("click", async () => {
  await bg({ type: "reconnect" });
  flash($("set-status"), "Reconnecting…");
  setTimeout(refreshStatus, 900);
});

$("set-restart").addEventListener("click", async () => {
  const btn = $("set-restart");
  btn.disabled = true;
  btn.textContent = "Restarting…";
  const r = await bg({ type: "restart_mcp" });
  btn.disabled = false;
  btn.textContent = "Restart";
  flash($("set-status"), r && r.ok ? "Roblox server restarted" : "Restart failed - is the bridge running?", 3000);
  setTimeout(refreshStatus, 800);
});

$("set-setup").addEventListener("click", () => {
  try {
    chrome.storage.local.set({ zsSetupSeen: false }, () => {
      flash($("set-status"), "The setup card will show on your next chat tab.");
    });
  } catch {}
});

// ── top actions ───────────────────────────────────────────────────────────
$("reconnect").addEventListener("click", async () => {
  await bg({ type: "reconnect" });
  flash($("pill-text"), "Reconnecting…");
  setTimeout(refreshStatus, 900);
});

$("open-chat").addEventListener("click", () => {
  chrome.tabs.query({}, (tabs) => {
    const isSite = (t) => !!(t.url && SITE_PATTERNS.some((h) => t.url.includes(h)));
    const found = (tabs || []).find((t) => t.active && isSite(t)) || (tabs || []).find(isSite);
    if (found) chrome.tabs.update(found.id, { active: true });
    else chrome.tabs.create({ url: "https://chat.deepseek.com/" });
  });
});

// ── boot ──────────────────────────────────────────────────────────────────
loadPrompt();

loadMcp();
refreshStatus();
setInterval(refreshStatus, 2000);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "zs-status") renderStatus(msg);
});


// Shared palette selection. Storage updates every injected panel, even offline.
const themeChoices = [{ id: "auto", name: "Follow page", background: "#111827", accent: "#94a3b8" }, ...FSThemePresets];
const baseColors = { default: ["#f1d377", "#1b1507"], dark: ["#12100a", "#f5d268"], midnight: ["#020617", "#38bdf8"] };
for (const preset of themeChoices) {
  const button = el("button", "fs-theme"); button.type = "button"; button.dataset.theme = preset.id;
  const sample = el("span", "fs-theme-sample"); sample.setAttribute("aria-hidden", "true");
  const colors = baseColors[preset.id] || [preset.background, preset.accent];
  sample.style.setProperty("--sample-bg", colors[0]); sample.style.setProperty("--sample-accent", colors[1]);
  button.append(sample, el("span", null, preset.name));
  button.addEventListener("click", async () => {
    await chrome.storage.local.set({ zsTheme: preset.id });
    const response = await bg({ type: "set_theme", theme: preset.id });
    flash($("theme-status"), response?.ok ? "Theme saved across FeatherScript" : "Applied to extension · bridge offline", 3000);
  });
  $("theme-picker").append(button);
}
function renderThemeSelection(theme) {
  const selected = themeChoices.find((preset) => preset.id === theme) || themeChoices[0];
  $("theme-label").textContent = selected.name;
  for (const card of $("theme-picker").children) card.setAttribute("aria-pressed", String(card.dataset.theme === selected.id));
}
chrome.storage.local.get("zsTheme", (stored) => renderThemeSelection(stored.zsTheme));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.zsTheme) renderThemeSelection(changes.zsTheme.newValue);
});

let vaultBusy = false;
function renderVault(settings) {
  $("vault-path").value = settings.path || "";
  $("vault-write").checked = !!settings.allowWrite;
  $("vault-connection").textContent = settings.path ? settings.allowWrite ? "Connected · note edits enabled" : "Connected · read only" : "Not connected";
  $("vault-save").textContent = settings.path ? "Save vault" : "Connect vault";
}
async function loadVault() {
  const result = await bg({ type: "get_vault" });
  if (result?.ok) renderVault(result.settings);
  else $("vault-connection").textContent = "Start the bridge to connect";
}
async function configureVault(settings) {
  if (vaultBusy) return;
  vaultBusy = true;
  $("vault-save").disabled = $("vault-disconnect").disabled = true;
  $("vault-status").textContent = "Saving…";
  try {
    const result = await bg({ type: "configure_vault", settings });
    if (!result?.ok) throw new Error(result?.error || "Bridge offline. Start the FeatherScript app first.");
    renderVault(result.settings);
    flash($("vault-status"), settings.path ? "Vault connected" : "Vault disconnected");
    await loadTools();
  } catch (error) { $("vault-status").textContent = error.message; }
  finally { vaultBusy = false; $("vault-save").disabled = $("vault-disconnect").disabled = false; }
}
$("vault-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const path = $("vault-path").value.trim();
  if (!path) { $("vault-status").textContent = "Enter your existing vault folder path."; return; }
  configureVault({ path, allowWrite: $("vault-write").checked });
});
$("vault-disconnect").addEventListener("click", () => configureVault({ path: "", allowWrite: false }));
loadVault();

