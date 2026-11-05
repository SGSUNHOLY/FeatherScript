// Catalogue cache used by Start: hydration from storage, single-flight fetch
// and stale-while-revalidate. Start must never wait on a bridge round trip
// when a usable catalogue is already on disk.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'core/main.js'), 'utf8');
const from = source.indexOf('  // How long a fetched catalogue');
const to = source.indexOf('  setTimeout(prewarmTools, 200);');
assert.ok(from > 0 && to > from, 'catalogue cache block not found');
const block = source.slice(from, to + '  setTimeout(prewarmTools, 200);'.length);

function harness(saved, gateway) {
  const state = { toolList: [], toolNames: new Set(), toolsAt: 0, skills: [] };
  const writes = [];
  let reads = 0;
  const context = vm.createContext({
    A: state, Date, JSON, Object, Array, Set, Number, String, Promise, Error,
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id),
    isBlockedTool: name => name === 'blocked_tool',
    diag: () => {},
    bg: (message, timeout) => { gateway.calls.push({ message, timeout }); return gateway.respond(message, timeout); },
    chrome: { storage: { local: {
      get(key, callback) { reads++; setTimeout(() => callback({ [key]: saved }), 5); },
      set(value) { writes.push(value); },
    } } },
  });
  vm.runInContext(block + ';globalThis.ensureTools = ensureTools; globalThis.prewarmTools = prewarmTools;', context);
  return { state, writes, reads: () => reads, ensureTools: context.ensureTools, prewarmTools: context.prewarmTools };
}

const tool = name => ({ name, description: 'fixture', inputSchema: { type: 'object', properties: {} } });

(async () => {
  // 1. A fresh saved catalogue hydrates and serves Start without any network.
  const call = { calls: [], respond: async () => { throw Error('network should not be needed'); } };
  const fresh = harness({ tools: [tool('a'), tool('blocked_tool')], skills: [{ name: 's' }], at: Date.now() }, call);
  const tools = await fresh.ensureTools(false);
  assert.deepEqual(tools.map(t => t.name), ['a'], 'blocked tools are filtered on hydrate');
  assert.equal(call.calls.length, 0, 'Start must not fetch when storage already has a catalogue');
  assert.equal(fresh.reads(), 1);

  // 2. A stale catalogue is returned immediately and refreshed behind it.
  let release;
  const staleGateway = {
    calls: [],
    respond: () => new Promise(resolve => { release = () => resolve({ ok: true, tools: [tool('new')] }); }),
  };
  const stale = harness({ tools: [tool('old')], skills: [], at: Date.now() - 60000 }, staleGateway);
  const started = await stale.ensureTools(false);
  assert.deepEqual(started.map(t => t.name), ['old'], 'stale catalogue answers Start at once');
  assert.equal(staleGateway.calls.length, 1, 'a refresh is started in the background');
  assert.equal(staleGateway.calls[0].message.type, 'list_tools');
  // The in-flight fetch is shared, not duplicated, by the next caller.
  const same = await stale.ensureTools(false);
  assert.deepEqual(same.map(t => t.name), ['old']);
  release();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(stale.state.toolList.map(t => t.name), ['new'], 'background refresh updates the catalogue');
  assert.ok(stale.writes.length >= 1, 'the fetched catalogue is persisted');

  // 3. No cache at all: concurrent callers share ONE bridge request.
  const emptyGateway = { calls: [], respond: async () => ({ ok: true, tools: [tool('x')], skills: [] }) };
  const empty = harness(undefined, emptyGateway);
  const [first, second] = await Promise.all([empty.ensureTools(false), empty.ensureTools(false)]);
  assert.deepEqual(first.map(t => t.name), ['x']);
  assert.equal(second, first);
  assert.equal(emptyGateway.calls.length, 1, 'single-flight fetch');

  // 4. A failed refresh keeps the stale catalogue usable.
  const failingGateway = { calls: [], respond: async () => { throw Error('offline'); } };
  const failing = harness({ tools: [tool('kept')], skills: [], at: Date.now() - 60000 }, failingGateway);
  assert.deepEqual((await failing.ensureTools(false)).map(t => t.name), ['kept']);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(failing.state.toolList.map(t => t.name), ['kept'], 'failed refresh never clears the cache');

  console.log('PASS Start catalogue: storage hydration, stale-while-revalidate and single-flight refresh');
})().catch(error => { console.error(error); process.exitCode = 1; });
