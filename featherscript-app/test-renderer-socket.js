const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const timers = new Map();
let sequence = 0;
const schedule = (callback) => { const id = ++sequence; timers.set(id, callback); return id; };
const sockets = [];
class FakeSocket {
  constructor() { this.readyState = 0; this.listeners = new Map(); this.sent = []; sockets.push(this); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  emit(type, event = {}) { this.listeners.get(type)?.(event); }
  open() { this.readyState = 1; this.emit('open'); }
  send(message) { this.sent.push(JSON.parse(message)); }
  close() { this.readyState = 3; this.emit('close'); }
}
const context = vm.createContext({
  WebSocket: FakeSocket, setTimeout: schedule, setInterval: schedule,
  clearTimeout: (id) => timers.delete(id), clearInterval: (id) => timers.delete(id),
});
vm.runInContext(fs.readFileSync(path.join(__dirname, 'renderer/modules/bridge-socket.js'), 'utf8'), context);

(async () => {
  const states = [];
  let messages = 0;
  const client = new context.FSRenderer.BridgeSocket(() => messages++, (open) => states.push(open));
  client.start(); client.start(); client.connect();
  assert.equal(sockets.length, 1, 'start/connect must not duplicate an active socket');
  sockets[0].open();
  const request = client.request('get_vault');
  const sent = sockets[0].sent.at(-1);
  sockets[0].emit('message', { data: JSON.stringify({ id: sent.id, ok: true }) });
  assert.equal((await request).ok, true);

  // A queued event from an old transport cannot disturb the current connection.
  sockets[0].readyState = 3;
  client.connect(); sockets[1].open();
  const activeTimers = timers.size;
  sockets[0].emit('message', { data: JSON.stringify({ type: 'stale' }) });
  sockets[0].emit('close');
  assert.equal(messages, 1);
  assert.equal(timers.size, activeTimers);
  assert.equal(states.at(-1), true);

  const pending = client.request('configure_vault');
  sockets[1].close();
  assert.equal((await pending).ok, false);
  client.stop();
  assert.equal(timers.size, 0, 'shutdown must release timers');
  assert.equal(client.pending.size, 0);
  assert.equal((await client.request('get_vault')).ok, false);
  console.log('PASS socket single-start, request correlation, stale-event guards, disconnection and timer cleanup');
})().catch((error) => { console.error(error); process.exitCode = 1; });
