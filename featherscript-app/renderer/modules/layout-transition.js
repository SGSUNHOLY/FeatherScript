"use strict";
(() => {
  const modules = globalThis.FSRenderer ||= {};
  let active = null;
  modules.layoutTransition = {
    cancel() { active?.skipTransition(); active = null; },
    async run(update) {
      this.cancel();
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!document.startViewTransition || reduced || document.body.dataset.motion !== 'full' || document.hidden) {
        update(); return;
      }
      const transition = document.startViewTransition(update);
      active = transition;
      // Skipping an interrupted transition may reject ready, but its update still runs.
      transition.ready.catch(() => {});
      transition.finished.catch(() => {}).finally(() => { if (active === transition) active = null; });
      await transition.updateCallbackDone;
    },
  };
})();
