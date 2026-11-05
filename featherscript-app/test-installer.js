const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runtimePresent, downloadEnvironment } = require('./scripts/install-electron');
const folder = fs.mkdtempSync(path.join(__dirname, '.test-installer-'));
try {
  const electron = path.join(folder, 'node_modules/electron');
  const dist = path.join(electron, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ devDependencies: { electron: '45.2.1' } }));
  fs.writeFileSync(path.join(electron, 'package.json'), JSON.stringify({ version: '45.2.1' }));
  fs.writeFileSync(path.join(dist, 'README'), 'partial download');
  assert.equal(runtimePresent(folder, 'win32'), false);
  fs.writeFileSync(path.join(dist, 'version'), '45.2.1');
  fs.writeFileSync(path.join(electron, 'path.txt'), 'electron.exe');
  fs.writeFileSync(path.join(dist, 'electron.exe'), 'fixture; never executed');
  assert.equal(runtimePresent(folder, 'win32'), true);
  fs.writeFileSync(path.join(dist, 'version'), '45.2.0');
  assert.equal(runtimePresent(folder, 'win32'), false);
  const original = { ELECTRON_USE_REMOTE_CHECKSUMS: '1', npm_config_electron_use_remote_checksums: '1', ELECTRON_OVERRIDE_DIST_PATH: 'other', HTTPS_PROXY: 'proxy' };
  const env = downloadEnvironment(original);
  assert.equal(env.ELECTRON_USE_REMOTE_CHECKSUMS, undefined);
  assert.equal(env.npm_config_electron_use_remote_checksums, undefined);
  assert.equal(env.ELECTRON_OVERRIDE_DIST_PATH, undefined);
  assert.equal(env.HTTPS_PROXY, 'proxy');
  assert.equal(original.ELECTRON_USE_REMOTE_CHECKSUMS, '1');
  console.log('PASS installer rejects partial/wrong-version runtime and retains embedded checksum validation');
} finally { fs.rmSync(folder, { recursive: true, force: true }); }
