// SPDX-License-Identifier: GPL-3.0-or-later
// core/keepawake.js - keep AI sites generating while their tab is hidden.
//
// Runs in the MAIN world at document_start, before any site script, for every
// supported host. AI sites commonly watch Page Visibility and stop or abort a
// reply the moment the tab is backgrounded/minimized (usage-saving), which is
// exactly when the user has switched to Roblox Studio and expects the agent to
// keep going. This script:
//
//  1. Reports the page as always visible (document.hidden / visibilityState,
//     plus the webkit aliases) and suppresses the visibilitychange events that
//     sites listen to for their abort handlers.
//  2. Reports the document as focused while it really is hidden, for sites that
//     also gate on document.hasFocus().
//  3. Keeps requestAnimationFrame alive while hidden. Chrome fully pauses rAF
//     in a background tab; sites that batch streamed tokens through rAF would
//     stop painting them, so the DOM (which the extension reads) would freeze.
//     The shim keeps the native rAF whenever the tab really is visible.
//
// The extension's own content script runs in an isolated world with its own
// document wrapper, so it still sees the REAL visibility and does not need any
// of this to make decisions.
(() => {
  "use strict";
  if (window.__zsKeepAwake) return;
  window.__zsKeepAwake = true;

  const hiddenGetter = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
  const visGetter = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
  if (!hiddenGetter || !visGetter) return;
  const reallyHidden = () => {
    try { return !!hiddenGetter.get.call(document); } catch { return false; }
  };

  try {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  } catch {}
  for (const prop of ["webkitHidden", "webkitVisibilityState"]) {
    const d = Object.getOwnPropertyDescriptor(Document.prototype, prop);
    if (d && d.get) {
      try {
        Object.defineProperty(document, prop, {
          configurable: true,
          get: () => (prop === "webkitHidden" ? false : "visible"),
        });
      } catch {}
    }
  }

  let frameNudge = null;
  const swallow = (e) => {
    try { frameNudge && frameNudge(); } catch {}
    e.stopImmediatePropagation();
  };
  for (const target of [window, document]) {
    try { target.addEventListener("visibilitychange", swallow, true); } catch {}
    try { target.addEventListener("webkitvisibilitychange", swallow, true); } catch {}
  }

  const nativeHasFocus = Document.prototype.hasFocus;
  try {
    document.hasFocus = function hasFocus() {
      return reallyHidden() ? true : nativeHasFocus.call(this);
    };
  } catch {}

  // rAF shim: while hidden, rAF is fully frozen by Chrome, and a chain that was
  // ALREADY in flight when the tab hid dies with its pending native callback -
  // so hiding must never leave a callback parked on native rAF. All callbacks
  // are queued here and dispatched by one flush: native rAF timing while the
  // tab is visible, a timer while it is hidden (Chrome throttles it to ~1/s,
  // which is still enough to keep streamed text rendering into the DOM).
  const nativeRaf = window.requestAnimationFrame;
  if (typeof nativeRaf === "function") {
    const pending = new Map();
    let nextId = 1, framePending = false;

    const flush = () => {
      framePending = false;
      const now = performance.now();
      const due = [...pending.values()];
      pending.clear();
      for (const cb of due) {
        try { cb(now); } catch (e) { setTimeout(() => { throw e; }); }
      }
      if (pending.size) pingFrame();
    };
    const pingFrame = () => {
      if (framePending) return;
      framePending = true;
      if (reallyHidden()) setTimeout(flush, 100);
      else nativeRaf.call(window, flush);
    };
    // A frame requested just before the tab hid would never fire: flush it from
    // the visibilitychange that tells us we are hidden (swallow() calls this
    // before stopping the event, so the site never sees it).
    const nudge = () => {
      if (!reallyHidden() || !framePending) return;
      setTimeout(() => { if (framePending) flush(); }, 150);
    };
    frameNudge = nudge;

    window.requestAnimationFrame = function requestAnimationFrame(cb) {
      const id = nextId++;
      pending.set(id, cb);
      pingFrame();
      return id;
    };
    window.cancelAnimationFrame = function cancelAnimationFrame(id) {
      pending.delete(id);
    };
  }
})();
