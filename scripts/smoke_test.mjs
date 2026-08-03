// Headless smoke test: serve the app, drive it at iPhone size, screenshot each view.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire('/tmp/');
const puppeteer = require('puppeteer-core');

const ROOT = '/app';
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
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

// first launch opens the splash — read it, then put it away
const splashUp = await page.evaluate(() => !document.getElementById('splash').hidden);
if (splashUp) {
  await page.screenshot({ path: '/shots/0-splash.png' });
  await page.click('#splash-cta');
  await new Promise(r => setTimeout(r, 600));
}
await page.screenshot({ path: '/shots/1-guide.png' });

// the city page: carousel + searchable list
await page.click('[data-tab="city"]');
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: '/shots/2-city.png' });

// open a POI sheet from the itinerary list
await page.click('#list-itinerary .poi-row');
await new Promise(r => setTimeout(r, 700));
await page.screenshot({ path: '/shots/3-sheet.png' });
await page.mouse.click(195, 150); // tap the dimmed area above the sheet, like a thumb would
await new Promise(r => setTimeout(r, 400));

// near panel from the masthead ◎ (no geolocation granted — should show Find me gracefully)
await page.click('#near-btn');
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/shots/4-near.png' });
await page.click('#near-close');
await new Promise(r => setTimeout(r, 300));

// days: chips, one card at a time
await page.click('[data-tab="days"]');
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/shots/5-days.png' });
const chips = await page.$$('.day-chip');
if (chips[1]) { await chips[1].click(); await new Promise(r => setTimeout(r, 400)); }
await page.screenshot({ path: '/shots/6-days-second-chip.png' });

// country page
await page.click('[data-tab="country"]');
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: '/shots/7-country.png' });

// map view
await page.click('[data-tab="map"]');
await new Promise(r => setTimeout(r, 2500));
await page.screenshot({ path: '/shots/8-map.png' });

// second tap on the flag tab opens the picker; cross to the Netherlands
await page.click('[data-tab="country"]');
await new Promise(r => setTimeout(r, 300));
await page.click('[data-tab="country"]');
await new Promise(r => setTimeout(r, 400));
await page.screenshot({ path: '/shots/9-picker.png' });
await page.click('[data-pick-city="amsterdam"]');
await page.click('[data-tab="city"]');
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: '/shots/10-amsterdam-city.png' });

const counts = await page.evaluate(() => ({
  itinerary: document.querySelectorAll('#list-itinerary .poi-row').length,
  wander: document.querySelectorAll('#list-wander .poi-row').length,
  beautySlides: document.querySelectorAll('.beauty-slide').length,
  dayChips: document.querySelectorAll('.day-chip').length,
  guideName: document.getElementById('guide-name').textContent,
  cityTitle: document.getElementById('city-title').textContent,
  tabGuide: document.getElementById('tab-guide-name').textContent,
  tabCity: document.getElementById('tab-city-name').textContent,
  introLen: document.getElementById('guide-intro').textContent.length,
}));
console.log('render check:', JSON.stringify(counts));
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no console/page errors');
await browser.close();
server.close();
