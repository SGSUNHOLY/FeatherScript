// Generative ambient music. A slow four-chord pad, a quiet bass and occasional
// bells, synthesised with WebAudio so the app ships no audio files.
"use strict";
(() => {
  const modules = globalThis.FSRenderer ||= {};

  // Warm, unresolved progression in D: Dmaj7 - Bm7 - Gmaj7 - A7sus4.
  const CHORDS = [
    { bass: 38, notes: [50, 57, 61, 66] },
    { bass: 35, notes: [47, 54, 57, 62] },
    { bass: 31, notes: [43, 50, 54, 59] },
    { bass: 33, notes: [45, 52, 55, 62] },
  ];
  const BELLS = [74, 76, 78, 81, 83, 86];
  const CHORD_SECONDS = 8.4;
  const LOOKAHEAD = 2.5;
  const MIN_GAIN = 0.0001;
  const MASTER = 2.8;
  const DEFAULT_VOLUME = 0.5;

  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  function createMusic(options = {}) {
    const AudioCtor = options.AudioContext || (typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext));
    let enabled = options.enabled === undefined ? true : Boolean(options.enabled);
    let volume = Math.min(1, Math.max(0, Number(options.volume ?? DEFAULT_VOLUME)));
    let ctx = null;
    let master = null;
    let padBus = null;
    let bellBus = null;
    let timer = 0;
    let nextChord = 0;
    let chordIndex = 0;
    let active = options.active !== false;
    let lastError = null;

    const targetGain = () => (enabled && active ? volume * MASTER : 0);

    function connect(node, to) {
      try { node.connect(to); } catch (error) { lastError = error; }
    }

    function makeImpulse(seconds) {
      const rate = ctx.sampleRate;
      const length = Math.max(1, Math.floor(rate * seconds));
      const buffer = ctx.createBuffer(2, length, rate);
      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < length; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.1);
        }
      }
      return buffer;
    }

    function build() {
      master = ctx.createGain();
      master.gain.value = MIN_GAIN;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 6;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.004;
      limiter.release.value = 0.25;
      connect(master, limiter);
      connect(limiter, ctx.destination);

      const dry = ctx.createGain();
      dry.gain.value = 0.62;
      connect(dry, master);

      const wet = ctx.createGain();
      wet.gain.value = 0.5;
      const reverb = ctx.createConvolver();
      reverb.buffer = makeImpulse(2.9);
      connect(wet, reverb);
      connect(reverb, master);

      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 880;
      filter.Q.value = 0.6;
      connect(filter, dry);
      connect(filter, wet);

      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 0.045;
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 170;
      connect(lfo, lfoDepth);
      connect(lfoDepth, filter.frequency);
      lfo.start(0);

      padBus = ctx.createGain();
      padBus.gain.value = 0.55;
      connect(padBus, filter);

      bellBus = ctx.createGain();
      bellBus.gain.value = 1;
      const bellWet = ctx.createGain();
      bellWet.gain.value = 0.55;
      const bellDry = ctx.createGain();
      bellDry.gain.value = 0.3;
      connect(bellBus, bellWet);
      connect(bellWet, wet);
      connect(bellBus, bellDry);
      connect(bellDry, master);
    }

    function ensure() {
      if (!AudioCtor) return null;
      if (!ctx) {
        try {
          ctx = new AudioCtor();
          build();
        } catch (error) {
          lastError = error;
          ctx = null;
          return null;
        }
      }
      if (ctx.state === "suspended") {
        try {
          const resumed = ctx.resume();
          if (resumed && typeof resumed.catch === "function") resumed.catch(() => {});
        } catch (error) {
          lastError = error;
        }
      }
      return ctx;
    }

    function padNote(freq, start, end, peak, detune, type) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      if (osc.detune && detune) osc.detune.value = detune;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(MIN_GAIN, start);
      gain.gain.linearRampToValueAtTime(peak, start + 2.4);
      gain.gain.setValueAtTime(peak, Math.max(start + 2.4, end - 2.1));
      gain.gain.exponentialRampToValueAtTime(MIN_GAIN, end + 2.8);
      connect(osc, gain);
      connect(gain, padBus);
      osc.start(start);
      osc.stop(end + 2.9);
      osc.onended = () => {
        try { osc.disconnect(); gain.disconnect(); } catch {}
      };
    }

    function bell(start, midi) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = midiToFreq(midi);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(MIN_GAIN, start);
      gain.gain.linearRampToValueAtTime(0.07, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(MIN_GAIN, start + 3.4);
      connect(osc, gain);
      if (typeof ctx.createStereoPanner === "function") {
        const panner = ctx.createStereoPanner();
        panner.pan.value = (Math.random() * 2 - 1) * 0.7;
        connect(gain, panner);
        connect(panner, bellBus);
      } else {
        connect(gain, bellBus);
      }
      osc.start(start);
      osc.stop(start + 3.5);
      osc.onended = () => {
        try { osc.disconnect(); gain.disconnect(); } catch {}
      };
    }

    function playChord(start) {
      const chord = CHORDS[chordIndex % CHORDS.length];
      chordIndex++;
      const end = start + CHORD_SECONDS;
      for (const note of chord.notes) {
        padNote(midiToFreq(note), start, end, 0.04, 0, "sine");
        padNote(midiToFreq(note) * 1.004, start, end, 0.016, 7, "triangle");
      }
      padNote(midiToFreq(chord.bass), start, end, 0.072, 0, "sine");

      const bells = 1 + (Math.random() < 0.55 ? 1 : 0);
      for (let i = 0; i < bells; i++) {
        const at = start + 1.2 + Math.random() * (CHORD_SECONDS - 3.4);
        bell(at, BELLS[Math.floor(Math.random() * BELLS.length)]);
      }
    }

    function schedule() {
      if (!ctx || !timer || !active || !enabled) return;
      const now = ctx.currentTime;
      if (nextChord < now - 0.5) nextChord = now + 0.2;
      let guard = 0;
      while (nextChord < now + LOOKAHEAD && guard++ < 4) {
        try {
          playChord(nextChord);
        } catch (error) {
          lastError = error;
        }
        nextChord += CHORD_SECONDS;
      }
    }

    function start() {
      if (!enabled || !active) return false;
      const c = ensure();
      if (!c) return false;
      if (timer) {
        master.gain.setTargetAtTime(targetGain(), c.currentTime, 0.4);
        return true;
      }
      nextChord = c.currentTime + 0.2;
      timer = setInterval(schedule, 500);
      schedule();
      master.gain.cancelScheduledValues(c.currentTime);
      master.gain.setValueAtTime(MIN_GAIN, c.currentTime);
      master.gain.setTargetAtTime(targetGain(), c.currentTime, 2.4);
      return true;
    }

    function stop(fade = 0.9) {
      if (timer) {
        clearInterval(timer);
        timer = 0;
      }
      if (ctx && master) {
        master.gain.cancelScheduledValues(ctx.currentTime);
        if (fade > 0) master.gain.setTargetAtTime(0, ctx.currentTime, fade);
        else master.gain.setValueAtTime(0, ctx.currentTime);
      }
    }

    // Switching away from the app silences the loop; coming back picks it up
    // again unless music is switched off in the profile.
    function setActive(next) {
      const want = Boolean(next);
      if (want === active) return;
      active = want;
      if (!active) stop(0);
      else if (enabled) start();
    }

    function setEnabled(next) {
      enabled = Boolean(next);
      if (!enabled) stop();
      else if (ctx || AudioCtor) start();
    }

    function setVolume(next) {
      volume = Math.min(1, Math.max(0, Number(next) || 0));
      if (ctx && master) master.gain.setTargetAtTime(targetGain(), ctx.currentTime, 0.35);
    }

    function unlock() {
      if (!enabled) return false;
      return start();
    }

    function destroy() {
      stop();
      if (!ctx) return;
      try { ctx.close(); } catch {}
      ctx = null;
      master = null;
      padBus = null;
      bellBus = null;
    }

    if (enabled) start();

    return {
      start,
      stop,
      unlock,
      destroy,
      setEnabled,
      setVolume,
      setActive,
      get enabled() { return enabled; },
      get playing() { return Boolean(timer); },
      get active() { return active; },
      get volume() { return volume; },
      get lastError() { return lastError; },
      get supported() { return Boolean(AudioCtor); },
    };
  }

  modules.Music = { createMusic, CHORDS, BELLS, midiToFreq, DEFAULT_VOLUME };
})();
