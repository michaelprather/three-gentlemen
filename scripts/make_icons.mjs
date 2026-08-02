// Generate app icons: three interlocked rings (Julien, Willem, Daan) on cream, stamp-style.
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <rect width="512" height="512" fill="#f6efe3"/>
  <rect x="26" y="26" width="460" height="460" fill="none" stroke="#241c14"
        stroke-width="4" stroke-dasharray="14 12" rx="8"/>
  <g fill="none" stroke-width="26">
    <circle cx="256" cy="196" r="86" stroke="#7c2438"/>
    <circle cx="196" cy="300" r="86" stroke="#9c4a1d"/>
    <circle cx="316" cy="300" r="86" stroke="#1f4e79"/>
  </g>
  <g fill="none" stroke-width="26">
    <path d="M 256 110 a 86 86 0 0 1 74.5 129" stroke="#7c2438"/>
    <path d="M 196 214 a 86 86 0 0 1 74.5 129" stroke="#9c4a1d"/>
  </g>
</svg>`;
fs.writeFileSync('/app/icons/icon.svg', svg);

execSync('cd /tmp && npm init -y >/dev/null && npm install sharp --loglevel=error', { stdio: 'inherit' });
const { createRequire } = await import('node:module');
const sharp = createRequire('/tmp/')('sharp');
for (const size of [180, 192, 512]) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(`/app/icons/icon-${size}.png`);
}
console.log('icons done');
