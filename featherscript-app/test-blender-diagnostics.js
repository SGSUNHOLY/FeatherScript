const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.join(__dirname, 'blender-diagnostics.js'), 'utf8');
let child, spawnOptions, killer;
const timers = new Set();
const sandbox = { module: { exports: {} }, process: { platform: 'linux', env: {} },
  setTimeout: callback => { timers.add(callback); return callback; }, clearTimeout: callback => timers.delete(callback),
  require: name => name === 'node:path' ? path : { spawn(command, args, options) {
    if(command==='taskkill'){killer=new EventEmitter();return killer;}
    spawnOptions = options;
    child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    child.stdout.setEncoding = child.stderr.setEncoding = () => {};
    child.pid = 123; child.killCalls = 0;
    child.exitCode = null; child.kill = () => { child.killCalls++; child.exitCode = -1; child.emit('close', -1); };
    return child;
  } },
};
vm.runInNewContext(source, sandbox);
const { diagnose } = sandbox.module.exports;
const options = { root: __dirname, python: { cmd: 'python', args: [] } };
const finish = (result, code = 0) => { child.stdout.emit('data', JSON.stringify(result)); child.exitCode = code; child.emit('close', code); };
(async () => {
  await assert.rejects(diagnose({ ...options, executable: '\0' }), /valid Blender/);
  let result = diagnose(options);
  assert.equal(spawnOptions.windowsHide, true);
  finish({ ok: true, version: '5.2', executable: 'blender', objects: 3, headless: true, rendered: true, previewBytes: 300 });
  assert.equal((await result).previewBytes, 300);
  assert.equal(timers.size, 0);
  result = diagnose(options); finish({ ok: true, headless: true });
  await assert.rejects(result, /did not verify/);
  result = diagnose(options); finish(null);
  await assert.rejects(result, /invalid diagnostic response/);
  result = diagnose(options); finish({ ok: false, error: 'Cycles is unavailable' }, 1);
  await assert.rejects(result, /Cycles is unavailable/);
  const controller = new AbortController();
  result = diagnose({ ...options, signal: controller.signal }); controller.abort();
  await assert.rejects(result, /cancelled/);
  result = diagnose(options);
  for (const callback of [...timers]) callback();
  await assert.rejects(result, /startup\/render check timed out/);
  sandbox.process.platform = 'win32';
  const windowsController = new AbortController();
  result = diagnose({ ...options, signal: windowsController.signal });
  const originalChild = child;
  windowsController.abort();
  assert.ok(killer, 'Windows cancellation starts an owned-process tree kill');
  killer.emit('close', 1);
  assert.equal(originalChild.killCalls, 1, 'nonzero taskkill exit falls back to terminating the owned parent');
  await assert.rejects(result, /cancelled/);
  assert.equal(timers.size, 0);
  console.log('PASS Blender diagnostic validates headless PNG/scene response, invalid output, cancellation, Windows kill failure and timeout cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
