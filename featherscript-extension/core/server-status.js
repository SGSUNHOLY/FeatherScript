/* One honest MCP verdict per server, shared by every surface that reports one:
   the bar's status chip, the dashboard's server list, the desktop app's counters
   and the model's own list_mcp_servers command.

   `alive` alone lies. The StudioMCP proxy answers with its whole catalogue while
   no Studio is attached, and the headless Blender server lists its tools before
   Blender has been found, so "process up" has to be reported as far as it proves
   and no further. bridge.py produces these verdicts (MCPManager.health); an older
   bridge that sends no `state` falls back to the same rules from its raw signals,
   so no surface has to guess. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZSServerStatus = api;
})(globalThis, () => {
  'use strict';

  const LABELS = { roblox: "Roblox Studio", blender: "Headless Blender", computer: "PC control", obsidian: "Obsidian vault" };
  // Shipped with FeatherScript: they get a status row, never an addon's remove button.
  const BUILTIN = ["roblox", "blender", "computer", "obsidian"];
  const STATES = ["working", "waiting", "starting", "failed", "offline"];
  const WORDS = { working: "Working", waiting: "Not ready", starting: "Starting", failed: "Not working", offline: "Offline" };
  // "Starting" and "Not ready" are in-between states the user is already watching
  // for (Studio attaching, a catalogue still loading). These two are dead ends.
  const BROKEN = ["failed", "offline"];

  const label = (id) => LABELS[id] || String(id || "server");
  const commands = (n) => `${n} command${n === 1 ? "" : "s"}`;
  const count = (server) => Number(server && server.tools) || 0;

  function state(server) {
    if (!server) return "offline";
    if (STATES.includes(server.state)) return server.state;
    if (server.error) return "failed";
    if (!server.alive) return "offline";
    return (server.ready ?? count(server) > 0) ? "working" : "starting";
  }

  // The bridge sends the reason twice for a failed server (error and fix are the
  // same string); show one copy, and show whatever detail carries the information.
  function reason(server) {
    const parts = [...new Set([String(server && server.fix || ''), String(server && server.error || '')].filter(Boolean))];
    return parts.filter((p) => !parts.some((q) => q !== p && q.includes(p))).join(" · ");
  }

  function describe(server) {
    const s = state(server);
    const why = reason(server);
    const n = count(server);
    if (s === "working") return `${WORDS[s]} · ${commands(n)} available`;
    if (s === "starting") return why ? `${WORDS[s]} · ${why}` : `${WORDS[s]} · no commands yet`;
    return why ? `${WORDS[s]} · ${why}` : WORDS[s];
  }

  // Only the servers this build actually configured are counted: the bridge omits
  // an addon row entirely when the user never set it up, so nothing is missing.
  function broken(servers) {
    return (servers || []).filter((s) => s && s.id !== "roblox" && BROKEN.includes(state(s)));
  }

  return Object.freeze({ LABELS, BUILTIN, STATES, WORDS, label, commands, count, state, reason, describe, broken });
});
