// Regression tests for the service worker's socket lifecycle. Runs background.js
// inside a vm with a stubbed chrome.* API and a scriptable WebSocket, so the
// reconnect/wait/response contract can be exercised without a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    FakeWebSocket.instances.push(this);
  }
  send(data) {
    if (this.readyState !== FakeWebSocket.OPEN) throw new Error('socket is not open');
    this.sent.push(JSON.parse(data));
  }
  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose && this.onclose();
  }
  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen && this.onopen();
  }
  receive(obj) {
    this.onmessage && this.onmessage({ data: JSON.stringify(obj) });
  }
}

function loadWorker() {
  const listeners = { message: [], startup: [], installed: [], alarm: [] };
  const alarms = { created: [], cleared: [] };
  const chrome = {
    runtime: {
      getURL: (p) => `chrome-extension://test/${p}`,
      lastError: undefined,
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      onStartup: { addListener: (fn) => listeners.startup.push(fn) },
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
      sendMessage: () => Promise.resolve(),
    },
    tabs: {
      query: (_q, cb) => cb([]),
      sendMessage: () => Promise.resolve(),
      create: () => Promise.resolve(),
    },
    storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
    alarms: {
      create: (name, info) => alarms.created.push({ name, info }),
      clear: (name) => { alarms.cleared.push(name); return Promise.resolve(true); },
      onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
    },
  };
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    WebSocket: FakeWebSocket,
    chrome,
    importScripts: (p) => vm.runInContext(fs.readFileSync(path.join(__dirname, p), 'utf8'), context),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8'), context, { filename: 'background.js' });
  const run = (code) => vm.runInContext(code, context);
  return { context, run, listeners, alarms };
}

(async () => {
  const { run, listeners, alarms } = loadWorker();

  // 1. Exactly one socket on boot, and connect() is idempotent while connecting.
  assert.equal(FakeWebSocket.instances.length, 1);
  run('connect()');
  assert.equal(FakeWebSocket.instances.length, 1, 'connect must not stack sockets');
  assert.equal(run('connected'), false);

  // 2. waitForConnection resolves from onopen instead of polling to the deadline.
  const waiting = run('waitForConnection(3000)');
  const t0 = Date.now();
  FakeWebSocket.instances[0].open();
  assert.equal(await waiting, true);
  assert.ok(Date.now() - t0 < 500, 'the wait must be event-driven');
  assert.equal(run('connected'), true);
  assert.ok(alarms.cleared.includes('zs-reconnect'), 'connecting clears the backstop alarm');

  // 3. A superseded socket's late close must not tear down the live connection.
  run('globalThis.__old = ws; ws = null; connect()');
  assert.equal(FakeWebSocket.instances.length, 2);
  const live = FakeWebSocket.instances[1];
  live.open();
  assert.equal(run('connected'), true);
  run('globalThis.__old.close()');
  assert.equal(run('connected'), true, 'stale onclose must be ignored');
  assert.equal(run('ws') === live, true, 'the live socket stays installed');

  // 4. Responses are correlated by id; unanswered requests time out cleanly.
  const pong = run('send({ type: "ping" }, 1000)');
  const ping = live.sent[live.sent.length - 1];
  assert.equal(ping.type, 'ping');
  live.receive({ type: 'pong', id: ping.id });
  const resolved = await pong;
  assert.equal(resolved.ok, true);
  assert.equal(run('pending.size'), 0, 'answered requests are removed from the table');

  const timedOut = await run('send({ type: "ping" }, 20)');
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.kind, 'timeout');
  assert.equal(run('pending.size'), 0);

  // 5. Dropping the bridge fails every in-flight request instead of leaving the
  //    agentic loop parked forever.
  const inflight = run('send({ type: "call_tool", name: "x" }, 5000)');
  live.close();
  const dropped = await inflight;
  assert.equal(dropped.ok, false);
  assert.equal(dropped.kind, 'disconnected');
  assert.equal(run('connected'), false);
  assert.ok(alarms.created.some((a) => a.name === 'zs-reconnect'), 'a dropped socket arms the reconnect alarm');

  // 6. Every message gets exactly one response, including unknown ones.
  const listener = listeners.message[0];
  assert.equal(typeof listener, 'function');
  const respond = (msg) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no response for ${JSON.stringify(msg)}`)), 2000);
    const async = listener(msg, {}, (value) => { clearTimeout(timer); resolve(value); });
    assert.equal(async, true, 'the listener must keep the channel open for async replies');
  });
  const status = await respond({ type: 'status' });
  assert.equal(status.type, 'zs-status');
  assert.equal(status.connected, false);
  const unknown = await respond({ type: 'nope' });
  assert.equal(unknown.ok, false);

  // 6b. A tool call issued while the bridge is reconnecting waits for the
  //     socket instead of failing, then routes the reply back to its caller.
  const pendingCall = respond({ type: 'call_tool', name: 'x', timeout: 5000 });
  await new Promise((r) => setTimeout(r, 20));
  const reconnected = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  reconnected.open();
  await new Promise((r) => setTimeout(r, 20));
  const call = reconnected.sent.find((m) => m.type === 'call_tool');
  assert.ok(call, 'the queued tool call is sent once the socket opens');
  reconnected.receive({ type: 'tool_result', id: call.id, ok: true, text: 'ran' });
  const callResult = await pendingCall;
  assert.equal(callResult.ok, true);
  assert.equal(callResult.text, 'ran');

  // 7. A throwing handler still answers (a hang here froze the agent loop).
  run('send = async () => { throw new Error("boom"); }');
  const failed = await respond({ type: 'list_tools' });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /boom/);

  // Leave no timers behind: the worker keeps a heartbeat and reconnect timer.
  run('stopHeartbeat(); clearTimeout(reconnectTimer); clearTimeout(connectTimer);');
  console.log('PASS worker keeps one socket, ignores stale sockets, times out, and always answers');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
