const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.FS_PROVIDER_TEST_ROOT || __dirname;
const source = fs.readFileSync(path.join(root, 'core/main.js'), 'utf8');
const start = source.indexOf('  let injectionGeneration = 0;');
const end = source.indexOf('  // ═', start);
assert.ok(start > 0 && end > start);
function harness({ detached = false, accepted = false, landed = false, receipt = false, uncertain = false, busy = false, busyClears = false, blocked = false } = {}) {
  let sends = 0;
  const timers = [];
  const state = { injecting: false, stop: false, busy };
  const context = vm.createContext({providerStatus:{scan:()=>null,assertCanSend(){if(blocked){const e=Error("Your limit resets at 5:21 PM");e.zsNoRetry=true;throw e;}}}, A: state, Date, String, Error, workflow:null, performance, performance,
    P: {
      displayName: 'Fixture', isBusyNow: () => state.busy,
      isGenerating: () => state.busy, isHardGenerating: () => state.busy,
      lastAssistant: () => null,
      assistantCount: () => landed && sends ? 1 : 0, userCount: () => 0,
      getEditor: () => detached ? null : {}, editorText: () => accepted || detached ? '' : 'pending',
      typeAndSend: async () => { sends++; return receipt ? { sent: true } : uncertain ? {sent:false,attempted:true} : undefined; },
    },
    ui: { inputCover() {} }, diag() {}, captureSendToken() {}, scheduleSweep() {},
    sleep: async () => {}, paceBeforeDeepseekSend: async () => {},
    waitFor: async read => {
      if (state.busy && busyClears) state.busy = false;   // the site finished writing
      return !!read();
    },
    setTimeout: (callback) => { timers.push(callback); },
  });
  vm.runInContext(source.slice(start, end) + ';globalThis.submit = submitAndGetBase;', context);
  return { state, timers, submit: context.submit, sends: () => sends };
}
(async () => {
  const limited=harness({blocked:true});await assert.rejects(limited.submit('test'),/limit resets/);assert.equal(limited.sends(),0,'quota wall must prevent typing/clicking the send button');
  for (const options of [{}, { detached: true }]) {
    const h = harness(options);
    await assert.rejects(h.submit('test'), /did not accept.*4 attempts/);
    assert.equal(h.sends(), 4);
  }
  for (const options of [{ accepted: true }, { landed: true }, { receipt: true }]) {
    const h = harness(options);
    await h.submit('test');
    assert.equal(h.sends(), 1, 'accepted send must not be duplicated');
  }
  const unknown=harness({uncertain:true});
  await assert.rejects(unknown.submit('test'),/may already be in the chat/);
  assert.equal(unknown.sends(),1,'an unconfirmed click must never be repeated');
  for(const options of [{uncertain:true,accepted:true},{uncertain:true,landed:true}]){
    const h=harness(options);await h.submit('test');
    assert.equal(h.sends(),1,'post-click DOM acknowledgement resolves uncertainty');
  }
  const h = harness({ accepted: true });
  await h.submit('first');
  const oldRelease = h.timers[0];
  await h.submit('second');
  oldRelease();
  assert.equal(h.state.injecting, true, 'old cleanup must not unlock the newer send');
  h.timers[3]();
  assert.equal(h.state.injecting, false);
  // A site still showing its Stop control must never be sent into: the gate
  // waits for idle first (the live "Arena send is unavailable" loop), then sends.
  const waited = harness({ accepted: true, busy: true, busyClears: true });
  await waited.submit('test');
  assert.equal(waited.sends(), 1, 'send waits for the stream to end, then goes through');
  const stalled = harness({ accepted: true, busy: true });
  await assert.rejects(stalled.submit('test'), /still writing its previous reply/);
  assert.equal(stalled.sends(), 0, 'no send is attempted while the site is generating');
  console.log('PASS rejected sends fail promptly, remount is not acceptance, accepted sends do not repeat, stale cleanup stays locked, injection waits out a live stream');
})().catch(error => { console.error(error); process.exitCode = 1; });
