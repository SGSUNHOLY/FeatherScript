const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.FS_POLISH_ROOT || __dirname;
function fixture() {
  let observer;
  const events = new Map(), microtasks = [];
  const document = { documentElement: {},
    addEventListener(name, handler) { events.set(name, handler); },
    removeEventListener(name, handler) { if (events.get(name) === handler) events.delete(name); },
  };
  const context = { document, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask: fn => microtasks.push(fn),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe(node, options) { this.options = options; }
      disconnect() { this.disconnected = true; }
    },
  };
  const dom = vm.runInNewContext(fs.readFileSync(path.join(root, 'core/dom-runtime.js'), 'utf8') + ';ZSDom;', context);
  return { dom, events, microtasks, observer: () => observer };
}
(async () => {
  const f = fixture();
  let ready = false, reads = 0;
  const pending = f.dom.waitFor(() => { reads++; return ready && 'ready'; }, 100);
  f.observer().callback(); // queued callback must not run after input resolves the wait
  ready = true;
  f.events.get('input')();
  assert.equal(await pending, 'ready');
  const settledReads = reads;
  f.microtasks.forEach(fn => fn());
  assert.equal(reads, settledReads);
  assert.equal(f.events.size, 0);
  assert.equal(f.observer().disconnected, true);
  assert.ok(f.observer().options.attributeFilter.includes('aria-label'));
  const timeout = fixture();
  await assert.rejects(timeout.dom.waitFor(() => null, 5), /Timed out/);
  assert.equal(timeout.events.size, 0);
  assert.equal(timeout.observer().disconnected, true);
  const polled = fixture();
  let property = '', polls = 0;
  const propertyChange = polled.dom.waitFor(() => { polls++; return property || null; }, 350);
  setTimeout(() => { property = 'cleared'; }, 20); // no event, mutation or attribute update
  assert.equal(await propertyChange, 'cleared', 'programmatic value changes must wake a waiting send');
  const settledPolls = polls;
  await new Promise(resolve => setTimeout(resolve, 130));
  assert.equal(polls, settledPolls, 'polling must stop once the send is acknowledged');
  const failed = fixture();
  await assert.rejects(failed.dom.waitFor(() => { throw Error('read failed'); }), /read failed/);
  assert.equal(failed.events.size, 0);
  console.log('PASS composer input/poll wakeup, post-settlement suppression and success/error/timeout cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
