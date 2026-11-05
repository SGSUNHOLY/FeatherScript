// SPDX-License-Identifier: GPL-3.0-or-later
const KOFI_URL = "https://ko-fi.com/sebattfg";
const DEFAULT_AI_URL = "https://chat.deepseek.com/";
const SUPPORTED_HOSTS = ["aistudio.google.com", 
  "chat.deepseek.com", "deepseek.com", "chatgpt.com", "chat.openai.com",
  "gemini.google.com", "www.kimi.ai", "kimi.ai", "chat.z.ai", "chat.qwen.ai",
  "arena.ai", "www.meta.ai", "meta.ai",
  "c.vani.ai", "www.notion.so", "notion.so", "app.notion.com",
  "aistudio.xiaomimimo.com",
];

const byId = (id) => document.getElementById(id);
byId("ver").textContent = `v${chrome.runtime.getManifest().version}`;

let previousState = "";
function playSound(kind = "tap") { ZSAudioUI.cue(kind); }
ZSAudioUI.mount(document);

function showToast(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 1800);
}

function render(s) {
  const dot = byId("dot");
  const list = s.servers || [];
  const up = list.filter((server) => server.alive).length;
  const mcpOk = s.connected && (s.mcpAlive || up > 0 || s.tools > 0);
  const studioOff = mcpOk && s.studio === false;
  const ok = mcpOk && !studioOff;
  const nextState = !s.connected ? "offline" : ok ? "ready" : studioOff ? "studio-off" : "bridge-ready";
  dot.className = `dot ${s.connected ? (ok ? "on" : "warn") : ""}`;
  byId("state").textContent = s.connected
    ? (ok ? "Online" : studioOff ? "Studio offline" : "Bridge ready")
    : "Offline";
  byId("tools").textContent = s.connected
    ? (studioOff ? "Enable the MCP server in Roblox Studio" : `${s.tools || 0} tools available`)
    : "Start the local bridge to connect";
  // Per-server verdicts from core/server-status.js: "● roblox (34 tools)" used to
  // be printed off a live proxy pipe while no Studio was attached, which is the
  // exact false-ready the rest of the product stopped reporting.
  byId("servers").textContent = s.connected
    ? list.map((server) => {
        const working = ZSServerStatus.state(server) === "working";
        return `${working ? "●" : "○"} ${ZSServerStatus.label(server.id)} · ${ZSServerStatus.describe(server)}`;
      }).join("   ·   ")
    : "";
  if (nextState === "ready" && previousState && previousState !== "ready") {
    dot.classList.add("pulse");
    setTimeout(() => dot.classList.remove("pulse"), 800);
    playSound("ready");
  }
  previousState = nextState;
}

function refresh() {
  chrome.runtime.sendMessage({ type: "status" }, (status) => status && render(status));
}

function openAI(url = DEFAULT_AI_URL) {
  playSound("tap");
  chrome.tabs.create({ url });
}

byId("start").addEventListener("click", () => {
  playSound("tap");
  chrome.tabs.query({}, (tabs) => {
    const currentAI = tabs.find((tab) => tab.active && tab.url && SUPPORTED_HOSTS.some((host) => tab.url.includes(host)));
    if (currentAI) chrome.tabs.update(currentAI.id, { active: true });
    else chrome.tabs.create({ url: DEFAULT_AI_URL });
  });
});
document.querySelectorAll(".provider").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    openAI(link.dataset.url || DEFAULT_AI_URL);
  });
});
byId("settings").addEventListener("click", () => {
  playSound("tap");
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});
byId("reconnect").addEventListener("click", () => {
  playSound("tap");
  chrome.runtime.sendMessage({ type: "reconnect" }, () => setTimeout(refresh, 600));
});
byId("restart").addEventListener("click", (event) => {
  playSound("tap");
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Restarting server…";
  chrome.runtime.sendMessage({ type: "restart_mcp" }, () => {
    button.disabled = false;
    button.textContent = "Restart Roblox server";
    setTimeout(refresh, 600);
  });
});
byId("kofi").addEventListener("click", () => {
  playSound("tap");
  chrome.tabs.create({ url: KOFI_URL });
});
chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "zs-status") render(message);
});
refresh();
setInterval(refresh, 2000);
