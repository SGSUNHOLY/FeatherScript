// Node smoke test for the one honest MCP verdict (run: node test-server-status.js).
// Not shipped.
//
// "Connected" used to mean "the socket answered", which is a lie twice over:
// StudioMCP advertises its whole catalogue with no Studio attached, and the
// headless Blender server lists its tools before Blender has been found. Every
// surface now quotes bridge.py's verdict through core/server-status.js, so these
// checks pin the vocabulary itself and that no surface has drifted back to
// inventing its own words from `alive`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('./core/server-status.js');

const studio = { id: 'roblox', alive: true, ready: false, tools: 34, state: 'waiting',
  error: null, fix: 'no Roblox Studio is attached - open your place, then Studio > Assistant Settings > MCP Servers.' };
const blender = { id: 'blender', alive: true, ready: true, tools: 8, state: 'working', error: null, fix: null };
const pc = { id: 'computer', alive: false, ready: false, tools: 0, state: 'offline', error: null,
  fix: 'its process is not running - start the FeatherScript desktop app and switch Computer access on.' };
const dead = { id: 'git', alive: false, ready: false, tools: 0, state: 'failed',
  error: 'ModuleNotFoundError: no module named "mcp_server_git"', fix: 'ModuleNotFoundError: no module named "mcp_server_git"' };

// ── 1. The verdict words ────────────────────────────────────────────────────
assert.equal(S.state(blender), 'working');
assert.match(S.describe(blender), /^Working · 8 commands available$/);
assert.equal(S.describe({ ...blender, tools: 1 }), 'Working · 1 command available', 'one command is not "commands"');
assert.match(S.describe(studio), /^Not ready · no Roblox Studio is attached/,
  'a proxy that answers is NOT reported as usable while Studio is closed');
assert.equal(S.state(pc), 'offline');
assert.match(S.describe(pc), /^Offline · its process is not running/);
// The bridge sends a failed server's reason twice (error and fix are the same
// string); "Not working · X · X" reads like two different problems.
assert.equal(S.describe(dead).split('ModuleNotFoundError').length - 1, 1, 'the reason is quoted once');
assert.equal(S.label('computer'), 'PC control');
assert.equal(S.label('sketchfab'), 'sketchfab', 'an addon keeps its own id rather than a wrong product name');

// ── 2. An old bridge sends no verdict: fall back to what the signals prove ──
assert.equal(S.state({ alive: true, tools: 12 }), 'working');
assert.equal(S.state({ alive: true, tools: 0 }), 'starting', 'a live pipe with no catalogue is not working');
assert.equal(S.state({ alive: false, error: 'boom' }), 'failed');
assert.equal(S.state(undefined), 'offline', 'a server nobody reported is not silently "working"');
assert.match(S.describe({ alive: true, tools: 0 }), /no commands yet/);

// ── 3. Only genuinely dead servers alarm the bar chip ───────────────────────
assert.deepEqual(S.broken([studio, blender, pc, dead]).map((x) => x.id), ['computer', 'git'],
  'Roblox has its own chip state, and a server still attaching is not a failure');
assert.deepEqual(S.broken([studio, blender]), [], 'a healthy session shows no warning');
assert.deepEqual(S.broken([]), []);

// ── 4. Shipped servers are rows, never removable addons ─────────────────────
assert.deepEqual(S.BUILTIN, ['roblox', 'blender', 'computer', 'obsidian']);
const dash = fs.readFileSync(path.join(__dirname, 'dashboard.js'), 'utf8');
assert.match(dash, /!ZSServerStatus\.BUILTIN\.includes\(x\.id\)/, 'built-ins are filtered out of the addon list');
const builtinLoop = dash.slice(dash.indexOf('for (const sv of builtins)'), dash.indexOf('for (const sv of addons)'));
assert.ok(builtinLoop.length > 40 && !builtinLoop.includes('fs-mcp-remove'), 'a shipped server gets no remove button');

// ── 5. Every reporting surface quotes the module (drift guard) ──────────────
const surfaces = ['core/main.js', 'dashboard.js', 'popup.js',
  '../featherscript-app/renderer/app.js', '../featherscript-app/renderer/modules/mcp-presets.js'];
for (const file of surfaces)
  assert.match(fs.readFileSync(path.join(__dirname, file), 'utf8'), /ZSServerStatus\./, `${file} must use the shared verdict`);
assert.match(fs.readFileSync(path.join(__dirname, 'core/main.js'), 'utf8'),
  /- \$\{ZSServerStatus\.label\(server\.id\)\}: \$\{ZSServerStatus\.describe\(server\)\}/,
  'list_mcp_servers tells the model the same thing the bar says');

// ── 6. The module is actually loaded everywhere it is quoted ────────────────
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const blocks = manifest.content_scripts.filter((cs) => (cs.js || []).includes('core/main.js'));
assert.ok(blocks.length >= 10, 'every provider gets the bootstrap script');
for (const cs of blocks)
  assert.ok(cs.js.includes('core/server-status.js'), 'the status module ships with every content script');
for (const [page, at] of [['dashboard.html', 'dashboard.js'], ['popup.html', 'popup.js'],
  ['../featherscript-app/renderer/index.html', 'modules/mcp-presets.js']]) {
  const html = fs.readFileSync(path.join(__dirname, page), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('<script src='));
  const loaded = (src) => html.some((l) => l.includes(`src="${src}"`));
  assert.ok(loaded('core/server-status.js') || loaded('../../featherscript-extension/core/server-status.js'), `${page} loads the module`);
  assert.ok(html.findIndex((l) => l.includes('server-status.js')) < html.findIndex((l) => l.includes(at)),
    `${page} loads it before ${at} runs`);
}

console.log('PASS one honest MCP verdict, quoted identically by the model, the bar, the dashboard, the popup and the app');
