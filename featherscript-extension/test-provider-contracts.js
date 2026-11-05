const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.FS_PROVIDER_TEST_ROOT || __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const providers = [...new Set(manifest.content_scripts.flatMap(entry => entry.js || []))]
  .filter(file => /^providers\//.test(file) && !/-net\.js$|-cm\.js$/.test(file));
const required = ['allItems', 'isUserItem', 'isAssistantItem', 'itemText', 'classifyText',
  'assistantCount', 'userCount', 'lastAssistant', 'readAssistant', 'getEditor', 'editorText',
  'composerFrame', 'chatIsEmpty', 'isFreshChat', 'conversationKey', 'setInputLock',
  'typeAndSend', 'stopGeneration', 'isGenerating', 'isBusyNow', 'isHardGenerating',
  'enforceComposer', 'ensureComposerReady', 'turnHalted', 'findContinueBtn',
  'clickContinueBtn', 'scanError', 'isTooLongMsg', 'isBusyMsg', 'installSendHooks', 'streamLen', 'snapshot'];
for (const file of providers) {
  const empty = { querySelector: () => null, querySelectorAll: () => [], children: [],
    childNodes: [], addEventListener() {}, contains: () => false };
  const document = { ...empty, documentElement: { ...empty, classList: { contains: () => false } },
    body: empty, visibilityState: 'visible' };
  const location = { pathname: '/', hash: '', search: '', hostname: 'example.com', href: 'https://example.com/' };
  class Textarea { get value() { return ''; } set value(value) {} }
  const window = { ...empty, location, HTMLTextAreaElement: Textarea };
  const context = { document, window, location, console, URL, URLSearchParams, Date,
    setTimeout, clearTimeout, MutationObserver: class { observe() {} disconnect() {} },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 }, getComputedStyle: () => ({}),
    ZSDom: { first: () => null, visible: () => false } };
  const provider = vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8') + ';ZSProvider;', context);
  for (const key of required) assert.equal(typeof provider[key], 'function', `${file}: ${key}`);
  for (const key of ['RESPONSE_TIMEOUT_MS', 'STABLE_MS', 'WARMUP_MS', 'REASON_NOREPLY_MS']) {
    assert.ok(Number.isFinite(provider.timings?.[key]) && provider.timings[key] > 0, `${file}: ${key}`);
  }
  assert.equal(provider.allItems().length, 0, file);
  assert.equal(provider.assistantCount(), 0, file);
  assert.equal(provider.userCount(), 0, file);
  const read = provider.readAssistant();
  assert.equal(read.item, null, file);
  assert.equal(read.present, false, file);
  assert.equal(read.reply, '', file);
  assert.equal(read.thinking, '', file);
  assert.equal(provider.getEditor(), null, file);
  assert.equal(provider.editorText(), '', file);
  assert.equal(provider.isGenerating(), false, file);
  assert.equal(provider.isBusyNow(), false, file);
  assert.equal(provider.isHardGenerating(), false, file);
  provider.snapshot();
  console.log(`PASS ${provider.id} required interface, timings and unmounted DOM reads`);
}
assert.equal(providers.length, 13);
const config = vm.runInNewContext(fs.readFileSync(path.join(root, 'core/config.js'), 'utf8') + ';ZS;', {});
for (const value of [undefined, null, {}, { RESPONSE_TIMEOUT_MS: NaN, STABLE_MS: -1, WARMUP_MS: Infinity, REASON_NOREPLY_MS: 0 }]) {
  for (const timing of Object.values(config.normalizeTimings(value))) assert.ok(Number.isFinite(timing) && timing > 0);
}
assert.equal(config.normalizeTimings({ STABLE_MS: 15000 }).STABLE_MS, 15000);
console.log('PASS missing/invalid timing fallback and valid provider overrides');
