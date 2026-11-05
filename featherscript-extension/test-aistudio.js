const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function test() {
  let editor, remount = false, paused = false, clicks = 0;
  const makeEditor = () => ({ isConnected: true, value: '', closest: () => frame });
  const frame = {};
  const send = { disabled: false, getAttribute: () => null, click: () => clicks++ };
  const document = { querySelector: () => null, querySelectorAll: () => [] };
  const D = {
    first(selectors, root) {
      if (selectors.includes('ms-prompt-box textarea')) return editor;
      if (selectors.includes('button[aria-label="Run"]')) return root ? null : send;
      return null;
    },
    write(target, text) { target.value = text; },
    async waitFor(read) {
      if (paused) await new Promise(resolve => setTimeout(resolve, 5));
      if (remount) { editor.isConnected = false; editor = makeEditor(); remount = false; }
      const result = read();
      if (!result) throw Error('No matching composer or Run button');
      return result;
    },
  };
  editor = makeEditor();
  const source = fs.readFileSync(path.join(__dirname, 'providers/aistudio.js'), 'utf8');
  const P = vm.runInNewContext(source + '\nZSProvider;', { ZSDom: D, document });
  for (const key of ['WARMUP_MS', 'REASON_NOREPLY_MS', 'STABLE_MS', 'RESPONSE_TIMEOUT_MS']) {
    assert.ok(Number.isFinite(P.timings[key]) && P.timings[key] > 0, key);
  }
  assert.equal((await P.ensureComposerReady()).ready, true);
  await P.typeAndSend('first');
  assert.equal(clicks, 1, 'Run in sibling toolbar is clicked');
  const originalWrite = D.write;
  D.write = (target, text) => { originalWrite(target, text); if (text === 'replacement' && target === editor) { D.write = originalWrite; remount = true; } };
  await P.typeAndSend('replacement');
  assert.equal(editor.value, 'replacement');
  assert.equal(clicks, 2, 'composer replacement submits exactly once');
  paused = true;
  const first = P.typeAndSend('single flight');
  await assert.rejects(P.typeAndSend('duplicate'), /already in progress/);
  await first;
  assert.equal(clicks, 3);
  send.disabled = true;
  await assert.rejects(P.typeAndSend('disabled'), /No matching/);
  assert.equal(clicks, 3, 'disabled Run never clicked');
  send.disabled = false;
  await P.typeAndSend('retry');
  assert.equal(clicks, 4, 'failed send releases lock');
  console.log('PASS AI Studio timing contract, sibling Run, remount, single-flight and failed-send recovery');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
