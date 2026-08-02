// Live test against GitHub Pages: install SW, then reload OFFLINE to prove airplane mode works.
import { createRequire } from 'node:module';
const puppeteer = createRequire('/tmp/')('puppeteer-core');

const URL = 'https://michaelprather.github.io/three-gentlemen/';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
const problems = [];
page.on('pageerror', e => problems.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
// give the SW time to finish the chunked shell precache (fonts, data, leaflet)
await new Promise(r => setTimeout(r, 25000));
const swState = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const keys = await caches.keys();
  const shell = keys.find(k => k.startsWith('tg-shell'));
  const cached = shell ? (await (await caches.open(shell)).keys()).length : 0;
  return { active: !!reg?.active, caches: keys, shellCached: cached };
});
console.log('sw:', JSON.stringify(swState));

await page.setOfflineMode(true);
await page.reload({ waitUntil: 'networkidle0', timeout: 60000 }).catch(e => problems.push('offline reload: ' + e.message));
await new Promise(r => setTimeout(r, 2500));
const offline = await page.evaluate(() => ({
  title: document.title,
  guide: document.getElementById('guide-name')?.textContent,
  pois: document.querySelectorAll('.poi-row').length,
  fontLoaded: document.fonts.check('700 20px Fraunces'),
}));
console.log('OFFLINE RELOAD:', JSON.stringify(offline));
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'no errors');
await browser.close();
