#!/bin/bash
# Fetch offline-vendored dependencies: Leaflet 1.9.4 and Google Fonts (Fraunces + Literata).
# Run inside the node:22 container with /app mounted to guide-app/.
set -euo pipefail
cd /app

LEAFLET=https://unpkg.com/leaflet@1.9.4/dist
curl -fsSL "$LEAFLET/leaflet.js" -o js/leaflet/leaflet.js
curl -fsSL "$LEAFLET/leaflet.css" -o js/leaflet/leaflet.css
for img in marker-icon.png marker-icon-2x.png marker-shadow.png layers.png layers-2x.png; do
  curl -fsSL "$LEAFLET/images/$img" -o "js/leaflet/images/$img"
done

# Google Fonts: request css2 with a woff2-capable UA, extract latin-subset URLs.
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
fetch_family () {
  local url="$1" prefix="$2"
  curl -fsSL -A "$UA" "$url" -o "/tmp/${prefix}.css"
}
fetch_family "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&display=swap" fraunces
fetch_family "https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,500;0,7..72,700;1,7..72,400&display=swap" literata

node - <<'EOF'
const fs = require('fs');
const https = require('https');
function dl(url, dest) {
  return new Promise((res, rej) => {
    https.get(url, r => {
      if (r.statusCode !== 200) return rej(new Error(url + ' -> ' + r.statusCode));
      const f = fs.createWriteStream(dest);
      r.pipe(f); f.on('finish', () => f.close(res));
    }).on('error', rej);
  });
}
(async () => {
  const faces = [];
  for (const name of ['fraunces', 'literata']) {
    const css = fs.readFileSync('/tmp/' + name + '.css', 'utf8');
    // Parse @font-face blocks, keep latin subset only
    const blocks = css.split('@font-face').slice(1);
    let i = 0;
    for (const b of blocks) {
      const unicode = b.match(/unicode-range:\s*([^;]+);/)?.[1] || '';
      if (!unicode.includes('U+0000-00FF')) continue; // latin only
      const url = b.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
      const style = b.match(/font-style:\s*(\w+)/)?.[1] || 'normal';
      const weight = b.match(/font-weight:\s*([\d ]+)/)?.[1].trim() || '400';
      if (!url) continue;
      const file = `fonts/${name}-${weight.replace(' ', '-')}-${style}.woff2`;
      await dl(url, '/app/' + file);
      faces.push({ family: name === 'fraunces' ? 'Fraunces' : 'Literata', file, style, weight });
      i++;
    }
  }
  const cssOut = faces.map(f => `@font-face{font-family:'${f.family}';font-style:${f.style};font-weight:${f.weight};font-display:swap;src:url('../${f.file}') format('woff2');}`).join('\n');
  fs.writeFileSync('/app/css/fonts.css', cssOut + '\n');
  console.log('fonts:', faces.map(f => f.file).join(', '));
})();
EOF
echo VENDOR-OK
