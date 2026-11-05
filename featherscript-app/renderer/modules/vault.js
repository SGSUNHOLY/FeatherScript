"use strict";
(() => {
  const modules = globalThis.FSRenderer ||= {};
  modules.createVault = ({ $, api, socket }) => {
    // The same local vault connection used by the extension, now beside Memory.
    let vaultSaving = false;
    function renderAppVault(settings) {
      $("#app-vault-path").value = settings.path || "";
      $("#app-vault-write").checked = !!settings.allowWrite;
      $("#app-vault-connection").textContent = settings.path ? settings.allowWrite ? "Connected · edits enabled" : "Connected · read only" : "Not connected";
      $("#app-vault-save").textContent = settings.path ? "Save connection" : "Connect vault";
    }
    async function saveAppVault(settings) {
      if (vaultSaving) return;
      vaultSaving = true;
      for (const id of ["#app-vault-save", "#app-vault-disconnect", "#app-vault-browse"]) $(id).disabled = true;
      $("#app-vault-status").textContent = "Updating vault connection…";
      try {
        const result = await socket.request("configure_vault", { settings });
        if (!result.ok) throw Error(result.error);
        renderAppVault(result.settings);
        $("#app-vault-status").textContent = settings.path ? "Vault connected. Note tools are ready for the agent." : "Vault disconnected.";
      } catch (error) { $("#app-vault-status").textContent = error.message; }
      finally {
        vaultSaving = false;
        for (const id of ["#app-vault-save", "#app-vault-disconnect", "#app-vault-browse"]) $(id).disabled = false;
      }
    }
    $("#app-vault-browse").addEventListener("click", async () => {
      try { const result = await api.vault.choose(); if (!result.canceled) $("#app-vault-path").value = result.path; }
      catch (error) { $("#app-vault-status").textContent = error.message; }
    });
    $("#app-vault-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const path = $("#app-vault-path").value.trim();
      if (!path) { $("#app-vault-status").textContent = "Choose your existing vault folder first."; return; }
      saveAppVault({ path, allowWrite: $("#app-vault-write").checked });
    });
    $("#app-vault-disconnect").addEventListener("click", () => saveAppVault({ path: "", allowWrite: false }));



    return { render: renderAppVault, get isSaving() { return vaultSaving; } };
  };
})();
