const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./mcp-config');
const root = fs.mkdtempSync(path.join(__dirname, '.test-mcp-'));
try {
  const file = path.join(root, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ theme: 'midnight', mcpServers: { roblox: { command: 'original' } } }));
  for (const input of [{ executable: '\0' }, { executable: 'relative.exe' }, { safeMode: 'false' }, { enabled: 1 }, null]) {
    assert.throws(() => config.save(root, input));
  }
  config.save(root, { enabled: true, executable: '', safeMode: false });
  let saved = JSON.parse(fs.readFileSync(file));
  assert.equal(saved.theme, 'midnight');
  assert.equal(saved.mcpServers.roblox.command, 'original');
  assert.equal(saved.mcpServers.blender.command, 'blender_headless.py');
  assert.deepEqual(saved.mcpServers.blender.args, []);
  assert.equal(saved.mcpServers.blender.env.BLENDER_MCP_SAFE_MODE, '0');
  assert.equal(config.read(root).safeMode, false);
  config.save(root, { enabled: false, executable: '', safeMode: true });
  assert.equal(config.read(root).enabled, false);
  assert.equal(JSON.parse(fs.readFileSync(file)).mcpServers.blender, undefined);
  saved.mcpServers.blender = { command: 'uvx', args: ['mcp-for-blender==2.2.6'] };
  fs.writeFileSync(file, JSON.stringify(saved));
  assert.equal(config.read(root).enabled, false, 'old addon config is not advertised as headless');
  config.save(root, { enabled: true });
  assert.equal(JSON.parse(fs.readFileSync(file)).mcpServers.blender.command, 'blender_headless.py');
  console.log('PASS headless config validation, migration, safe mode, disable and primary preservation');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
