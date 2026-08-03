// Generate app icons: the three guides' portrait medallions (Julien, Willem, Daan)
// grouped on cream, borderless. Faces come from js/art.js so the icon always
// matches the in-app portraits. Runs in a node container with the app mounted
// at /app (override with APP_ROOT).
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const ROOT = process.env.APP_ROOT || '/app';

// art.js is browser code that assigns window.ART; give it a window to land on.
const window = {};
new Function('window', fs.readFileSync(`${ROOT}/js/art.js`, 'utf8'))(window);

// Re-attribute a portrait for nested placement inside the icon canvas.
const medallion = (city, x, y, w) =>
  window.ART.face(city, { label: false })
    .replace('<svg class="face"', `<svg x="${x}" y="${y}" width="${w}" height="${w}"`);

// Group portrait: Julien behind at top centre, Willem and Daan in front below —
// same triangle as the old three-ring mark, no stamp border.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" fill="#f6efe3"/>
  ${medallion('paris', 126, 48, 260)}
  ${medallion('bruges', 28, 206, 260)}
  ${medallion('amsterdam', 224, 206, 260)}
</svg>`;
fs.writeFileSync(`${ROOT}/icons/icon.svg`, svg);

execSync('cd /tmp && npm init -y >/dev/null && npm install sharp --loglevel=error', { stdio: 'inherit' });
const { createRequire } = await import('node:module');
const sharp = createRequire('/tmp/')('sharp');
for (const size of [180, 192, 512]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`${ROOT}/icons/icon-${size}.png`);
}
console.log('icons done');
