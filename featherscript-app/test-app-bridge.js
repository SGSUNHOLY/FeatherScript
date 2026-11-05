const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const start = source.indexOf('function waitPort(');
const end = source.indexOf('\nconst bridge = new Bridge();', start);
assert.ok(start > 0 && end > start, 'waitPort must stay extractable from main.js');

const timers = new Map();
let sequence = 0;
let clock = 1000;
const sockets = [];
class FakeSocket {
  constructor() { this.handlers = new Map(); this.destroyed = false; }
  setTimeout() {}
  once(type, listener) { if (!this.handlers.has(type)) this.handlers.set(type, []); this.handlers.get(type).push(listener); }
  on(type, listener) { this.once(type, listener); }
  destroy() { this.destroyed = true; }
  emit(type) { const list = this.handlers.get(type) || []; this.handlers.set(type, []); for (const listener of list) listener(); }
}
const context = vm.createContext({
  net: { connect: () => { const socket = new FakeSocket(); sockets.push(socket); return socket; } },
  Date: { now: () => clock },
  setTimeout: (callback) => { const id = ++sequence; timers.set(id, callback); return id; },
  clearTimeout: (id) => timers.delete(id),
  AbortController,
});
vm.runInContext(source.slice(start, end) + ';globalThis.waitPort = waitPort;', context);
const runTimers = () => { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } };
const probe = () => sockets.at(-1);

(async () => {
  // A failed probe schedules exactly one follow-up; connecting resolves once.
  let pending = context.waitPort(17613, 5000);
  assert.equal(sockets.length, 1);
  probe().emit('error');
  probe().emit('timeout');
  assert.equal(timers.size, 1, 'error and timeout must not both schedule a retry');
  runTimers();
  assert.equal(sockets.length, 2);
  probe().emit('connect');
  assert.equal(await pending, true);
  probe().emit('close');
  assert.equal(timers.size, 0, 'a settled probe must not schedule more work');

  // Aborting (bridge process exited) resolves immediately and stops probing.
  const controller = new AbortController();
  pending = context.waitPort(17613, 5000, controller.signal);
  probe().emit('error');
  controller.abort();
  assert.equal(await pending, false);
  assert.equal(timers.size, 0, 'abort must clear the queued retry');

  // An already-aborted signal never opens a socket.
  const dead = new AbortController();
  dead.abort();
  const before = sockets.length;
  assert.equal(await context.waitPort(17613, 5000, dead.signal), false);
  assert.equal(sockets.length, before);

  // The deadline still resolves false on its own.
  clock = 1000;
  pending = context.waitPort(17613, 1000);
  probe().emit('error');
  clock = 4000;
  runTimers();
  probe().emit('error');
  assert.equal(await pending, false);

  console.log('PASS port wait resolves once, aborts on a dead bridge and never doubles its probes');
})().catch((error) => { console.error(error); process.exitCode = 1; });
