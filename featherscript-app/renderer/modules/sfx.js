// Procedural interface sound. No audio files: every cue is a short WebAudio
// envelope, so the app stays asset-free and silent until the first gesture.
"use strict";
(() => {
  const modules = globalThis.FSRenderer ||= {};

  // kind tone: one pitched blip. kind notes: a tiny arpeggio. kind noise: filtered sweep.
  const PRESETS = {
    hover: { kind: "tone", wave: "sine", from: 1150, to: 1320, dur: 0.04, gain: 0.035, throttle: 80 },
    tick: { kind: "tone", wave: "triangle", from: 1380, to: 1080, dur: 0.045, gain: 0.07, throttle: 55 },
    click: {
      kind: "tone", wave: "triangle", from: 720, to: 420, dur: 0.07, gain: 0.2, throttle: 45,
      noise: { from: 2100, to: 900, dur: 0.035, gain: 0.025 },
    },
    open: { kind: "notes", wave: "sine", notes: [440, 554.37], step: 0.035, dur: 0.15, gain: 0.12, throttle: 160 },
    close: { kind: "notes", wave: "sine", notes: [554.37, 440], step: 0.03, dur: 0.13, gain: 0.1, throttle: 160 },
    success: { kind: "notes", wave: "sine", notes: [440, 660, 880], step: 0.045, dur: 0.29, gain: 0.12, throttle: 240 },
    error: { kind: "notes", wave: "sine", notes: [220, 164.81], step: 0.08, dur: 0.18, gain: 0.1, throttle: 240 },
    connect: { kind: "notes", wave: "sine", notes: [659.25, 987.77, 1318.5], step: 0.05, dur: 0.3, gain: 0.12, throttle: 400 },
    toggle: { kind: "tone", wave: "sine", from: 620, to: 930, dur: 0.07, gain: 0.12, throttle: 80 },
    navigate: { kind: "notes", wave: "sine", notes: [330, 440], step: 0.03, dur: 0.13, gain: 0.12, throttle: 120,
      noise: { from: 800, to: 2200, dur: 0.09, gain: 0.018 } },
    theme: { kind: "notes", wave: "sine", notes: [880, 1320, 1760], step: 0.04, dur: 0.27, gain: 0.075, throttle: 180 },
    layout: { kind: "noise", from: 480, to: 1600, dur: 0.2, gain: 0.16, q: 0.7, attack: 0.025, throttle: 280 },
    paper: { kind: "noise", from: 2600, to: 700, dur: 0.13, gain: 0.12, q: 0.8, throttle: 160 },
  };

  const VOLUMES = { off: 0, soft: 0.42, full: 1 };
  const MIN_GAIN = 0.0001;

  function volumeFor(level) {
    return Object.prototype.hasOwnProperty.call(VOLUMES, level) ? VOLUMES[level] : VOLUMES.soft;
  }

  function createSoundEngine(options = {}) {
    const maxVoices = options.maxVoices || 12;
    const AudioCtor = options.AudioContext || (typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext));
    let ctx = null;
    let master = null;
    let noiseBuffer = null;
    let level = typeof options.level === "string" ? options.level : "soft";
    let voices = 0;
    let active = options.active !== false;
    let lastError = null;
    const lastPlayed = new Map();

    function ensure() {
      if (!AudioCtor) return null;
      if (!ctx) {
        try {
          ctx = new AudioCtor();
        } catch {
          return null;
        }
        master = ctx.createGain();
        master.gain.value = active ? volumeFor(level) : 0;
        master.connect(ctx.destination);
      }
      if (ctx.state === "suspended") {
        const resumed = ctx.resume();
        if (resumed && typeof resumed.catch === "function") resumed.catch(() => {});
      }
      return ctx;
    }

    function noise(c) {
      if (!noiseBuffer) {
        const length = Math.floor(c.sampleRate * 0.35);
        noiseBuffer = c.createBuffer(1, length, c.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      }
      const source = c.createBufferSource();
      source.buffer = noiseBuffer;
      return source;
    }

    function envelope(attack, dur, peak, start) {
      const node = ctx.createGain();
      const end = start + dur;
      node.gain.setValueAtTime(MIN_GAIN, start);
      node.gain.exponentialRampToValueAtTime(Math.max(MIN_GAIN, peak), start + attack);
      node.gain.exponentialRampToValueAtTime(MIN_GAIN, end);
      return { node, end };
    }

    function trackVoice(end) {
      voices++;
      const release = Math.max(0, (end - (ctx.currentTime || 0)) * 1000) + 60;
      setTimeout(() => { voices = Math.max(0, voices - 1); }, release);
    }

    function tone(c, spec, pitch, power, pan, delay = 0) {
      const start = c.currentTime + delay;
      const dur = spec.dur || 0.1;
      const osc = c.createOscillator();
      osc.type = spec.wave || "sine";
      const from = (spec.from || 440) * pitch;
      const to = (spec.to || spec.from || 440) * pitch;
      osc.frequency.setValueAtTime(from, start);
      if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + dur);
      const gain = envelope(0.006, dur, (spec.gain || 0.2) * power, start);
      gain.node.connect(master);
      osc.connect(gain.node);
      let tail = osc;
      if (pan && typeof c.createStereoPanner === "function") {
        const panner = c.createStereoPanner();
        panner.pan.value = Math.max(-1, Math.min(1, pan));
        gain.node.disconnect();
        gain.node.connect(panner);
        panner.connect(master);
        tail = panner;
      }
      osc.start(start);
      osc.stop(gain.end + 0.02);
      osc.onended = () => {
        try { osc.disconnect(); gain.node.disconnect(); if (tail !== osc) tail.disconnect(); } catch {}
      };
      trackVoice(gain.end);
    }

    function bandNoise(c, spec, power) {
      const t = c.currentTime;
      const dur = spec.dur || 0.1;
      const source = noise(c);
      const filter = c.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = spec.q || 1.1;
      filter.frequency.setValueAtTime(spec.from || 1200, t);
      if (spec.to) filter.frequency.exponentialRampToValueAtTime(Math.max(80, spec.to), t + dur);
      const gain = envelope(spec.attack || 0.01, dur, (spec.gain || 0.1) * power, t);
      gain.node.connect(master);
      source.connect(filter);
      filter.connect(gain.node);
      source.start(t);
      source.stop(gain.end + 0.02);
      source.onended = () => {
        try { source.disconnect(); filter.disconnect(); gain.node.disconnect(); } catch {}
      };
      trackVoice(gain.end);
    }

    function play(name, opts = {}) {
      if (!active || level === "off") return false;
      const spec = PRESETS[name];
      if (!spec) return false;
      const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
      const gate = spec.throttle || 40;
      const previous = lastPlayed.get(name);
      if (previous !== undefined && now - previous < gate) return false;
      const requiredVoices = (spec.kind === "notes" ? spec.notes.length : 1) + (spec.noise ? 1 : 0);
      if (voices + requiredVoices > maxVoices) return false;
      const c = ensure();
      if (!c || !master) return false;
      lastPlayed.set(name, now);
      const pitch = Math.max(0.4, Math.min(2.5, Number(opts.pitch) || 1));
      const power = Math.max(0, Math.min(2, Number(opts.power) || 1));
      const pan = Number(opts.pan) || 0;
      try {
        if (spec.kind === "notes") {
          spec.notes.forEach((freq, index) => {
            tone(c, {
              wave: spec.wave, from: freq, dur: spec.dur, gain: spec.gain,
            }, pitch, power, pan, index * (spec.step || 0.06));
          });
        } else if (spec.kind === "noise") {
          bandNoise(c, spec, power);
        } else {
          tone(c, spec, pitch, power, pan);
        }
        if (spec.noise) bandNoise(c, spec.noise, power);
      } catch (error) {
        lastError = error;
        return false;
      }
      return true;
    }

    function setLevel(next) {
      level = Object.prototype.hasOwnProperty.call(VOLUMES, next) ? next : "soft";
      if (ctx && master) {
        const target = active ? volumeFor(level) : 0;
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setTargetAtTime(target, now, 0.03);
      }
    }

    function unlock() {
      if (!active || level === "off") return false;
      return Boolean(ensure());
    }

    function setActive(next) {
      active = Boolean(next);
      if (!ctx || !master) return;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(active ? volumeFor(level) : 0, ctx.currentTime);
    }

    function destroy() {
      if (!ctx) return;
      try { ctx.close(); } catch {}
      ctx = null;
      master = null;
      noiseBuffer = null;
      voices = 0;
    }

    return {
      play,
      unlock,
      destroy,
      setLevel,
      setActive,
      get level() { return level; },
      get lastError() { return lastError; },
      get supported() { return Boolean(AudioCtor); },
      presets: PRESETS,
    };
  }

  modules.Sound = { createSoundEngine, PRESETS, VOLUMES, volumeFor };
})();
