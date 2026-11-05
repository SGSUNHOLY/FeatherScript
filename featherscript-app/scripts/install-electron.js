// SPDX-License-Identifier: GPL-3.0-or-later
// Explicit first-run installer. npm dependency lifecycle scripts stay disabled.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const appDir = path.resolve(__dirname, '..');

function runtimePresent(base = appDir, platform = process.platform) {
  try {
    const expected = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8')).devDependencies.electron;
    const folder = path.join(base, 'node_modules', 'electron');
    const installed = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')).version;
    const binary = platform === 'win32' ? 'electron.exe' : platform === 'darwin' ? 'Electron.app/Contents/MacOS/Electron' : 'electron';
    return installed === expected &&
      fs.readFileSync(path.join(folder, 'dist', 'version'), 'utf8').trim().replace(/^v/, '') === expected &&
      fs.readFileSync(path.join(folder, 'path.txt'), 'utf8').trim() === binary &&
      fs.statSync(path.join(folder, 'dist', binary)).isFile() &&
      fs.statSync(path.join(folder, 'dist', binary)).size > 0;
  } catch { return false; }
}

function downloadEnvironment(source = process.env) {
  const env = { ...source };
  // Use the npm package's embedded official checksums and this machine's platform.
  for (const key of Object.keys(env)) {
    if (/^(electron_use_remote_checksums|npm_config_electron_use_remote_checksums|electron_override_dist_path)$/i.test(key)) delete env[key];
  }
  env.ELECTRON_INSTALL_PLATFORM = process.platform;
  env.ELECTRON_INSTALL_ARCH = process.arch;
  return env;
}

function main() {
  if (runtimePresent()) return 0;
  const folder = path.join(appDir, 'node_modules', 'electron');
  const installer = path.join(folder, 'install.js');
  if (!fs.existsSync(installer)) throw Error('Electron dependencies are missing. Run app.bat or npm ci --include=dev --ignore-scripts first.');
  const expected = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).devDependencies.electron;
  const installed = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')).version;
  if (installed !== expected) throw Error('Electron package version differs from the release. Run npm ci --include=dev --ignore-scripts.');
  console.log(`[featherscript] Installing Electron ${expected}; its downloader verifies the embedded release checksums.`);
  const result = spawnSync(process.execPath, [installer], { cwd: appDir, stdio: 'inherit', env: downloadEnvironment() });
  if (result.error) throw result.error;
  if (result.status !== 0 || !runtimePresent()) throw Error('Electron installation failed. Keep antivirus protection enabled; report any detection name and affected file. Check the download output and network connection before retrying.');
  console.log('[featherscript] Electron runtime installed.');
  return 0;
}

module.exports = { runtimePresent, downloadEnvironment };
if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`[featherscript] ${error.message}`); process.exitCode = 1; }
}
