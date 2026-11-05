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

(async()=>{
 const {run,listeners}=loadWorker();let live=FakeWebSocket.instances.at(-1);live.open();
 live.receive({type:'connected',bridge_id:'bridge-a',tools:[],servers:[]});
 const call=msg=>new Promise(resolve=>listeners.message[0](msg,{tab:{id:7}},resolve));
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 let settled=false;
 const first=call({type:'call_tool',name:'write',arguments:{a:1,b:2},command_id:'cmd-a',timeout:3000}).then(value=>{settled=true;return value;});await tick();
 const wireA=live.sent.find(item=>item.command_id==='cmd-a');assert.ok(wireA);
 const joined=call({type:'call_tool',name:'write',arguments:{b:2,a:1},command_id:'cmd-a',timeout:3000});
 live.receive({type:'call_ack',id:wireA.id,command_id:'cmd-a',state:'acknowledged'});await tick();assert.equal(settled,false,'ACK must not resolve a command');
 live.receive({type:'tool_result',id:wireA.id,command_id:'wrong',ok:true,text:'wrong'});await tick();assert.equal(settled,false,'wrong command correlation must be ignored');
 const second=call({type:'call_tool',name:'read',arguments:{},command_id:'cmd-b',timeout:3000});await tick();
 const wireB=live.sent.find(item=>item.command_id==='cmd-b');live.receive({type:'call_ack',id:wireB.id,command_id:'cmd-b'});live.receive({type:'tool_result',id:wireB.id,command_id:'cmd-b',ok:true,text:'B'});assert.equal((await second).text,'B');
 live.receive({type:'tool_result',id:wireA.id,command_id:'cmd-a',ok:true,text:'A'});assert.equal((await first).text,'A');assert.equal((await joined).text,'A');
 assert.equal(live.sent.filter(item=>item.command_id==='cmd-a').length,1);
 assert.equal((await call({type:'call_tool',name:'write',arguments:{a:1,b:2},command_id:'cmd-a'})).text,'A');
 assert.equal((await call({type:'call_tool',name:'write',arguments:{a:99},command_id:'cmd-a'})).kind,'rejected');
 const resumed=call({type:'call_tool',name:'write',arguments:{},command_id:'cmd-c',timeout:3000});await tick();
 const wireC=live.sent.find(item=>item.command_id==='cmd-c');live.receive({type:'call_ack',id:wireC.id,command_id:'cmd-c'});live.close();
 assert.equal(run('pending.size'),1);run('connect()');live=FakeWebSocket.instances.at(-1);live.open();live.receive({type:'connected',bridge_id:'bridge-a'});
 const resent=live.sent.find(item=>item.command_id==='cmd-c');assert.equal(resent.id,wireC.id);assert.equal(resent.bridge_id,'bridge-a');
 live.receive({type:'tool_result',id:resent.id,command_id:'cmd-c',ok:true,text:'once'});assert.equal((await resumed).text,'once');
 const uncertain=call({type:'call_tool',name:'write',arguments:{},command_id:'cmd-d',timeout:3000});await tick();
 const wireD=live.sent.find(item=>item.command_id==='cmd-d');live.receive({type:'call_ack',id:wireD.id,command_id:'cmd-d'});live.close();run('connect()');live=FakeWebSocket.instances.at(-1);live.open();live.receive({type:'connected',bridge_id:'different-bridge'});
 assert.equal((await uncertain).kind,'indeterminate');assert.equal(live.sent.some(item=>item.command_id==='cmd-d'),false);
 const ackless=call({type:'call_tool',name:'write',arguments:{},command_id:'cmd-e',timeout:120000});await tick();
 run("[...pending.values()].find(item=>item.command_id==='cmd-e').ackTimer._onTimeout()");assert.equal((await ackless).kind,'unacknowledged');
 const cancel=call({type:'cancel_command',command_id:'cmd-e'});await tick();const cancelWire=live.sent.at(-1);assert.equal(cancelWire.type,'cancel_command');live.receive({type:'command_status',id:cancelWire.id,command_id:'cmd-e',state:'cancelled'});assert.equal((await cancel).state,'cancelled');
 const health=run('statusObj().health');assert.equal(health.bridgeId,'different-bridge');assert.ok(health.ackLatencyMs>=0);
 run('stopHeartbeat();clearTimeout(reconnectTimer);clearTimeout(connectTimer);');
 console.log('PASS ACK is not success, command correlation, duplicate joining/replay, changed-argument rejection, same-ID resume, bridge identity changes, missing ACK, cancel and health');process.exit(0);
})().catch(error=>{console.error(error);process.exit(1);});
