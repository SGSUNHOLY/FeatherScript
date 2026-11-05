const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, 'renderer');
function inspect(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (entry.name.endsWith('.css')) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)) {
        if (/^(data:|https?:|#)/.test(match[1])) continue;
        assert.ok(fs.existsSync(path.resolve(folder, match[1])), `Missing CSS asset: ${file} -> ${match[1]}`);
      }
    }
  }
}
inspect(root);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
  assert.ok(fs.existsSync(path.resolve(root, match[1])), `Missing renderer dependency: ${match[1]}`);
}
console.log('PASS renderer script, stylesheet and CSS asset paths');
