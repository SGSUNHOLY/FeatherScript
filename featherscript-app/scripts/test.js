const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const appDir = path.resolve(__dirname, '..');
const root = path.resolve(appDir, '..');
const extension = path.join(root, 'featherscript-extension');

function run(command, args, cwd = appDir) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true, timeout: 60000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${path.basename(command)} ${args.join(' ')} failed (${result.status})`);
}

function javascriptFiles(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? javascriptFiles(file) : entry.name.endsWith('.js') ? [file] : [];
  });
}

function findPython() {
  const candidates = process.env.FS_TEST_PYTHON ? [[process.env.FS_TEST_PYTHON]] : [['py', '-3'], ['python'], ['python3']];
  const base = path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python');
  if (process.platform === 'win32' && fs.existsSync(base)) {
    for (const name of fs.readdirSync(base).filter((name) => /^Python3\d+$/.test(name)).sort().reverse()) candidates.push([path.join(base, name, 'python.exe')]);
  }
  for (const [command, ...args] of candidates) {
    const probe = spawnSync(command, [...args, '-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'], { windowsHide: true, timeout: 3000 });
    if (!probe.error && probe.status === 0) return { command, args };
  }
  throw Error('Python 3.9+ was not found. Set FS_TEST_PYTHON to the interpreter used by the bridge.');
}

try {
  for (const file of [...javascriptFiles(appDir), ...javascriptFiles(extension)]) run(process.execPath, ['--check', file]);
  console.log('PASS JavaScript syntax');
  for (const name of ['scripts/check-release.js', 'test-profiles.js', 'test-mcp-config.js', 'test-project-service.js', 'test-blender-diagnostics.js', 'test-renderer-assets.js', 'test-renderer-socket.js', 'test-renderer-feel.js', 'test-window-presence.js', 'test-vfx-budget.js', 'test-app-bridge.js', 'test-installer.js', 'test-appearance.js', 'test-computer-access.js', 'test-computer-tool-pack.js', 'test-layout-transitions.js']) run(process.execPath, [name]);
  for (const name of ['test-parser.js', 'test-chatgpt.js', 'test-mimo-net.js', 'test-aistudio.js', 'test-genspark.js', 'test-projects.js', 'test-project-choice.js', 'test-project-outbox.js', 'test-notion.js', 'test-startup-status.js', 'test-audio.js', 'test-audio-ui.js', 'test-provider-contracts.js', 'test-provider-recovery.js', 'test-agent-prompt.js', 'test-context-preparation.js', 'test-send-loop.js', 'test-loop-guards.js', 'test-response-runtime.js', 'test-tools-cache.js', 'test-arena-send.js', 'test-deepseek-send.js', 'test-deepseek-pacing.js', 'test-dom-runtime.js', 'test-qwen-cache.js', 'test-background.js', 'test-cowork-skills.js', 'test-command-transport.js', 'test-script-profiles.js', 'test-workflow-render.js']) run(process.execPath, [name], extension);
  const python = findPython();
  run(python.command, [...python.args, '-m', 'unittest', 'tests.test_bridge_commands', 'tests.test_command_journal', 'tests.test_computer_tools', 'tests.test_expanded_tools', 'tests.test_obsidian_vault', 'tests.test_bridge_upgrade', 'tests.test_bridge_client', 'tests.test_blender_headless', 'tests.test_svg_assets', 'tests.test_release_package', 'tests.test_skills_loading', 'tests.test_tool_groups', 'tests.test_project_memory'], root);
  console.log('PASS all local release regressions (authenticated provider sessions require separate verification)');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
