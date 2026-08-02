// Headless smoke test: serve the app, drive it at iPhone size, screenshot each view.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire('/tmp/');
const puppeteer = require('puppeteer-core');

const ROOT = '/app';
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end(); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(8080, r));

const browser = await puppeteer.launch({
  executablePath: '/usr/bin/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
const problems = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(`console.${m.type()}: ${m.text()}`); });
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('requestfailed', r => problems.push('reqfail: ' + r.url().slice(-80)));

await page.goto('http://localhost:8080/', { waitUntil: 'networkidle2', timeout: 30000 });
await new Promise(r => setTimeout(r, 1500));
fs.mkdirSync('/shots', { recursive: true });
await page.screenshot({ path: '/shots/1-guide.png' });

// open a POI sheet
await page.click('#list-itinerary .poi-row');
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: '/shots/2-sheet.png' });
await page.mouse.click(195, 150); // tap the dimmed area above the sheet, like a thumb would
await new Promise(r => setTimeout(r, 400));

// near view (no geolocation granted — should show Find me gracefully)
await page.click('[data-tab="near"]');
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/shots/3-near.png' });

// map view
await page.click('[data-tab="map"]');
await new Promise(r => setTimeout(r, 2500));
await page.screenshot({ path: '/shots/4-map.png' });

// switch city to amsterdam
await page.click('[data-city-chip="amsterdam"]');
await page.click('[data-tab="guide"]');
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: '/shots/5-amsterdam.png' });

const counts = await page.evaluate(() => ({
  itinerary: document.querySelectorAll('#list-itinerary .poi-row').length,
  wander: document.querySelectorAll('#list-wander .poi-row').length,
  guideName: document.getElementById('guide-name').textContent,
  introLen: document.getElementById('guide-intro').textContent.length,
}));
console.log('render check:', JSON.stringify(counts));
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no console/page errors');
await browser.close();
server.close();
