"use strict";
(() => {
  const modules = globalThis.FSRenderer ||= {};
  modules.createProviders = ({ $, providers, api }) => {
    // Supported AI launcher: local metadata and deliberate external navigation only.
    const LAST_AI_KEY = "fs.lastAI";
    function renderLastAI() {
      const previous = providers.find((provider) => provider.id === localStorage.getItem(LAST_AI_KEY));
      $("#last-ai-label").textContent = previous ? `Last opened · ${previous.name}` : "Choose a chat to begin ↗";
      for (const card of $("#supported-ai-grid").children) card.classList.toggle("was-last-used", card.dataset.provider === previous?.id);
    }
    for (const [index, provider] of providers.entries()) {
      const card = document.createElement("button"); card.type = "button"; card.className = "ai-card"; card.dataset.provider = provider.id;
      card.style.setProperty("--provider-color", provider.color); card.style.setProperty("--card-order", index);
      card.title = `Open ${provider.name} · ${provider.url}`; card.setAttribute("aria-label", `Open ${provider.name} in your browser`);
      const mark = document.createElement("span"); mark.className = "ai-monogram"; mark.textContent = provider.mark; mark.setAttribute("aria-hidden", "true");
      const copy = document.createElement("span"); copy.className = "ai-card-copy";
      const title = document.createElement("b"); title.textContent = provider.name;
      const detail = document.createElement("small"); detail.textContent = provider.detail;
      copy.append(title, detail);
      const arrow = document.createElement("span"); arrow.className = "ai-card-arrow"; arrow.textContent = "↗"; arrow.setAttribute("aria-hidden", "true");
      card.append(mark, copy, arrow);
      card.addEventListener("click", async () => {
        try {
          const result = await api.openExternal(provider.url);
          if (result?.ok === false) throw Error(result.error);
          localStorage.setItem(LAST_AI_KEY, provider.id); renderLastAI();
          $("#ai-launch-status").textContent = provider.external ? `Opening ${provider.name} website.` : `Opening ${provider.name}. Press Start in the FeatherScript controller once the chat is ready.`;
        } catch (error) { $("#ai-launch-status").textContent = `Could not open ${provider.name}: ${error.message}`; }
      });
      $("#supported-ai-grid").append(card);
    }
    $("#supported-ai-count").textContent = `${providers.filter((provider) => !provider.external).length} supported · ${providers.filter((provider) => provider.external).length} website`;
    renderLastAI();
    return { renderLastAI };
  };
})();
