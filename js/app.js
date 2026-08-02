/* Three Gentlemen — app logic */
(() => {
'use strict';

const CITIES = ['paris', 'bruges', 'amsterdam'];
const CITY_META = {
  paris:     { center: [48.8666, 2.3333], bounds: [[48.822, 2.255], [48.897, 2.412]] },
  bruges:    { center: [51.2089, 3.2247], bounds: [[51.185, 3.205], [51.230, 3.245]] },
  amsterdam: { center: [52.3660, 4.8970], bounds: [[52.283, 4.845], [52.402, 4.960]] },
};
const FUNFACT_LABEL = { paris: 'Entre nous…', bruges: 'Onder ons…', amsterdam: 'Tussen ons…' };
const CAT_GLYPH = { landmark: 'L', food: 'E', street: 'S', park: 'P', view: 'V', hidden: 'H', quirky: 'O' };
const NUDGE_RADIUS_M = 130;
const NUDGE_COOLDOWN_MS = 4 * 60 * 1000;
const NUDGE_POI_REPEAT_MS = 2 * 60 * 60 * 1000;

const $ = id => document.getElementById(id);
const store = {
  get(k, fallback) { try { const v = localStorage.getItem('tg-' + k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem('tg-' + k, JSON.stringify(v)); } catch {} },
};

const state = {
  data: {},                 // citySlug -> city file
  city: store.get('city', 'paris'),
  cityPinned: store.get('city-pinned', false),
  tab: 'guide',
  pos: null,                // {lat, lng, ts}
  heard: new Set(store.get('heard', [])),
  nudgesOn: store.get('nudges-on', true),
  lastNudgeAt: 0,
  poiNudgedAt: store.get('poi-nudged', {}),
  map: null, tileLayer: null, youMarker: null, markers: {},
  watchId: null,
  currentPoi: null,
};

/* ————— geometry ————— */
const R = 6371000;
function distM(a, b) {
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const la = a.lat * Math.PI / 180, lb = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function cardinal(a, b) {
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la = a.lat * Math.PI / 180, lb = b.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lb);
  const x = Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dLng);
  const brg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(brg / 45) % 8];
}
const fmtDist = m => m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;

/* ————— data ————— */
async function loadData() {
  const results = await Promise.all(CITIES.map(c =>
    fetch(`data/${c}.json`).then(r => r.json()).catch(() => null)));
  CITIES.forEach((c, i) => { if (results[i]) state.data[c] = results[i]; });
}

const cityData = () => state.data[state.city];
const guide = () => cityData()?.guide || { name: '…', title: '', intro: '', quips: [] };

/* ————— rendering ————— */
function setCity(slug, { pinned = false } = {}) {
  if (!CITIES.includes(slug)) return;
  state.city = slug;
  if (pinned) { state.cityPinned = true; store.set('city-pinned', true); }
  store.set('city', slug);
  document.body.dataset.city = slug;
  document.querySelectorAll('[data-city-chip]').forEach(b =>
    b.classList.toggle('is-active', b.dataset.cityChip === slug));
  renderGuide();
  renderNear();
  if (state.map) setupMapForCity();
  closeSheet();
}

function poiRow(poi, { showDist = true, cardinalToo = false } = {}) {
  const btn = document.createElement('button');
  btn.className = 'poi-row' + (state.heard.has(poi.id) ? ' is-heard' : '');
  btn.dataset.poi = poi.id;
  let side = `<span class="cat-chip">${poi.category}</span>`;
  if (showDist && state.pos) {
    const d = distM(state.pos, poi);
    side = `<span class="poi-dist">${fmtDist(d)}</span>` +
      (cardinalToo ? `<span class="near-cardinal">${cardinal(state.pos, poi)}</span>` : '') + side;
  }
  btn.innerHTML =
    `<span class="poi-name">${poi.name}</span>` +
    `<span class="poi-tag">${poi.tagline}</span>` +
    `<span class="poi-side">${side}</span>`;
  btn.addEventListener('click', () => openSheet(poi));
  return btn;
}

function renderGuide() {
  const g = guide(), d = cityData();
  $('guide-initial').textContent = g.name[0] || '?';
  $('guide-name').textContent = g.name;
  $('guide-sig').textContent = g.name;
  $('guide-title').textContent = g.title || '';
  $('guide-intro').textContent = g.intro || 'Loading his letter…';
  document.querySelectorAll('.guide-name-inline').forEach(el => el.textContent = g.name);
  const quips = g.quips || [];
  if (quips.length) {
    $('quip').hidden = false;
    $('quip-text').textContent = quips[Math.floor(Math.random() * quips.length)];
  } else $('quip').hidden = true;

  const iti = $('list-itinerary'), wan = $('list-wander');
  iti.textContent = ''; wan.textContent = '';
  (d?.pois || []).forEach(p => (p.itinerary ? iti : wan).appendChild(poiRow(p, { showDist: false })));
  $('nudge-toggle').checked = state.nudgesOn;
}

function renderNear() {
  const list = $('list-near');
  list.textContent = '';
  const d = cityData();
  if (!d) return;
  if (!state.pos) {
    $('near-msg').textContent = 'so I can tell you what’s around you, madame';
    $('near-locate').hidden = false;
    return;
  }
  $('near-locate').hidden = true;
  const within = distM(state.pos, { lat: CITY_META[state.city].center[0], lng: CITY_META[state.city].center[1] }) < 60000;
  $('near-msg').textContent = within
    ? `${guide().name} is watching the street for you…`
    : `you’re not in ${d.city} yet — browse ahead, I’ll wait`;
  const sorted = [...d.pois].sort((a, b) => distM(state.pos, a) - distM(state.pos, b));
  sorted.slice(0, 30).forEach(p => list.appendChild(poiRow(p, { showDist: true, cardinalToo: true })));
}

/* ————— tabs ————— */
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => v.hidden = v.dataset.view !== tab);
  $('map-locate').style.display = tab === 'map' ? '' : 'none';
  if (tab === 'map') initMap();
  if (tab === 'near') { renderNear(); startWatch(false); }
  window.scrollTo(0, 0);
}

/* ————— map ————— */
function initMap() {
  if (state.map) { setTimeout(() => state.map.invalidateSize(), 60); return; }
  const map = L.map('map', { zoomControl: false, attributionControl: true });
  map.attributionControl.setPrefix('');
  state.map = map;
  setupMapForCity();
  map.on('click', () => closeSheet());
}
function setupMapForCity() {
  const map = state.map, meta = CITY_META[state.city];
  if (!map) return;
  if (state.tileLayer) map.removeLayer(state.tileLayer);
  Object.values(state.markers).forEach(m => map.removeLayer(m));
  state.markers = {};
  state.tileLayer = L.tileLayer('tiles/{z}/{x}/{y}.png', {
    minZoom: 12, maxZoom: 18, maxNativeZoom: 16,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAPbv4wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==',
  }).addTo(map);
  map.setMaxBounds(L.latLngBounds(meta.bounds).pad(0.15));
  map.setView(meta.center, 14);
  (cityData()?.pois || []).forEach(p => {
    const icon = L.divIcon({
      className: '',
      html: `<div class="pin${state.heard.has(p.id) ? ' is-heard' : ''}"><i>${CAT_GLYPH[p.category] || '·'}</i></div>`,
      iconSize: [26, 26], iconAnchor: [13, 24],
    });
    const m = L.marker([p.lat, p.lng], { icon }).addTo(map);
    m.on('click', () => openSheet(p, { fromMap: true }));
    state.markers[p.id] = m;
  });
  if (state.pos) updateYouMarker();
}
function updateYouMarker() {
  if (!state.map || !state.pos) return;
  const ll = [state.pos.lat, state.pos.lng];
  if (!state.youMarker) {
    state.youMarker = L.marker(ll, {
      icon: L.divIcon({ className: '', html: '<div class="you-dot" style="width:16px;height:16px"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
      interactive: false, zIndexOffset: 1000,
    }).addTo(state.map);
  } else state.youMarker.setLatLng(ll);
}

/* ————— sheet ————— */
function openSheet(poi, { fromMap = false } = {}) {
  state.currentPoi = poi;
  $('sheet-cat').textContent = poi.category;
  $('sheet-name').textContent = poi.name;
  $('sheet-tagline').textContent = poi.tagline;
  $('sheet-story').textContent = poi.story;
  $('sheet-sig').textContent = guide().name;
  $('funfact-label').textContent = FUNFACT_LABEL[state.city] || 'Between us…';
  if (poi.funFact) { $('sheet-funfact-wrap').hidden = false; $('sheet-funfact').textContent = poi.funFact; }
  else $('sheet-funfact-wrap').hidden = true;
  $('sheet-dist').textContent = state.pos ? `${fmtDist(distM(state.pos, poi))} ${cardinal(state.pos, poi)} of you` : '';
  const link = $('sheet-link');
  if (poi.link) { link.hidden = false; link.href = poi.link; } else link.hidden = true;
  $('sheet-heard-btn').textContent = state.heard.has(poi.id) ? 'Tell me again sometime' : 'I’ve heard this one ✓';
  $('sheet-map-btn').hidden = fromMap;
  $('sheet').hidden = false;
  $('sheet-scrim').hidden = false;
  $('sheet').querySelector('.sheet-scroll').scrollTop = 0;
}
function closeSheet() {
  $('sheet').hidden = true;
  $('sheet-scrim').hidden = true;
  state.currentPoi = null;
}
function markHeard(poi) {
  if (state.heard.has(poi.id)) state.heard.delete(poi.id); else state.heard.add(poi.id);
  store.set('heard', [...state.heard]);
  renderGuide(); renderNear();
  if (state.map) {
    const m = state.markers[poi.id];
    if (m) m.getElement()?.querySelector('.pin')?.classList.toggle('is-heard', state.heard.has(poi.id));
  }
}

/* ————— geolocation + nudges ————— */
function startWatch(fromTap) {
  if (state.watchId != null || !('geolocation' in navigator)) return;
  if (!fromTap && !store.get('geo-ok', false)) return;
  state.watchId = navigator.geolocation.watchPosition(pos => {
    store.set('geo-ok', true);
    state.pos = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now() };
    maybeAutoCity();
    if (state.tab === 'near') renderNear();
    updateYouMarker();
    maybeNudge();
  }, err => {
    if (fromTap) $('near-msg').textContent = 'I can’t find you — check Location Services for Safari, chérie';
  }, { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 });
}
function maybeAutoCity() {
  // Switch guides only when the GPS-derived city CHANGES, so she can browse a
  // city ahead of time without the app fighting her choice.
  let best = null, bestD = Infinity;
  for (const c of CITIES) {
    const d = distM(state.pos, { lat: CITY_META[c].center[0], lng: CITY_META[c].center[1] });
    if (d < bestD) { bestD = d; best = c; }
  }
  const geoCity = bestD < 50000 ? best : null;
  if (geoCity && geoCity !== store.get('geo-city', null)) {
    store.set('geo-city', geoCity);
    store.set('city-pinned', false);
    state.cityPinned = false;
    if (geoCity !== state.city) setCity(geoCity);
  }
}
function maybeNudge() {
  if (!state.nudgesOn || !state.pos || state.currentPoi) return;
  const now = Date.now();
  if (now - state.lastNudgeAt < NUDGE_COOLDOWN_MS) return;
  const d = cityData();
  if (!d) return;
  let best = null, bestDist = Infinity;
  for (const p of d.pois) {
    if (state.heard.has(p.id)) continue;
    if (now - (state.poiNudgedAt[p.id] || 0) < NUDGE_POI_REPEAT_MS) continue;
    const dist = distM(state.pos, p);
    if (dist < NUDGE_RADIUS_M && dist < bestDist) { best = p; bestDist = dist; }
  }
  if (!best) return;
  state.lastNudgeAt = now;
  state.poiNudgedAt[best.id] = now;
  store.set('poi-nudged', state.poiNudgedAt);
  const g = guide();
  $('nudge-initial').textContent = g.name[0];
  $('nudge-guide').textContent = g.name;
  $('nudge-msg').textContent = `${best.name} is ${fmtDist(bestDist)} away. May I tell you about it?`;
  const nudge = $('nudge');
  nudge.hidden = false;
  nudge.dataset.poi = best.id;
  clearTimeout(nudge._t);
  nudge._t = setTimeout(() => { nudge.hidden = true; }, 14000);
}

/* ————— offline pack (map tiles) ————— */
async function warmOfflinePack() {
  if (!('serviceWorker' in navigator) || !navigator.onLine) return;
  if (store.get('pack-done', false)) return;
  let index;
  try { index = await fetch('tiles-index.json').then(r => r.json()); } catch { return; }
  await navigator.serviceWorker.ready;
  const pill = $('pack-pill'), fill = pill.querySelector('.pack-fill'), label = pill.querySelector('.pack-label');
  pill.hidden = false;
  let done = 0;
  const urls = index.tiles;
  const CONC = 6;
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const u = urls[i++];
      try { await fetch(u, { cache: 'no-cache' }); } catch {}
      done++;
      if (done % 20 === 0 || done === urls.length) {
        fill.style.width = `${Math.round(100 * done / urls.length)}%`;
        label.textContent = `Preparing offline maps… ${Math.round(100 * done / urls.length)}%`;
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker));
  store.set('pack-done', true);
  label.textContent = 'Offline maps ready ✓ — airplane mode is fine now';
  fill.style.width = '100%';
  setTimeout(() => { pill.hidden = true; }, 6000);
}

/* ————— wiring ————— */
function wire() {
  document.querySelectorAll('[data-city-chip]').forEach(b =>
    b.addEventListener('click', () => {
      store.set('city-pinned-at-city', b.dataset.cityChip);
      setCity(b.dataset.cityChip, { pinned: true });
    }));
  document.querySelectorAll('.tab').forEach(b =>
    b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('near-locate').addEventListener('click', () => {
    $('near-msg').textContent = 'un moment — finding you…';
    startWatch(true);
  });
  $('map-locate').addEventListener('click', () => {
    startWatch(true);
    if (state.pos && state.map) state.map.setView([state.pos.lat, state.pos.lng], Math.max(state.map.getZoom(), 15));
  });
  $('sheet-scrim').addEventListener('click', closeSheet);
  $('sheet').querySelector('.sheet-handle').addEventListener('click', closeSheet);
  $('sheet-heard-btn').addEventListener('click', () => { if (state.currentPoi) { markHeard(state.currentPoi); closeSheet(); } });
  $('sheet-map-btn').addEventListener('click', () => {
    const p = state.currentPoi;
    closeSheet();
    setTab('map');
    setTimeout(() => { state.map.setView([p.lat, p.lng], 16); }, 120);
  });
  $('nudge').addEventListener('click', () => {
    const id = $('nudge').dataset.poi;
    $('nudge').hidden = true;
    const p = cityData()?.pois.find(x => x.id === id);
    if (p) openSheet(p);
  });
  $('nudge-toggle').addEventListener('change', e => {
    state.nudgesOn = e.target.checked;
    store.set('nudges-on', state.nudgesOn);
  });
  $('reset-heard').addEventListener('click', () => {
    state.heard.clear(); store.set('heard', []);
    renderGuide(); renderNear();
    if (state.map) setupMapForCity();
  });
  const setOnline = () => document.body.classList.toggle('online', navigator.onLine);
  window.addEventListener('online', setOnline);
  window.addEventListener('offline', setOnline);
  setOnline();
}

/* ————— boot ————— */
(async function boot() {
  wire();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  await loadData();
  setCity(state.city);
  setTab('guide');
  startWatch(false);
  warmOfflinePack();
  setInterval(() => {
    const quips = guide().quips || [];
    if (quips.length && state.tab === 'guide') {
      $('quip-text').textContent = quips[Math.floor(Math.random() * quips.length)];
    }
  }, 30000);
})();
})();
