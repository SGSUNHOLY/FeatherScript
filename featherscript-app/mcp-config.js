// Headless Blender is a local Python MCP server; no addon or socket is needed.
const fs = require('fs');
const path = require('path');
function normalize(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid Blender configuration.');
  const executable = String(input.executable ?? '').trim();
  if (executable.length > 4096 || /[\x00\r\n]/.test(executable)) throw new Error('Enter a valid Blender executable path.');
  if (input.safeMode !== undefined && typeof input.safeMode !== 'boolean') throw new Error('Safe mode must be a boolean.');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('Enabled must be a boolean.');
  return { mode: 'headless', executable, safeMode: input.safeMode !== false, enabled: input.enabled === true };
}
function read(root) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  const spec = config.mcpServers?.blender;
  if (spec?.command === 'blender_headless.py') return normalize({ enabled: true, executable: spec.env?.BLENDER_EXECUTABLE, safeMode: spec.env?.BLENDER_MCP_SAFE_MODE !== '0' });
  // An old addon configuration is migrated only when the user saves this form.
  return normalize({ ...config.blender, enabled: false });
}
function save(root, input) {
  const settings = normalize(input);
  if (settings.executable && (!path.isAbsolute(settings.executable) || !fs.statSync(settings.executable).isFile())) throw new Error('Select an existing absolute Blender executable path.');
  const file = path.join(root, 'config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.mcpServers ||= {};
  if (settings.enabled) {
    config.mcpServers.blender = {
      command: 'blender_headless.py', args: [],
      env: { BLENDER_EXECUTABLE: settings.executable, BLENDER_MCP_SAFE_MODE: settings.safeMode ? '1' : '0' },
    };
  } else delete config.mcpServers.blender;
  config.blender = settings;
  const temporary = `${file}.app-${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n');
  fs.renameSync(temporary, file);
  return settings;
}
module.exports = { normalize, read, save };
