const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('./appearance');
const malicious = model.normalize({ enabled: true, accent: 'red;url(https://example.com)',
  canvas: '#000', photo: 'data:image/svg+xml;base64,PHN2Zy8+', angle: -1000, overlay: 200,
  name: 'x'.repeat(1000) });
assert.equal(malicious.accent, model.defaults.accent);
assert.equal(malicious.canvas, model.defaults.canvas);
assert.equal(malicious.photo, '');
assert.equal(malicious.angle, 0);
assert.equal(malicious.overlay, 95);
assert.equal(malicious.name.length, 40);
for (const input of [null, false, 42, [], { photo: 'https://example.com/image.jpg' }, { photo: 'data:image/png;base64,AAAA' }]) assert.equal(model.normalize(input).photo, '');
const jpeg = 'data:image/jpeg;base64,' + Buffer.from([255, 216, 255, 0]).toString('base64');
assert.equal(model.photo(jpeg), jpeg);
assert.equal(model.photo('data:image/jpeg;base64,' + 'A'.repeat(2200001)), '');
assert.equal(model.contrast('#000000', '#ffffff'), 21);
for (const accent of ['#ffffff', '#000000', '#b9f36b', '#7634b9', '#d95442']) {
  const tokens = model.tokens({ accent });
  assert.ok(model.contrast(accent, tokens['--btn-ink']) >= 4.5);
}
const context = vm.createContext({ atob });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'appearance.js'), 'utf8'), context);
assert.equal(context.FSAppearance.normalize({ accent: '#AABBCC' }).accent, '#aabbcc');

// Exercise the real settings IPC handler across a profile switch during a save.
const main = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const start = main.indexOf('ipcMain.handle("data:save"');
const end = main.indexOf('// ── skills library', start);
let handler, writes = 0;
const store = { profiles: [{ id: 'first' }, { id: 'second' }], data: {
  first: { settings: { theme: 'default' } }, second: { settings: { theme: 'dark' } },
} };
vm.runInNewContext(main.slice(start, end), {
  ipcMain: { handle: (name, callback) => { handler = callback; } },
  readStore: () => store, currentProfile: () => store.profiles[1],
  emptyData: () => ({}), writeStore: () => writes++, sanitizeNotes: value => value,
  sanitizeFeel: value => value, themeIds: new Set(['default', 'dark']), appearance: model,
});
const result = handler(null, { profileId: 'first', section: 'settings', value: {
  theme: 'default', customPrompt: 'keep this', appearance: { enabled: true, accent: '#112233', photo: jpeg },
} });
assert.equal(result.ok, true);
assert.equal(store.data.first.settings.appearance.photo, jpeg);
assert.equal(store.data.first.settings.customPrompt, 'keep this');
assert.equal(store.data.second.settings.theme, 'dark');
assert.equal(handler(null, { profileId: 'unknown', section: 'settings', value: {} }).ok, false);
assert.equal(writes, 1);
console.log('PASS appearance validation, local raster bounds, button contrast, browser parity and profile-isolated persistence');
