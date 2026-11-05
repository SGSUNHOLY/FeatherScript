"use strict";
(() => {
  const modules = globalThis.FSRenderer ||= {};

  modules.createCommandLibrary = ({ drawer, container, empty, search, isVisible }) => {
    let tools = [];
    let connected = false;
    let signature = null;
    let dirty = true;

    function render() {
      if (!dirty || !drawer.open || !isVisible()) return;
      dirty = false;
      const query = search.value.trim().toLowerCase();
      const matches = tools.filter((tool) =>
        !query || (tool.name || "").toLowerCase().includes(query) ||
        (tool.description || "").toLowerCase().includes(query)
      );

      if (!matches.length) {
        container.replaceChildren();
        empty.hidden = false;
        empty.textContent = !tools.length
          ? connected ? "No commands yet. Open Roblox Studio with its MCP server enabled." : "Waiting for the bridge…"
          : `No command matches “${query}”.`;
        return;
      }

      const fragment = document.createDocumentFragment();
      for (const [index, tool] of matches.slice(0, 400).entries()) {
        const chip = document.createElement("span");
        chip.className = "chip";
        chip.style.setProperty("--i", String(Math.min(index, 60)));
        chip.textContent = tool.name;
        if (tool.description) chip.title = tool.description;
        fragment.append(chip);
      }
      empty.hidden = true;
      container.replaceChildren(fragment);
    }

    function update(nextTools, nextConnected) {
      const nextSignature = JSON.stringify([
        nextConnected, nextTools.map((tool) => [tool.name, tool.description || ""]),
      ]);
      if (nextSignature !== signature) {
        signature = nextSignature;
        tools = nextTools;
        connected = nextConnected;
        dirty = true;
      }
      render();
    }

    drawer.addEventListener("toggle", render);
    search.addEventListener("input", () => { dirty = true; render(); });
    return { update, render };
  };
})();
