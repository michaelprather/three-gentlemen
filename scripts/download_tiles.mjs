// One-time, throttled download of OSM raster tiles for offline use on a single
// personal trip device. Polite: 2 workers, delay between requests, identifying UA.
import fs from 'node:fs';
import path from 'node:path';

const UA = 'three-gentlemen-trip-guide/1.0 (one-time personal vacation app; contact: repo owner)';
const OUT = '/app/tiles';
const DELAY_MS = 220;
const WORKERS = 2;

// [south, west, north, east, zooms]
const REGIONS = [
  { name: 'paris',            box: [48.822, 2.255, 48.897, 2.412], zooms: [13, 14, 15, 16] },
  { name: 'bruges',           box: [51.185, 3.205, 51.230, 3.245], zooms: [13, 14, 15, 16] },
  { name: 'amsterdam',        box: [52.330, 4.845, 52.402, 4.960], zooms: [13, 14, 15, 16] },
  { name: 'amstel-corridor',  box: [52.283, 4.870, 52.330, 4.930], zooms: [13, 14, 15] },
];

const lng2x = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const jobs = [];
const seen = new Set();
for (const { box, zooms } of REGIONS) {
  const [s, w, n, e] = box;
  for (const z of zooms) {
    const x0 = lng2x(w, z), x1 = lng2x(e, z);
    const y0 = lat2y(n, z), y1 = lat2y(s, z); // y grows southward
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${z}/${x}/${y}`;
        if (!seen.has(key)) { seen.add(key); jobs.push({ z, x, y }); }
      }
    }
  }
}
console.log(`tiles to fetch: ${jobs.length}`);

const sleep = ms => new Promise(r => setTimeout(r, ms));
let done = 0, skipped = 0;
const failed = [];

async function fetchTile({ z, x, y }, attempt = 1) {
  const dest = path.join(OUT, String(z), String(x), `${y}.png`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { skipped++; return; }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const sub = 'abc'[(x + y) % 3];
  const url = `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
  } catch (err) {
    if (attempt < 3) { await sleep(1500 * attempt); return fetchTile({ z, x, y }, attempt + 1); }
    failed.push(`${z}/${x}/${y}: ${err.message}`);
  }
}

let idx = 0;
async function worker() {
  while (idx < jobs.length) {
    const job = jobs[idx++];
    await fetchTile(job);
    done++;
    if (done % 200 === 0) console.log(`progress: ${done}/${jobs.length}`);
    await sleep(DELAY_MS);
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker));
console.log(`done. fetched+existing: ${done} (already had ${skipped}), failed: ${failed.length}`);
if (failed.length) fs.writeFileSync('/app/tiles/failed.txt', failed.join('\n'));
