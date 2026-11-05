// Node smoke test for the Start readiness gate (run: node test-start-studio-gate.js).
// Not shipped.
//
// StudioMCP advertises Roblox's whole tool catalogue with NO Studio attached, so
// "the bridge gave us 84 tools" never proved the agent could actually run a
// command. Start used to announce "Agent ready" on that evidence alone, the model
// repeated it, and the first real command then failed or stalled while Studio
// attached ~20-30s later. These checks pin the two halves of the fix: the wait
// happens before any readiness claim, and it costs nothing when Studio is
// already attached.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'core/main.js'), 'utf8');
const start = source.indexOf('  const STUDIO_WAIT_MS = 30000;');
const end = source.indexOf('  async function startSession(', start);
assert.ok(start > 0 && end > start, 'the Studio wait helper sits next to the bootstrap it gates');
// A 30s deadline would make the timeout case a 30s test; the shape is what matters.
const slice = source.slice(start, end).replace('STUDIO_WAIT_MS = 30000', 'STUDIO_WAIT_MS = 2500');

function harness(snapshots) {
  const polls = [];
  let i = 0;
  const A = { bridge: snapshots[0] };
  const ui = { setStarting() { ui.renders++; }, renders: 0 };
  const bg = (msg) => {
    polls.push(msg);
    // Each status request hands back the next scripted snapshot, exactly like the
    // bridge's push-driven cache does when Studio attaches mid-wait.
    A.bridge = snapshots[Math.min(++i, snapshots.length - 1)];
    return Promise.resolve(A.bridge);
  };
  const context = vm.createContext({ A, ui, bg, onStatus: () => {}, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), Date });
  const { waitForStudio } = vm.runInNewContext(slice + ';({ waitForStudio });', context);
  return { A, ui, polls, waitForStudio };
}

(async () => {
  // ── 1. Attached, or unknowable: Start must not add a single round trip ─────
  for (const snapshot of [{ studio: true }, { studio: null }, undefined,
    // A bridge with no Roblox server configured can never attach a Studio.
    { studio: false, servers: [{ id: 'blender', alive: true, tools: 5 }] }]) {
    const h = harness([snapshot]);
    assert.equal(await h.waitForStudio(Date.now()), true, JSON.stringify(snapshot));
    assert.equal(h.polls.length, 0, 'a Studio that is already usable is never polled');
    assert.equal(h.A.startWait, undefined, 'and no countdown is shown');
  }

  // ── 2. Studio attaches mid-wait: the gate resolves on the flip ────────────
  const roblox = [{ id: 'roblox', alive: true, tools: 34 }];
  {
    const h = harness([{ studio: false, servers: roblox }, { studio: false, servers: roblox }, { studio: true, servers: roblox }]);
    assert.equal(await h.waitForStudio(Date.now()), true, 'the wait ends the moment Studio attaches');
    assert.equal(h.polls.length, 2, 'each second asks the bridge for a fresh snapshot');
    assert.ok(h.ui.renders >= 1, 'the bar is re-rendered so the countdown is visible');
    assert.match(String(h.A.startWait), /^\d+$/, 'and it says how long is left');
  }

  // ── 3. Never attaches: a truthful no, with the countdown stopping at 1s ───
  {
    const h = harness([{ studio: false, servers: roblox }]);
    const at = Date.now();
    assert.equal(await h.waitForStudio(at), false, 'a Studio that never attaches is reported as such');
    assert.ok(Date.now() - at >= 2400, 'the deadline is honoured, not guessed');
    assert.equal(h.A.startWait, 1, 'the countdown never shows 0s or a negative wait');
  }

  // ── 4. Ordering: nothing may claim readiness before the gate ──────────────
  {
    const gate = source.indexOf('await waitForStudio(startAt)', end);
    const prompt = source.indexOf('const prompt = systemPrompt()+handoff;', end);
    const handshake = source.indexOf('submitAndGetBase(prompt)', prompt);
    const toast = source.indexOf('Send ${P.displayName} your next task.', handshake);
    assert.ok(gate > 0 && gate < prompt, 'the Studio gate runs before the prompt is even built');
    assert.ok(toast > handshake, 'the ready toast still follows the model handshake');
    assert.match(source.slice(gate - 300, gate), /opts\.degraded/,
      'only the deliberate "start with Roblox offline" choice skips the wait');
    assert.match(source.slice(gate - 300, gate), /scriptMode !== 'agent'/,
      'and an AgentScript session, which exposes no Roblox tools, never waits for one');
  }
  console.log('PASS Start waits for a real Studio attach, stays instant when attached, and never claims ready first');
})().catch((error) => { console.error(error); process.exitCode = 1; });
