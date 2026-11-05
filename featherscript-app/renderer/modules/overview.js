"use strict";
(() => {
  const modules = globalThis.FSRenderer ||= {};
  modules.createOverview = ({ $, $$, socket, onNavigate }) => {
    $("#choose-ai").addEventListener("click", () => {
      onNavigate("providers");
      $("#supported-ai-grid button").focus({ preventScroll: true });
    });
    $$("[data-overview-page]").forEach((button) => button.addEventListener("click", () => onNavigate(button.dataset.overviewPage)));
    $("#refresh-overview-connections").addEventListener("click", async () => {
      const button = $("#refresh-overview-connections");
      button.disabled = true;
      $("#overview-connection-action-status").textContent = "Refreshing connections…";
      try {
        const result = await socket.request("list_tools");
        if (result.type !== "tools") throw Error(result.error || "The bridge did not return its tools.");
        $("#overview-connection-action-status").textContent = `Updated · ${(result.tools || []).length} tools available`;
      } catch (error) { $("#overview-connection-action-status").textContent = error.message; }
      finally { button.disabled = false; }
    });
  };
})();
