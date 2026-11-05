// Interface feel: sound cues, particle feedback and pointer-driven micro-motion.
// One place decides what the app does in response to a pointer, so every page
// behaves the same way and the settings page can switch it all off.
"use strict";
(() => {
  const modules = globalThis.FSRenderer ||= {};

  const DEFAULTS = { sound: "soft", motion: "full", intensity: 0.6, music: "on", musicVolume: 0.5 };
  const SOUNDS = ["off", "soft", "full"];
  const MOTIONS = ["off", "reduced", "full"];
  const MUSIC = ["off", "on"];
  const INTERACTIVE = "button, a, .nav-item, .ai-card, .theme-card, .workspace-shortcut, summary, .item, .file-chip, [data-sfx]";
  const MAGNETIC = ".theme-card";
  const MAX_TILT = 2.6;

  function cueFor(target) {
    if (target.dataset.sfx) return target.dataset.sfx;
    if (target.matches('[data-layout-choice]')) return 'layout';
    if (target.matches('.theme-card')) return 'theme';
    if (target.matches('.nav-item,[data-overview-page],#choose-ai')) return 'navigate';
    if (target.matches('summary')) return 'paper';
    if (target.closest('.segmented,.feedback-option')) return 'toggle';
    return 'click';
  }

  function normalize(feel = {}) {
    const volume = Number(feel.musicVolume);
    return {
      sound: SOUNDS.includes(feel.sound) ? feel.sound : DEFAULTS.sound,
      motion: MOTIONS.includes(feel.motion) ? feel.motion : DEFAULTS.motion,
      intensity: Math.min(1, Math.max(0, Number.isFinite(Number(feel.intensity)) ? Number(feel.intensity) : DEFAULTS.intensity)),
      music: MUSIC.includes(feel.music) ? feel.music : DEFAULTS.music,
      musicVolume: Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : DEFAULTS.musicVolume)),
    };
  }

  function createJuice(options = {}) {
    const doc = options.document || document;
    const win = options.window || window;
    const onChange = typeof options.onChange === "function" ? options.onChange : () => {};
    const body = doc.body;
    const canvas = doc.querySelector("#fx-layer");
    let feel = normalize(options.feel);
    let focused = typeof doc.hasFocus === "function" ? doc.hasFocus() : true;
    let visible = !doc.hidden;
    const sound = modules.Sound.createSoundEngine({ level: feel.sound, active: focused && visible });
    const music = modules.Music
      ? modules.Music.createMusic({ enabled: feel.music === "on", volume: feel.musicVolume, active: focused && visible })
      : null;
    const vfx = modules.VFX.createVFX(canvas, { window: win, handleClicks: false });
    const prefersReduced = win.matchMedia ? win.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
    let lastHover = null;
    let interacted = false, previewIndex = 0;
    let lastSoundLevel = feel.sound === "off" ? "soft" : feel.sound;
    let tiltCard = null;
    let tiltRect = null;
    let tiltFrame = 0, heroCard = null;
    let tiltPoint = { x: 0, y: 0 };
    let destroyed = false;
    const ripples = new Map();
    function clearRipples() { for (const [ring,timer] of ripples) { clearTimeout(timer); ring.remove(); } ripples.clear(); }

    const effectiveMotion = () => (feel.motion === "full" && prefersReduced.matches ? "reduced" : feel.motion);
    const interactiveTarget = (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== "function") return null;
      return target.closest(INTERACTIVE);
    };
    const inTextField = (target) => Boolean(target && target.closest && target.closest("input, textarea, select, [contenteditable='true']"));

    // ── visuals ────────────────────────────────────────────────────────────

    function syncControls() {
      const motion = effectiveMotion();
      body.dataset.motion = motion;
      if (motion === "off") clearRipples();
      const preview = doc.querySelector("#feel-test"), burst = doc.querySelector("#feel-burst"), note = doc.querySelector("#feel-preview-status");
      if (burst) burst.disabled = motion === "off";
      if (preview) { preview.disabled = motion === "off" && feel.sound === "off"; preview.textContent = feel.sound === "off" ? "Preview effects" : motion === "off" ? "Preview sound" : "Sound & burst"; }
      if (note) note.textContent = motion === "off" ? (feel.sound === "off" ? "Enable sound or motion to preview." : "Motion is off. Only sound will play.") : feel.sound === "off" ? "Sound is muted. The preview shows effects only." : "Preview your current sound and motion settings.";
      body.dataset.sound = feel.sound;
      doc.querySelectorAll("[data-feel-motion]").forEach((button) => {
        const active = button.dataset.feelMotion === feel.motion;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-checked", String(active));
      });
      doc.querySelectorAll("[data-feel-sound]").forEach((button) => {
        const active = button.dataset.feelSound === feel.sound;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-checked", String(active));
      });
      const range = doc.querySelector("#feel-intensity");
      if (range) {
        const percent = Math.round(feel.intensity * 100);
        range.value = String(percent);
        range.style.setProperty("--fill", `${percent}%`);
        range.setAttribute("aria-valuetext", `${percent}%`);
      }
      const readout = doc.querySelector("#feel-intensity-value");
      if (readout) readout.textContent = `${Math.round(feel.intensity * 100)}%`;
      doc.querySelectorAll("[data-feel-music]").forEach((button) => {
        const active = button.dataset.feelMusic === feel.music;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-checked", String(active));
      });
      const musicRange = doc.querySelector("#music-volume");
      if (musicRange) {
        const percent = Math.round(feel.musicVolume * 100);
        musicRange.value = String(percent);
        musicRange.style.setProperty("--fill", `${percent}%`);
        musicRange.setAttribute("aria-valuetext", `${percent}%`);
        musicRange.disabled = feel.music !== "on";
      }
      const musicReadout = doc.querySelector("#music-volume-value");
      if (musicReadout) musicReadout.textContent = `${Math.round(feel.musicVolume * 100)}%`;
      const musicToggle = doc.querySelector("#music-toggle");
      if (musicToggle) {
        const paused = feel.music !== "on";
        musicToggle.classList.toggle("is-off", paused);
        musicToggle.setAttribute("aria-pressed", String(!paused));
        musicToggle.setAttribute("aria-label", paused ? "Play ambient music" : "Pause ambient music");
        musicToggle.title = paused ? "Ambient music off" : "Ambient music on";
      }
      body.dataset.music = feel.music;
      const systemNote = doc.querySelector("#feel-system-note");
      if (systemNote) systemNote.hidden = !prefersReduced.matches || feel.motion === "off";
      const toggle = doc.querySelector("#sound-toggle");
      if (toggle) {
        const silent = feel.sound === "off";
        toggle.classList.toggle("is-off", silent);
        toggle.setAttribute("aria-pressed", String(!silent));
        toggle.setAttribute("aria-label", silent ? "Turn interface sound on" : "Mute interface sound");
        toggle.title = silent ? "Interface sound off" : "Interface sound on";
      }
    }

    function apply(next, { notify = false } = {}) {
      const previousSound = feel.sound;
      feel = normalize(next);
      if (feel.sound !== "off") lastSoundLevel = feel.sound;
      sound.setLevel(feel.sound);
      if (music) {
        music.setVolume(feel.musicVolume);
        music.setEnabled(feel.music === "on");
      }
      vfx.setOptions({ intensity: feel.intensity, motion: effectiveMotion() });
      syncControls();
      if (feel.sound !== previousSound) vfx.refresh();
      if (notify) onChange({ ...feel });
    }

    function set(next, { notify = true } = {}) {
      apply(next, { notify });
    }

    function play(name, opts) {
      if (!focused || doc.hidden || (typeof doc.hasFocus === "function" && !doc.hasFocus())) return false;
      return sound.play(name, opts);
    }

    function burstAt(x, y, opts) {
      vfx.burst(x, y, opts);
    }

    // ── pointer feedback ───────────────────────────────────────────────────

    function ripple(x, y, size) {
      if (effectiveMotion() === "off") return;
      if (ripples.size >= 8) {
        const oldest = ripples.keys().next().value;
        clearTimeout(ripples.get(oldest));ripples.delete(oldest);oldest.remove();
      }
      const ring = doc.createElement("span");
      ring.className = "fx-ripple";
      ring.style.left = `${x}px`;
      ring.style.top = `${y}px`;
      ring.style.width = `${size}px`;
      ring.style.height = `${size}px`;
      const remove = () => { clearTimeout(ripples.get(ring)); ripples.delete(ring); ring.remove(); };
      ring.addEventListener("animationend", remove, { once: true });
      ring.addEventListener("animationcancel", remove, { once: true });
      ripples.set(ring, setTimeout(remove, 900));
      body.append(ring);
    }

    function onPointerOver(event) {
      if (destroyed || !interacted) return;
      const target = interactiveTarget(event);
      if (!target || target === lastHover) return;
      lastHover = target;
      if (feel.sound === "off") return;
      play("hover", { pitch: 0.94 + Math.random() * 0.12, power: 0.8 });
    }

    function onPointerOut(event) {
      if (lastHover && !lastHover.contains(event.relatedTarget)) lastHover = null;
    }

    function onPointerDown(event) {
      if (destroyed || (event.button !== undefined && event.button !== 0)) return;
      interacted = true;
      sound.unlock();
      const target = interactiveTarget(event);
      const typing = inTextField(event.target);
      const rect = target && target.getBoundingClientRect ? target.getBoundingClientRect() : null;
      const size = rect ? Math.min(96, Math.max(42, Math.hypot(rect.width, rect.height) * 0.45)) : 52;
      if (target && !typing) {
        ripple(event.clientX, event.clientY, size);
        const name = cueFor(target);
        if (name !== "none") play(name, { power: Math.min(1.4, 0.7 + feel.intensity * 0.6) });
        vfx.burst(event.clientX, event.clientY, { power: 0.75 + feel.intensity * 0.4 });
      } else if (!typing) {
        vfx.burst(event.clientX, event.clientY, { power: 0.45 });
      }
      if (music) music.unlock();
    }

    function onKeyboardActivate(event) {
      // Enter/Space activate with detail 0 and no pointerdown.
      if (event.detail !== 0 || destroyed || event.isTrusted === false) return;
      const target = interactiveTarget(event);
      if (!target || target.dataset.sfx === "none") return;
      interacted = true;
      sound.unlock();
      play(cueFor(target), { power: 0.8 });
      const rect = target.getBoundingClientRect();
      ripple(rect.left + rect.width / 2, rect.top + rect.height / 2, Math.min(96, Math.max(42, rect.width * 0.5)));
      vfx.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, { power: 0.8 });
    }

    // ── micro-motion ───────────────────────────────────────────────────────

    function resetTilt() {
      if (!tiltCard) return;
      tiltCard.style.removeProperty("--tilt-x");
      tiltCard.style.removeProperty("--tilt-y");
      tiltCard.style.removeProperty("--tilt-glow");
      tiltCard = null;
      tiltRect = null;
    }

    function paintTilt() {
      tiltFrame = 0;
      if(destroyed || doc.hidden || effectiveMotion()!=='full')return;
      if(heroCard?.isConnected){const rect=heroCard.getBoundingClientRect();heroCard.style.setProperty('--spot-x',`${(tiltPoint.x-rect.left).toFixed(0)}px`);heroCard.style.setProperty('--spot-y',`${(tiltPoint.y-rect.top).toFixed(0)}px`);}
      if (!tiltCard || !tiltRect) return;
      const nx = (tiltPoint.x - (tiltRect.left + tiltRect.width / 2)) / (tiltRect.width / 2 || 1);
      const ny = (tiltPoint.y - (tiltRect.top + tiltRect.height / 2)) / (tiltRect.height / 2 || 1);
      tiltCard.style.setProperty("--tilt-y", `${(-ny * MAX_TILT).toFixed(2)}deg`);
      tiltCard.style.setProperty("--tilt-x", `${(nx * MAX_TILT).toFixed(2)}deg`);
      tiltCard.style.setProperty("--tilt-glow-x", `${((nx + 1) * 50).toFixed(1)}%`);
      tiltCard.style.setProperty("--tilt-glow-y", `${((ny + 1) * 50).toFixed(1)}%`);
    }

    function onPointerMove(event) {
      if (destroyed || effectiveMotion() !== "full") return;
      heroCard = event.target?.closest?.('.launch-hero') || null;
      const card = event.target?.closest?.(MAGNETIC) || null;
      if(card!==tiltCard){resetTilt();tiltCard=card;tiltRect=card?.getBoundingClientRect()||null;}
      tiltPoint={x:event.clientX,y:event.clientY};
      if((heroCard||tiltCard)&&!tiltFrame)tiltFrame=win.requestAnimationFrame(paintTilt);
    }

    function onScrollOrResize() {
      heroCard=null;
      resetTilt();
    }

    // ── settings controls ─────────────────────────────────────────────────

    function bindControls() {
      doc.querySelectorAll("[data-feel-motion]").forEach((button) => {
        button.addEventListener("click", () => set({ ...feel, motion: button.dataset.feelMotion }));
      });
      doc.querySelectorAll("[data-feel-sound]").forEach((button) => {
        button.addEventListener("click", () => set({ ...feel, sound: button.dataset.feelSound }));
      });
      const range = doc.querySelector("#feel-intensity");
      if (range) {
        let timer = 0;
        range.addEventListener("input", () => {
          const next = normalize({ ...feel, intensity: Number(range.value) / 100 });
          feel = next;
          sound.setLevel(feel.sound);
          vfx.setOptions({ intensity: feel.intensity, motion: effectiveMotion() });
          syncControls();
          clearTimeout(timer);
          timer = setTimeout(() => onChange({ ...feel }), 260);
        });
      }
      const toggle = doc.querySelector("#sound-toggle");
      if (toggle) {
        toggle.addEventListener("click", () => {
          const next = feel.sound === "off" ? lastSoundLevel : "off";
          set({ ...feel, sound: next });
          if (next !== "off") play("toggle", { power: 1.1 });
        });
      }
      doc.querySelectorAll("[data-feel-music]").forEach((button) => {
        button.addEventListener("click", () => {
          const next = button.dataset.feelMusic === "on" ? "on" : "off";
          set({ ...feel, music: next });
          play(next === "on" ? "toggle" : "close");
        });
      });
      const musicRange = doc.querySelector("#music-volume");
      if (musicRange) {
        let timer = 0;
        musicRange.addEventListener("input", () => {
          const next = normalize({ ...feel, musicVolume: Number(musicRange.value) / 100 });
          feel = next;
          if (music) music.setVolume(feel.musicVolume);
          syncControls();
          clearTimeout(timer);
          timer = setTimeout(() => onChange({ ...feel }), 260);
        });
      }
      const musicToggle = doc.querySelector("#music-toggle");
      if (musicToggle) {
        musicToggle.addEventListener("click", () => {
          const next = feel.music === "on" ? "off" : "on";
          set({ ...feel, music: next });
          play(next === "on" ? "toggle" : "close");
        });
      }
      const test = doc.querySelector("#feel-test");
      if (test) {
        test.addEventListener("click", () => {
          interacted = true;
          sound.unlock();
          const rect = test.getBoundingClientRect();
          const previews = [['navigate','Navigation'],['click','Soft click'],['theme','Glass'],['success','Confirmation'],['paper','Paper']];
          const [cue,label] = previews[previewIndex++ % previews.length];
          play(cue);
          const status = doc.querySelector('#feel-preview-status');
          if (status) status.textContent = feel.sound === 'off' ? 'Sound is off.' : `${label} sound`;
          vfx.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, { power: 1.3, tone: cue === 'success' ? 'ok' : undefined });
        });
      }
      const testBurst = doc.querySelector("#feel-burst");
      if (testBurst) {
        testBurst.addEventListener("click", () => {
          const rect = testBurst.getBoundingClientRect();
          vfx.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, { power: 1.4 });
        });
      }
    }

    function signal(tone) {
      if (feel.sound === "off") return;
      if (tone === "success") play("success");
      else if (tone === "error") play("error", { power: 0.9 });
      else if (tone === "connect") play("connect");
    }

    // Music only runs while this window is the one being looked at.

    function syncPresence() {
      sound.setActive(focused && visible);
      if (music) music.setActive(focused && visible);
      vfx.setActive?.(focused && visible);
      body.dataset.fxPaused=String(!focused || !visible);
      if(!focused||!visible){heroCard=null;resetTilt();clearRipples();if(tiltFrame)win.cancelAnimationFrame(tiltFrame);tiltFrame=0;}
    }

    function onFocus() {
      focused = true;
      visible = !doc.hidden;
      syncPresence();
    }

    function onBlur() {
      focused = false;
      syncPresence();
    }

    function onVisibility() {
      visible = !doc.hidden;
      syncPresence();
    }

    win.addEventListener("focus", onFocus);
    win.addEventListener("blur", onBlur);
    doc.addEventListener("visibilitychange", onVisibility);
    syncPresence();

    win.addEventListener("pointerover", onPointerOver, { passive: true });
    win.addEventListener("pointerout", onPointerOut, { passive: true });
    win.addEventListener("pointerdown", onPointerDown, { passive: true });
    win.addEventListener("pointermove", onPointerMove, { passive: true });
    win.addEventListener("scroll", onScrollOrResize, { passive: true, capture: true });
    win.addEventListener("resize", onScrollOrResize);
    doc.addEventListener("click", onKeyboardActivate);
    if (prefersReduced.addEventListener) prefersReduced.addEventListener("change", syncControls);

    function destroy() {
      destroyed = true;
      clearRipples();
      prefersReduced.removeEventListener?.("change", syncControls);
      win.removeEventListener("pointerover", onPointerOver);
      win.removeEventListener("pointerout", onPointerOut);
      win.removeEventListener("pointerdown", onPointerDown);
      win.removeEventListener("pointermove", onPointerMove);
      win.removeEventListener("scroll", onScrollOrResize, { capture: true });
      win.removeEventListener("resize", onScrollOrResize);
      doc.removeEventListener("click", onKeyboardActivate);
      doc.removeEventListener("visibilitychange", onVisibility);
      win.removeEventListener("focus", onFocus);
      win.removeEventListener("blur", onBlur);
      if (tiltFrame) win.cancelAnimationFrame(tiltFrame);
      resetTilt();
      vfx.destroy();
      sound.destroy();
      if (music) music.destroy();
    }

    apply(feel);

    return {
      apply: (next) => apply(next),
      set,
      get: () => ({ ...feel }),
      bindControls,
      play,
      burstAt,
      signal,
      sync: syncControls,
      refresh: () => vfx.refresh(),
      musicState: () => (music ? { enabled: music.enabled, playing: music.playing, volume: music.volume, supported: music.supported } : null),
      destroy,
    };
  }

  modules.Juice = { createJuice, normalize, DEFAULTS, MAX_TILT, cueFor };
})();
