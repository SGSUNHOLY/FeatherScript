const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const appDir = path.resolve(__dirname, '..');
const root = path.resolve(appDir, '..');
const extension = path.join(root, 'featherscript-extension');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const metadata = json(path.join(appDir, 'package.json'));
const lock = json(path.join(appDir, 'package-lock.json'));
const manifest = json(path.join(extension, 'manifest.json'));
assert.equal(metadata.version, '2.0.1');
assert.equal(lock.version, metadata.version);
assert.equal(lock.packages[''].version, metadata.version);
assert.equal(manifest.version, metadata.version);
assert.ok(fs.readFileSync(path.join(root, 'bridge.py'), 'utf8').includes(`BRIDGE_VERSION = "${metadata.version}"`));
assert.ok(fs.readFileSync(path.join(appDir, 'renderer/index.html'), 'utf8').includes(`data-version="${metadata.version}"`));

for (const entry of manifest.content_scripts) {
  for (const asset of [...(entry.js || []), ...(entry.css || [])]) {
    assert.ok(fs.existsSync(path.join(extension, asset)), `Missing content-script asset: ${asset}`);
  }
}
assert.ok(fs.existsSync(path.join(extension, manifest.background.service_worker)));
assert.ok(fs.existsSync(path.join(extension, manifest.action.default_popup)));
for(const file of ['core/projects.js','core/projects-ui.js','projects.css']) assert.ok(fs.existsSync(path.join(extension,file)), 'Missing project asset: '+file);
for(const entry of manifest.content_scripts) if(entry.js.includes('core/main.js')) assert.ok(entry.js.includes('core/projects-ui.js'), 'Project choice must be available for every provider');
assert.ok(manifest.permissions.includes('offscreen'), 'Shared music needs offscreen permission');
for (const file of ['audio.html','audio.js','audio.css','core/audio-broker.js','core/audio-ui.js','assets/ambient.wav']) assert.ok(fs.existsSync(path.join(extension,file)), 'Missing extension audio asset: '+file);
for (const entry of manifest.content_scripts) if(entry.js.includes('core/main.js')) assert.ok(entry.js.includes('core/audio-ui.js') && entry.css.includes('audio.css'), 'Chat toolbar music must be wired for every provider');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(appDir, 'renderer/providers.js'), 'utf8'), context);
const providers = context.FSAIProviders;
assert.equal(providers.filter((provider) => !provider.external).length, 13, 'All supported providers must remain available');
assert.equal(providers.filter((provider) => provider.external).length, 1);
assert.equal(new Set(providers.map((provider) => provider.id)).size, providers.length);
const injectedHosts = new Set(manifest.content_scripts.filter((entry) => entry.js.includes('core/main.js')).flatMap((entry) => entry.matches.map((url) => new URL(url).host)));
for (const provider of providers) {
  const url = new URL(provider.url);
  assert.equal(url.protocol, 'https:');
  if (provider.external) continue;
  assert.ok(injectedHosts.has(url.host), `Launcher has no injector: ${provider.id}`);
}
for (const file of ['blender_embed.py', 'featherscript-app/blender-editor.js', 'featherscript-app/renderer/modules/blender-editor.js']) {
  assert.ok(!fs.existsSync(path.join(root, file)), `Retired editor file remains: ${file}`);
}
console.log(`PASS ${metadata.version} release metadata, manifest assets, all 13 providers and retired-feature removal`);
