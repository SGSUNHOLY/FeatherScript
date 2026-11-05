const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.FS_POLISH_ROOT || __dirname;
const source = fs.readFileSync(path.join(root, 'providers/qwen.js'), 'utf8');
let observer, scans = 0;
const block = (text) => ({
  nodeType: 1, dataset: {}, reads: 0, text,
  closest() { return this; },
  querySelectorAll(selector) { this.reads++; return selector === '.view-line' ? this.text.split('\n').map(textContent => ({ textContent })) : []; },
});
const history = Array.from({ length: 100 }, (_, i) => block(`old ${i}`));
const context = vm.createContext({ S: { codeWrap: 'pre.qwen-markdown-code' },
  document: { body: {}, querySelectorAll() { scans++; return history; } },
  MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
});
vm.runInContext(source.slice(source.indexOf('  const codeLinesText'), source.indexOf('  // ── Network tap')) + ';ensureCodeObserver();', context);
assert.equal(scans, 1);
const live = history.at(-1);
live.text = 'new\ncomplete\ncode';
observer([{ target: { nodeType: 3, parentElement: live }, addedNodes: [], removedNodes: [] }]);
assert.equal(live.dataset.zsCode, live.text);
assert.ok(history.slice(0, -1).every(node => node.reads === 1), 'stream mutation must not reread historical blocks');
live.text = 'new';
observer([{ target: live }]);
assert.equal(live.dataset.zsCode, 'new\ncomplete\ncode', 'Monaco disposal must retain full code');
const added = block('added code');
observer([{ target: { nodeType: 1, closest: () => null }, addedNodes: [added] }]);
assert.equal(added.dataset.zsCode, 'added code');
observer([{ target: { nodeType: 1, closest: () => null }, addedNodes: [] }]);
assert.equal(scans, 1, 'unrelated page mutations must not scan transcript');
console.log('PASS Qwen targeted cache, retained code after disposal, new blocks and no history rescans');
