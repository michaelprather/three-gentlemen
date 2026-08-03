// Build step: generate precache-manifest.js (app shell) and tiles-index.json (offline map pack).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.env.APP_ROOT || '/app';

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// tile index
const tiles = walk(path.join(ROOT, 'tiles'))
  .filter(f => f.endsWith('.png'))
  .map(f => path.relative(ROOT, f))
  .sort();
fs.writeFileSync(path.join(ROOT, 'tiles-index.json'), JSON.stringify({ tiles }));

// app shell precache list
const SHELL_DIRS = ['css', 'fonts', 'icons', 'js', 'data', 'photos'];
const shell = ['index.html', 'manifest.webmanifest', 'tiles-index.json'];
for (const d of SHELL_DIRS) {
  for (const f of walk(path.join(ROOT, d))) {
    const rel = path.relative(ROOT, f);
    if (rel.endsWith('.svg') && rel.startsWith('icons/')) continue;
    shell.push(rel);
  }
}
const hash = crypto.createHash('sha256');
for (const f of shell) {
  try { hash.update(fs.readFileSync(path.join(ROOT, f))); } catch {}
}
const version = hash.digest('hex').slice(0, 10);
fs.writeFileSync(path.join(ROOT, 'precache-manifest.js'),
  `self.__VERSION=${JSON.stringify(version)};\nself.__PRECACHE=${JSON.stringify(shell)};\n`);
console.log(`precache: ${shell.length} shell files, ${tiles.length} tiles, version ${version}`);
