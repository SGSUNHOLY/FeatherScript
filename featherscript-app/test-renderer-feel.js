// Interface feel: sound presets, settings normalisation and particle helpers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ globalThis: {}, setTimeout, clearTimeout, setInterval, clearInterval, performance });
for (const name of ['sfx.js', 'music.js', 'vfx.js', 'juice.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'renderer/modules', name), 'utf8'), context);
}
const { Sound, Music, VFX, Juice } = context.globalThis.FSRenderer;

// ── settings normalisation ────────────────────────────────────────────────
assert.deepEqual(
  { ...Juice.normalize({ sound: 'loud', motion: 'bouncy', intensity: '9' }) },
  { sound: 'soft', motion: 'full', intensity: 1, music: 'on', musicVolume: 0.5 },
  'unknown levels fall back to defaults and intensity is clamped'
);
assert.equal(Juice.normalize({ intensity: 0 }).intensity, 0, 'zero intensity must survive normalisation');
assert.equal(Juice.normalize({}).sound, 'soft');
assert.equal(Juice.normalize({ music: 'loud' }).music, 'on', 'unknown music modes fall back to on');
assert.equal(Juice.normalize({ musicVolume: '4' }).musicVolume, 1, 'music volume is clamped');

// ── colour parsing for the particle palette ───────────────────────────────
assert.equal(VFX.hexToRgb('#38bdf8', null).join(','), '56,189,248');
assert.equal(VFX.hexToRgb('nope', [1, 2, 3]).join(','), '1,2,3');
assert.equal(VFX.clamp(12, 0, 10), 10);

// ── sound engine ──────────────────────────────────────────────────────────
class Param {
  constructor() { this.value = 0; }
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
  cancelScheduledValues() {}
  setTargetAtTime(value) { this.value = value; }
}
class Node {
  constructor() {
    this.gain = new Param();
    this.frequency = new Param();
    this.detune = new Param();
    this.Q = new Param();
    this.pan = new Param();
    this.buffer = null;
    this.threshold = new Param();
    this.knee = new Param();
    this.ratio = new Param();
    this.attack = new Param();
    this.release = new Param();
  }
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
}
class FakeContext {
  static instances = [];
  constructor() {
    FakeContext.instances.push(this);
    this.gains = [];
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 44100;
    this.destination = new Node();
    this.created = 0;
    this.closed = false;
  }
  createGain() { this.created++; const node = new Node(); this.gains.push(node); return node; }
  createOscillator() { this.created++; return new Node(); }
  createBiquadFilter() { this.created++; return new Node(); }
  createBufferSource() { this.created++; return new Node(); }
  createStereoPanner() { this.created++; return new Node(); }
  createConvolver() { this.created++; return new Node(); }
  createDynamicsCompressor() { this.created++; return new Node(); }
  createBuffer(_channels, length) { return { getChannelData: () => new Float32Array(length) }; }
  resume() { return Promise.resolve(); }
  close() { this.closed = true; this.state = 'closed'; }
}

const engine = Sound.createSoundEngine({ AudioContext: FakeContext, level: 'soft' });
assert.equal(engine.supported, true);
assert.equal(engine.play('missing'), false, 'unknown cues are ignored');
assert.equal(engine.play('click'), true, 'click creates a voice');
assert.equal(engine.play('click'), false, 'repeat clicks inside the throttle window are dropped');
assert.equal(engine.play('success'), true, 'arpeggio cue plays');
engine.setLevel('off');
assert.equal(engine.play('success'), false, 'muting stops every cue');
engine.setLevel('soft');
assert.ok(Object.keys(Sound.PRESETS).length >= 8, 'the cue palette is present');
assert.equal(Sound.volumeFor('off'), 0);
engine.setActive(false);
const sfxMaster = FakeContext.instances[0].gains[0];
assert.equal(sfxMaster.gain.value, 0, 'blur immediately silences existing cues');
assert.equal(engine.play('error'), false, 'background signals cannot play');
assert.equal(engine.unlock(), false, 'background events cannot unlock audio');
engine.setLevel('full');
assert.equal(sfxMaster.gain.value, 0, 'profile/volume updates cannot unmute a background window');
engine.setActive(true);
assert.equal(engine.play('error'), true, 'foreground cues resume');
engine.destroy();
const beforeInactive = FakeContext.instances.length;
const inactiveSound = Sound.createSoundEngine({ AudioContext: FakeContext, active: false });
assert.equal(inactiveSound.unlock(), false);
assert.equal(inactiveSound.play('connect'), false);
assert.equal(FakeContext.instances.length, beforeInactive, 'unfocused startup creates no cue context');

const silent = Sound.createSoundEngine({ level: 'off' });
assert.equal(silent.play('hover'), false, 'an engine created muted stays silent');
assert.equal(silent.supported, false, 'without WebAudio the engine degrades instead of throwing');

// ── generative music ──────────────────────────────────────────────────────
assert.equal(Music.midiToFreq(69), 440, 'MIDI 69 is concert A');
assert.ok(Music.CHORDS.length >= 4, 'the progression has four chords');
const music = Music.createMusic({ AudioContext: FakeContext, enabled: true, volume: 0.5 });
assert.equal(music.supported, true);
assert.equal(music.playing, true, 'music starts scheduling chords');
assert.equal(music.volume, 0.5);
music.setVolume(3);
assert.equal(music.volume, 1, 'music volume is clamped');
music.setEnabled(false);
assert.equal(music.playing, false, 'turning music off stops the scheduler');
assert.equal(music.enabled, false);
music.setEnabled(true);
assert.equal(music.playing, true, 'turning music back on resumes scheduling');
music.setActive(false);
const musicMaster = FakeContext.instances.at(-1).gains[0];
assert.equal(musicMaster.gain.value, 0, 'blur immediately silences music tails');
music.setVolume(0.8);
assert.equal(musicMaster.gain.value, 0, 'background volume updates keep music muted');
assert.equal(music.playing, false, 'leaving the window stops the scheduler');
assert.equal(music.active, false);
assert.equal(music.start(), false, 'a backgrounded window refuses to start');
music.setEnabled(true);
assert.equal(music.playing, false, 're-enabling while backgrounded stays silent');
music.setActive(true);
assert.equal(music.playing, true, 'coming back resumes the loop');
music.destroy();
assert.equal(music.playing, false, 'destroy clears the scheduler');
const beforeInactiveMusic = FakeContext.instances.length;
const inactiveMusic = Music.createMusic({ AudioContext: FakeContext, enabled: true, active: false });
assert.equal(inactiveMusic.playing, false);
assert.equal(FakeContext.instances.length, beforeInactiveMusic, 'unfocused startup creates no music context');
inactiveMusic.destroy();

const muteMusic = Music.createMusic({ enabled: false });
assert.equal(muteMusic.supported, false, 'without WebAudio music degrades instead of throwing');
assert.equal(muteMusic.start(), false, 'a muted mixer declines to start');
muteMusic.destroy();

console.log('PASS feel settings, particle helpers, procedural sound cues and ambient music');

for(const cue of ['navigate','theme','layout','paper','toggle','click','open','close','success']){const e=Sound.createSoundEngine({AudioContext:FakeContext,level:'full'});assert.equal(e.play(cue),true,cue);assert.equal(e.lastError,null);e.setActive(false);assert.equal(e.play(cue),false);e.destroy();}
const beforeBudget=FakeContext.instances.length;const budget=Sound.createSoundEngine({AudioContext:FakeContext,maxVoices:2});assert.equal(budget.play('navigate'),false,'whole cue must fit voice budget');assert.equal(FakeContext.instances.length,beforeBudget);assert.equal(budget.play('click'),true);assert.equal(budget.play('tick'),false);budget.destroy();console.log('PASS new cues, inactive mute and complete cue voice budget');
