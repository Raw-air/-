const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.mkdirSync(output, { recursive: true });
const shell = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const assets = [...shell.matchAll(/'\.\/([^']+)'/g)].map(m => m[1].split('?')[0]);
for (const name of new Set([...assets, 'sw.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'export.js'])) {
  fs.copyFileSync(path.join(root, name), path.join(output, name));
}
console.log('Static Pages shell built into dist; all offline assets resolved.');
