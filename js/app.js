/* Dear Madame — app logic */
(() => {
'use strict';

const CITIES = ['paris', 'bruges', 'amsterdam'];
const CITY_META = {
  paris:     { center: [48.8666, 2.3333], bounds: [[48.822, 2.255], [48.897, 2.412]] },
  bruges:    { center: [51.2089, 3.2247], bounds: [[51.185, 3.205], [51.230, 3.245]] },
  amsterdam: { center: [52.3660, 4.8970], bounds: [[52.283, 4.845], [52.402, 4.960]] },
};
const FUNFACT_LABEL = { paris: 'Entre nous…', bruges: 'Onder ons…', amsterdam: 'Tussen ons…' };
const COUNTRY_NAME = { paris: 'France', bruges: 'Belgium', amsterdam: 'Netherlands' };
const FACT_MORE = {
  paris: 'Another, s’il vous plaît',
  bruges: 'Another, alstublieft',
  amsterdam: 'Nog eentje!',
};
const FILTER_CATS = [
  ['all', 'Everything'], ['landmark', 'Landmarks'], ['food', 'Food & drink'],
  ['street', 'Streets'], ['park', 'Parks'], ['view', 'Views'],
  ['hidden', 'Hidden'], ['quirky', 'Oddities'],
];
const CAT_GLYPH = { landmark: 'L', food: 'E', street: 'S', park: 'P', view: 'V', hidden: 'H', quirky: 'O', stay: '⌂' };
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
  itinerary: null,          // day-by-day plan, weekdays only — no dates on the public web
  city: store.get('city', 'paris'),
  cityPinned: store.get('city-pinned', false),
  tab: 'guide',
  filter: 'all',         // POI category filter, shared by Guide + Near lists
  query: '',                // Guide-list search; while set, it outranks the filter
  pos: null,                // {lat, lng, ts}
  heard: new Set(store.get('heard', [])),
  kept: new Set(store.get('kept', [])),   // starred "want to see" places
  nudgesOn: store.get('nudges-on', true),
  lastNudgeAt: 0,
  poiNudgedAt: store.get('poi-nudged', {}),
  map: null, tileLayer: null, youMarker: null, markers: {},
  watchId: null,
  currentPoi: null,
  scrollLockY: 0,
  heading: null,            // compass heading, ° clockwise from true north
  compassOn: false,
  charmDeck: [],            // shuffled compliment order for the current guide
  charmTaps: 0,
};

/* ————— his voice — the Web Speech API, offline with the iPhone's own voices ————— */
const PHRASE_LANG = { paris: 'fr-FR', bruges: 'nl-BE', amsterdam: 'nl-NL' };
const TTS = (() => {
  const ok = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  let voices = [];
  const load = () => { voices = speechSynthesis.getVoices(); };
  if (ok) { load(); speechSynthesis.addEventListener?.('voiceschanged', load); }
  function pick(lang) {
    const base = lang.split('-')[0];
    return voices.find(v => v.lang.replace('_', '-') === lang)
        || voices.find(v => v.lang.replace('_', '-').startsWith(base))
        || null;
  }
  let current = null;   // the utterance now speaking, carrying its own cleanup
  function stop() {
    if (!ok || !current) return;
    const c = current;
    current = null;
    speechSynthesis.cancel();
    c._done?.();
  }
  function speak(text, lang, { rate = 1, done } = {}) {
    if (!ok) return;
    stop();
    const u = new SpeechSynthesisUtterance(text);
    const v = pick(lang);
    if (v) u.voice = v;
    u.lang = v ? v.lang : lang;
    u.rate = rate;
    u._done = done;
    u.onend = u.onerror = () => { if (current === u) { current = null; done?.(); } };
    current = u;
    // iOS drops an utterance queued in the same tick as a cancel — breathe first
    setTimeout(() => { if (current === u) speechSynthesis.speak(u); }, 60);
  }
  return { ok, speak, stop };
})();

/* the sheet's story, in an English voice — continental gentlemen prefer the British one */
function speakSheet() {
  const poi = state.currentPoi;
  if (!poi) return;
  const btn = $('sheet-speak');
  if (btn.classList.contains('is-speaking')) { TTS.stop(); return; }
  const bits = [poi.name + '.', poi.story];
  if (poi.funFact) bits.push('And between us…', poi.funFact);
  btn.textContent = 'Hush — that will do';
  btn.classList.add('is-speaking');
  TTS.speak(bits.join(' '), 'en-GB', { rate: .96, done: () => {
    btn.textContent = 'Read it to me ♪';
    btn.classList.remove('is-speaking');
  } });
}

/* a phrase, said slowly in the country's own tongue */
function speakPhrase(text, btn) {
  if (btn.classList.contains('is-speaking')) { TTS.stop(); return; }
  btn.classList.add('is-speaking');
  TTS.speak(text, PHRASE_LANG[state.city] || 'fr-FR',
    { rate: .8, done: () => btn.classList.remove('is-speaking') });
}

/* ————— geometry ————— */
const R = 6371000;
function distM(a, b) {
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
  const la = a.lat * Math.PI / 180, lb = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearingDeg(a, b) {
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const la = a.lat * Math.PI / 180, lb = b.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lb);
  const x = Math.cos(la) * Math.sin(lb) - Math.sin(la) * Math.cos(lb) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function cardinal(a, b) {
  return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round(bearingDeg(a, b) / 45) % 8];
}
/* she thinks in minutes, not metres — 80 m/min is an honest stroll with stops.
   Anything past a real walk (or browsed from home) falls back to kilometres. */
const walkMin = m => Math.max(1, Math.round(m / 80));
const fmtKm = m => m < 9950 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`;
const fmtDist = m =>
  m < 45 ? 'right here' :
  m < 8000 ? `${walkMin(m)} min walk` : fmtKm(m);
/* the prose form, for sentences he says out loud */
const fmtDistProse = m =>
  m < 45 ? 'a few steps' :
  m < 8000 ? `a ${walkMin(m)}-minute walk` : fmtKm(m);

/* ————— data ————— */
async function loadData() {
  const files = [...CITIES.map(c => `data/${c}.json`), 'data/itinerary.json', 'data/countries.json'];
  const results = await Promise.all(files.map(f =>
    fetch(f).then(r => r.json()).catch(() => null)));
  CITIES.forEach((c, i) => { if (results[i]) state.data[c] = results[i]; });
  state.itinerary = results[CITIES.length] || null;
  state.countries = results[CITIES.length + 1] || null;
}

/* accent-blind matching — 'creperie' must find the crêperie */
const fold = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const cityData = () => state.data[state.city];
const poiById = (city, id) => state.data[city]?.pois.find(p => p.id === id) || null;
const guide = () => cityData()?.guide || { name: '…', title: '', intro: '', quips: [] };

/* ————— rendering ————— */
function setCity(slug, { pinned = false } = {}) {
  if (!CITIES.includes(slug)) return;
  const prev = state.city;
  state.city = slug;
  if (slug !== prev) {
    state.charmDeck = [];
    // a new gentleman, a fresh page — the old search doesn't follow her across the border
    state.query = '';
    $('search').value = '';
    $('search-clear').hidden = true;
  }
  if (pinned) { state.cityPinned = true; store.set('city-pinned', true); }
  store.set('city', slug);
  document.body.dataset.city = slug;
  document.querySelectorAll('[data-pick-city]').forEach(b =>
    b.classList.toggle('is-active', b.dataset.pickCity === slug));
  const skyline = $('hero-skyline');
  if (skyline && window.ART) skyline.innerHTML = window.ART.skyline(slug);
  const tabCountry = $('tab-country-name');
  if (tabCountry) tabCountry.textContent = COUNTRY_NAME[slug];
  if (state.tab === 'country') renderCountry();
  if (state.tab === 'days') renderDays();
  const stamp = $('guide-stamp');
  if (stamp) { stamp.style.animation = 'none'; void stamp.offsetWidth; stamp.style.animation = ''; }
  renderGuide();
  // a new gentleman takes over: he greets her, and he winks about it
  if (slug !== prev) {
    const hellos = guide().hello || [];
    if (hellos.length) setQuip(hellos[Math.floor(Math.random() * hellos.length)]);
    wink($('guide-stamp'));
  }
  renderNear();
  if (state.map) setupMapForCity();
  closeSheet();
}

function poiRow(poi, { showDist = true, cardinalToo = false } = {}) {
  const btn = document.createElement('button');
  btn.className = 'poi-row' + (state.heard.has(poi.id) ? ' is-heard' : '') + (state.kept.has(poi.id) ? ' is-kept' : '');
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
  const stamp = $('guide-stamp');
  if (window.ART?.face) {
    stamp.classList.add('has-face');
    stamp.innerHTML = window.ART.face(state.city);
  } else {
    stamp.innerHTML = `<span id="guide-initial">${g.name[0] || '?'}</span>`;
  }
  $('guide-name').textContent = g.name;
  $('guide-sig').textContent = g.name;
  $('guide-title').textContent = g.title || '';
  $('guide-intro').textContent = g.intro || 'Loading his letter…';
  const greet = (g.greetings || {})[timeBucket()] || '';
  $('guide-greeting').hidden = !greet;
  $('guide-greeting').textContent = greet;
  document.querySelectorAll('.guide-name-inline').forEach(el => el.textContent = g.name);
  const quips = g.quips || [];
  if (quips.length) setQuip(quips[Math.floor(Math.random() * quips.length)]);
  else $('quip').hidden = true;

  const stay = $('list-stay'), iti = $('list-itinerary'), wan = $('list-wander');
  stay.textContent = ''; iti.textContent = ''; wan.textContent = '';
  // while she's searching, the query searches everything and the chips stand down
  const q = fold(state.query.trim());
  const matches = p => !q || fold(`${p.name} ${p.tagline} ${p.address || ''} ${p.story}`).includes(q);
  (d?.pois || []).forEach(p => {
    // the hotel gets its own section — it is the one pin she'll want at 23:00
    const target = p.category === 'stay' ? stay : p.itinerary ? iti : wan;
    if (!matches(p)) return;
    if (!q && target === wan && state.filter !== 'all' && p.category !== state.filter) return;
    target.appendChild(poiRow(p, { showDist: p.category === 'stay' }));
  });
  $('head-stay').hidden = !stay.children.length;
  $('head-itinerary').hidden = !iti.children.length;
  $('filter-wander').hidden = !!q;
  if (!wan.children.length) {
    const empty = document.createElement('p');
    empty.className = 'filter-empty';
    empty.textContent = q
      ? `${g.name} has nothing by that name — try another word.`
      : `${g.name} has nothing of that kind here — try another.`;
    wan.appendChild(empty);
  }
  renderFilterRows();
  $('nudge-toggle').checked = state.nudgesOn;
}

/* ————— his charm ————— */
function timeBucket() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  if (h < 23) return 'evening';
  return 'night';
}

/* swap the quip with its little fade — the CSS was waiting for this class */
function setQuip(text) {
  const q = $('quip');
  q.hidden = false;
  q.classList.remove('is-turning');
  void q.offsetWidth;
  $('quip-text').textContent = text;
  q.classList.add('is-turning');
}

/* compliments come off a shuffled deck so he never repeats himself early;
   every fifth tap he addresses the husband, who is, after all, right there */
function nextCharm() {
  const g = guide();
  state.charmTaps++;
  if (g.charmHusband && state.charmTaps % 5 === 0) return g.charmHusband;
  const pool = g.charms || [];
  if (!pool.length) return null;
  if (!state.charmDeck.length) state.charmDeck = pool.map((_, i) => i).sort(() => Math.random() - .5);
  return pool[state.charmDeck.shift()];
}

function wink(container) {
  const face = container?.querySelector('.face');
  if (!face) return;
  face.classList.remove('is-winking');
  void face.getBoundingClientRect(); // restart the animation on rapid taps
  face.classList.add('is-winking');
  clearTimeout(face._winkT);
  face._winkT = setTimeout(() => face.classList.remove('is-winking'), 1050);
}

function spawnHearts(hero) {
  if (!hero) return;
  for (let i = 0; i < 3; i++) {
    const h = document.createElement('span');
    h.className = 'heart';
    h.textContent = '♥';
    h.style.setProperty('--dx', `${Math.round(Math.random() * 72 - 36)}px`);
    h.style.setProperty('--rot', `${Math.round(Math.random() * 28 - 14)}deg`);
    h.style.animationDelay = `${i * 110}ms`;
    hero.appendChild(h);
    setTimeout(() => h.remove(), 1400 + i * 110);
  }
}

let murmurT = 0;
function hideMurmur() {
  const m = $('murmur');
  if (m.hidden) return;
  clearTimeout(murmurT);
  m.classList.add('is-leaving');
  setTimeout(() => { m.hidden = true; m.classList.remove('is-leaving'); }, 290);
}
function showMurmur(text) {
  const m = $('murmur');
  m.classList.remove('is-leaving');
  $('murmur-text').textContent = text;
  m.hidden = false;
  m.style.animation = 'none';
  void m.offsetWidth;
  m.style.animation = '';
  clearTimeout(murmurT);
  // he says it at a reading pace — long lines linger, and a tap sends him off early
  const dwell = Math.min(14000, 4200 + text.length * 70);
  murmurT = setTimeout(hideMurmur, dwell);
}

let asideT = 0;
function showAside() {
  const lines = guide().asides || [];
  if (!lines.length) return;
  const el = $('aside');
  $('aside-stamp').innerHTML = window.ART?.face ? window.ART.face(state.city, { label: false }) : '';
  $('aside-text').textContent = lines[Math.floor(Math.random() * lines.length)];
  el.classList.remove('is-leaving');
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth;
  el.style.animation = '';
  clearTimeout(asideT);
  asideT = setTimeout(() => {
    el.classList.add('is-leaving');
    setTimeout(() => { el.hidden = true; el.classList.remove('is-leaving'); }, 290);
  }, 3800);
}

/* ————— category filters ————— */
function renderFilterRows() {
  ['filter-wander', 'filter-near'].forEach(id => {
    const row = $(id);
    if (!row) return;
    row.textContent = '';
    FILTER_CATS.forEach(([key, label]) => {
      const b = document.createElement('button');
      b.className = 'filter-chip' + (state.filter === key ? ' is-active' : '');
      b.textContent = label;
      b.addEventListener('click', () => {
        state.filter = state.filter === key ? 'all' : key;
        renderGuide();
        renderNear();
      });
      row.appendChild(b);
    });
  });
}

/* ————— the days ————— */
function openPoiFrom(city, id) {
  const p = poiById(city, id);
  if (!p) return;
  if (city !== state.city) setCity(city, { pinned: true });
  openSheet(p);
}

function renderDays() {
  const it = state.itinerary, list = $('day-list');
  if (!it) return;
  $('days-title').textContent = (it.titles || {})[state.city] || it.title || 'The shape of the week';
  $('days-intro').textContent = (it.intros || {})[state.city] || it.intro || '';
  list.textContent = '';
  // the trip is one of each weekday, so the weekday name is enough to know "today"
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  let todayCard = null;
  (it.days || []).forEach(day => {
    const cities = day.cities || (day.city ? [day.city] : []);
    const isToday = day.day === todayName;

    // another gentleman's day — folded to a slip so the week keeps its shape
    if (cities.length && !cities.includes(state.city)) {
      const other = day.city || cities[0];
      const slip = document.createElement('button');
      slip.className = 'day-else' + (isToday ? ' is-today' : '');
      slip.dataset.dayCity = other;
      const gName = state.data[other]?.guide?.name || COUNTRY_NAME[other];
      slip.innerHTML =
        `<span class="day-name">${day.day}${isToday ? ' <span class="today-badge">today</span>' : ''}</span>` +
        `<span class="day-else-flag"></span>` +
        `<span class="day-else-hint">` +
        (day.route ? `<span class="day-else-route">${day.route}</span>` : '') +
        `<span>in ${gName}’s care ›</span></span>`;
      slip.addEventListener('click', () => {
        setCity(other, { pinned: true });   // he takes over, and the list redraws under his hand
        const card = list.querySelector(`.day-card[data-day="${day.day}"]`);
        if (card) requestAnimationFrame(() => card.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      });
      list.appendChild(slip);
      if (isToday) todayCard = slip;
      return;
    }

    const card = document.createElement('section');
    card.className = 'day-card';
    card.dataset.day = day.day;
    if (day.city) card.dataset.dayCity = day.city;
    if (isToday) { card.classList.add('is-today'); todayCard = card; }

    const head = document.createElement('div');
    head.className = 'day-head';
    head.innerHTML =
      `<span class="day-name">${day.day}${isToday ? ' <span class="today-badge">today</span>' : ''}</span>` +
      (day.route ? `<span class="day-route">${day.route}</span>` : '');
    card.appendChild(head);

    const times = document.createElement('ol');
    times.className = 'day-times';
    (day.items || []).forEach(item => {
      const li = document.createElement('li');
      li.innerHTML = `<span class="day-t">${item.t || '·'}</span><span class="day-d"></span>`;
      li.querySelector('.day-d').textContent = item.d;
      times.appendChild(li);
    });
    card.appendChild(times);

    if (day.note) {
      const note = document.createElement('p');
      note.className = 'day-note';
      note.textContent = day.note;
      card.appendChild(note);
    }

    if (day.stay) {
      // tappable when there's a real bed behind it — that opens the hotel's pin, map, and compass
      const tappable = day.stay.poi && poiById(day.stay.city, day.stay.poi);
      const bed = document.createElement(tappable ? 'button' : 'div');
      bed.className = 'day-bed' + (tappable ? ' is-tappable' : '');
      bed.innerHTML =
        `<span class="day-bed-glyph">⌂</span>` +
        `<span class="day-bed-body"><span class="day-bed-text"></span>` +
        (day.stay.detail ? `<span class="day-bed-detail"></span>` : '') + `</span>`;
      bed.querySelector('.day-bed-text').textContent = day.stay.text;
      if (day.stay.detail) bed.querySelector('.day-bed-detail').textContent = day.stay.detail;
      if (tappable) bed.addEventListener('click', () => openPoiFrom(day.stay.city, day.stay.poi));
      card.appendChild(bed);
    }
    list.appendChild(card);
  });
  if (todayCard) requestAnimationFrame(() =>
    todayCard.scrollIntoView({ block: 'center', behavior: 'auto' }));
}

function renderNear() {
  const list = $('list-near');
  list.textContent = '';
  const d = cityData();
  if (!d) return;
  const nearFace = $('near-face');
  if (nearFace) nearFace.innerHTML = window.ART?.face ? window.ART.face(state.city, { label: false }) : '';
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
  const pool = state.filter === 'all' ? d.pois : d.pois.filter(p => p.category === state.filter || p.category === 'stay');
  // what she's kept for later floats to the top; within each half, nearest first
  const keptRank = p => state.kept.has(p.id) ? 0 : 1;
  const sorted = [...pool].sort((a, b) =>
    keptRank(a) - keptRank(b) || distM(state.pos, a) - distM(state.pos, b));
  sorted.slice(0, 30).forEach(p => list.appendChild(poiRow(p, { showDist: true, cardinalToo: true })));
  renderFilterRows();
}

/* ————— tabs ————— */
function tabOrder() {
  return [...document.querySelectorAll('.tab')].map(b => b.dataset.tab);
}
function setTab(tab) {
  TTS.stop();
  const order = tabOrder();
  const dir = order.indexOf(tab) - order.indexOf(state.tab);
  state.tab = tab;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('is-active', b.dataset.tab === tab));
  const bar = document.querySelector('.tabbar');
  bar.style.setProperty('--tab-i', order.indexOf(tab));
  bar.style.setProperty('--tab-count', order.length);
  document.querySelectorAll('.view').forEach(v => {
    const show = v.dataset.view === tab;
    if (show && v.hidden && dir !== 0) {
      v.dataset.anim = dir > 0 ? 'left' : 'right';
      v.addEventListener('animationend', () => delete v.dataset.anim, { once: true });
    }
    v.hidden = !show;
  });
  $('map-locate').style.display = tab === 'map' ? '' : 'none';
  $('map-legend-btn').style.display = tab === 'map' ? '' : 'none';
  if (tab !== 'map') $('map-legend').hidden = true;
  if (tab === 'map') initMap();
  if (tab === 'days') renderDays();
  if (tab === 'country') renderCountry();
  if (tab === 'near') { renderNear(); startWatch(false); }
  window.scrollTo(0, 0);
}

/* ————— country picker ————— */
function toggleCountryPicker() {
  if ($('country-picker').hidden) openCountryPicker(); else closeCountryPicker();
}
function openCountryPicker() {
  $('country-picker').hidden = false;
  $('picker-scrim').hidden = false;
}
function closeCountryPicker() {
  $('country-picker').hidden = true;
  $('picker-scrim').hidden = true;
}

/* ————— his country ————— */
function renderCountry() {
  const c = state.countries?.[state.city];
  if (!c) return;
  $('country-name').textContent = c.country;
  $('country-endonym').textContent = c.endonym || '';
  $('country-intro').textContent = c.intro || '';
  $('country-sig').textContent = guide().name;
  const sigStamp = $('country-sig-stamp');
  if (sigStamp) sigStamp.innerHTML = window.ART?.face ? window.ART.face(state.city, { label: false }) : '';

  const phrases = $('phrase-list');
  phrases.textContent = '';
  (c.phrases || []).forEach(p => {
    const el = document.createElement('div');
    el.className = 'phrase';
    el.innerHTML = '<span class="phrase-say"></span><span class="phrase-pron"></span><span class="phrase-when"></span>';
    el.querySelector('.phrase-say').textContent = p.say;
    el.querySelector('.phrase-pron').textContent = p.pron || '';
    el.querySelector('.phrase-when').textContent = p.when || '';
    if (TTS.ok) {
      const b = document.createElement('button');
      b.className = 'phrase-speak';
      b.textContent = '♪';
      b.setAttribute('aria-label', `Hear “${p.say}” said aloud`);
      b.addEventListener('click', () => speakPhrase(p.say, b));
      el.appendChild(b);
    }
    phrases.appendChild(el);
  });

  const faqs = $('faq-list');
  faqs.textContent = '';
  (c.faqs || []).forEach(f => {
    const d = document.createElement('details');
    d.className = 'faq';
    const s = document.createElement('summary');
    s.textContent = f.q;
    const a = document.createElement('p');
    a.textContent = f.a;
    d.append(s, a);
    faqs.appendChild(d);
  });

  if (state.factCity !== state.city) {
    state.factCity = state.city;
    state.factOrder = (c.facts || []).map((_, i) => i).sort(() => Math.random() - .5);
    state.factI = 0;
  }
  $('fact-more').textContent = FACT_MORE[state.city] || 'Tell me another';
  drawFacts();
}

function drawFacts() {
  const c = state.countries?.[state.city];
  const list = $('fact-list');
  if (!c || !list) return;
  list.textContent = '';
  const facts = c.facts || [];
  for (let n = 0; n < Math.min(3, facts.length); n++) {
    if (state.factI >= state.factOrder.length) {
      state.factOrder.sort(() => Math.random() - .5);
      state.factI = 0;
    }
    const el = document.createElement('div');
    el.className = 'fact';
    el.style.animationDelay = `${n * 90}ms`;
    el.textContent = facts[state.factOrder[state.factI++]];
    list.appendChild(el);
  }
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
  // offMap POIs sit outside the city bounds and the tile pack — read about, not walked to
  (cityData()?.pois || []).filter(p => !p.offMap).forEach(p => {
    const icon = L.divIcon({
      className: '',
      html: `<div class="pin${p.category === 'stay' ? ' is-stay' : ''}${state.heard.has(p.id) ? ' is-heard' : ''}${state.kept.has(p.id) ? ' is-kept' : ''}"><i>${CAT_GLYPH[p.category] || '·'}</i></div>`,
      iconSize: [26, 26], iconAnchor: [13, 24],
    });
    const m = L.marker([p.lat, p.lng], { icon, zIndexOffset: p.category === 'stay' ? 500 : 0 }).addTo(map);
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
  const addr = $('sheet-address');
  if (poi.address) { addr.hidden = false; addr.textContent = poi.address; } else addr.hidden = true;
  const photoWrap = $('sheet-photo-wrap'), photoImg = $('sheet-photo');
  if (poi.photo) {
    photoImg.src = poi.photo.src;
    photoImg.alt = poi.name;
    $('sheet-photo-credit').textContent = `Photo: ${poi.photo.credit} · ${poi.photo.license}`;
    photoWrap.hidden = false;
  } else {
    photoWrap.hidden = true;
    photoImg.removeAttribute('src');
  }
  $('sheet-story').textContent = poi.story;
  $('sheet-sig').textContent = guide().name;
  const sigStamp = $('sheet-sig-stamp');
  if (sigStamp) sigStamp.innerHTML = window.ART?.face ? window.ART.face(state.city, { label: false }) : '';
  $('funfact-label').textContent = FUNFACT_LABEL[state.city] || 'Between us…';
  if (poi.funFact) { $('sheet-funfact-wrap').hidden = false; $('sheet-funfact').textContent = poi.funFact; }
  else $('sheet-funfact-wrap').hidden = true;
  updateSheetWhere();
  const link = $('sheet-link');
  if (poi.link) { link.hidden = false; link.href = poi.link; } else link.hidden = true;
  const phone = $('sheet-phone');
  // a tel: link works with no data connection — the one action on this page that always does
  if (poi.phone) { phone.hidden = false; phone.href = `tel:${poi.phone}`; } else phone.hidden = true;
  const speakBtn = $('sheet-speak');
  speakBtn.hidden = !TTS.ok;
  speakBtn.textContent = 'Read it to me ♪';
  speakBtn.classList.remove('is-speaking');
  TTS.stop();
  $('sheet-kept-btn').textContent = state.kept.has(poi.id) ? 'Kept for you ★' : 'Keep this one for me ☆';
  $('sheet-heard-btn').textContent = state.heard.has(poi.id) ? 'Tell me again sometime' : 'I’ve heard this one ✓';
  $('sheet-map-btn').hidden = fromMap || !!poi.offMap;
  $('sheet').hidden = false;
  $('sheet-scrim').hidden = false;
  $('sheet').querySelector('.sheet-scroll').scrollTop = 0;
  lockPageScroll();
}
/* distance line + compass arrow — refreshed on open, on every GPS fix, and on every heading event */
function updateSheetWhere() {
  const poi = state.currentPoi;
  if (!poi) return;
  $('sheet-dist').textContent = state.pos ? `${fmtDistProse(distM(state.pos, poi))} ${cardinal(state.pos, poi)} of you` : '';
  updateCompass();
}

function closeSheet() {
  TTS.stop();
  const sheet = $('sheet');
  sheet.hidden = true;
  sheet.classList.remove('is-dragging', 'is-settling');
  sheet.style.transform = '';
  $('sheet-scrim').hidden = true;
  $('sheet-scrim').style.opacity = '';
  $('sheet-scrim').classList.remove('is-dragging');
  state.currentPoi = null;
  unlockPageScroll();
}

/* the page behind must not scroll under the sheet — iOS ignores overflow:hidden on body */
function lockPageScroll() {
  if (document.body.classList.contains('sheet-open')) return;
  state.scrollLockY = window.scrollY;
  document.body.classList.add('sheet-open');
  document.body.style.position = 'fixed';
  document.body.style.top = `-${state.scrollLockY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
}
function unlockPageScroll() {
  if (!document.body.classList.contains('sheet-open')) return;
  document.body.classList.remove('sheet-open');
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  window.scrollTo(0, state.scrollLockY || 0);
}

/* drag the handle down to dismiss; a tap still closes */
const DISMISS_PX = 90;      // past this on release, the sheet goes
const TAP_PX = 6;           // under this, it was a tap not a drag
function wireSheetDrag() {
  const sheet = $('sheet');
  const scrim = $('sheet-scrim');
  const grip = sheet.querySelector('.sheet-handle');
  let pointerId = null, startY = 0, dy = 0;

  grip.addEventListener('pointerdown', e => {
    if (pointerId !== null) return;
    pointerId = e.pointerId;
    startY = e.clientY;
    dy = 0;
    sheet.classList.add('is-dragging');
    sheet.classList.remove('is-settling');
    scrim.classList.add('is-dragging');
    grip.setPointerCapture(pointerId);
  });

  grip.addEventListener('pointermove', e => {
    if (e.pointerId !== pointerId) return;
    e.preventDefault();
    dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
    scrim.style.opacity = String(Math.max(0, 1 - dy / 320));
  });

  const end = e => {
    if (e.pointerId !== pointerId) return;
    if (grip.hasPointerCapture(pointerId)) grip.releasePointerCapture(pointerId);
    pointerId = null;
    sheet.classList.remove('is-dragging');

    if (dy > DISMISS_PX || dy <= TAP_PX) { closeSheet(); return; }

    // short of the threshold — spring back. is-settling stays until close; dropping it
    // would restore the sheetup animation and replay the entry slide.
    sheet.classList.add('is-settling');
    sheet.style.transform = '';
    scrim.style.opacity = '';
    scrim.classList.remove('is-dragging');
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}
/* the star — she keeps a place for later; the sheet stays open, she's still reading */
function markKept(poi) {
  if (state.kept.has(poi.id)) state.kept.delete(poi.id); else state.kept.add(poi.id);
  store.set('kept', [...state.kept]);
  $('sheet-kept-btn').textContent = state.kept.has(poi.id) ? 'Kept for you ★' : 'Keep this one for me ☆';
  renderGuide(); renderNear();
  if (state.map) {
    const m = state.markers[poi.id];
    if (m) m.getElement()?.querySelector('.pin')?.classList.toggle('is-kept', state.kept.has(poi.id));
  }
}

function markHeard(poi) {
  const adding = !state.heard.has(poi.id);
  if (adding) state.heard.add(poi.id); else state.heard.delete(poi.id);
  store.set('heard', [...state.heard]);
  if (adding) showAside();
  renderGuide(); renderNear();
  if (state.map) {
    const m = state.markers[poi.id];
    if (m) m.getElement()?.querySelector('.pin')?.classList.toggle('is-heard', state.heard.has(poi.id));
  }
}

/* ————— compass ————— */
const compassSupported = 'DeviceOrientationEvent' in window;
let compassDenied = store.get('compass-no', false);
let compassRaf = 0;

function onHeading(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
    h = e.webkitCompassHeading; // iOS: already ° clockwise from north
  } else if (e.absolute && typeof e.alpha === 'number') {
    h = (360 - e.alpha + (screen.orientation?.angle || 0)) % 360;
  }
  if (h == null) return;
  state.heading = h;
  if (!compassRaf) compassRaf = requestAnimationFrame(() => { compassRaf = 0; updateCompass(); });
}

/* iOS grants motion access only from inside a tap — hence a button, not autostart */
function startCompass() {
  const attach = () => {
    state.compassOn = true;
    window.addEventListener('deviceorientationabsolute', onHeading);
    window.addEventListener('deviceorientation', onHeading);
    updateCompass();
  };
  const deny = () => {
    compassDenied = true;
    store.set('compass-no', true);
    $('sheet-compass').hidden = true;
  };
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(res => { if (res === 'granted') attach(); else deny(); })
      .catch(deny);
  } else attach();
}

function updateCompass() {
  const btn = $('sheet-compass'), poi = state.currentPoi;
  if (!poi) return;
  if (!compassSupported || compassDenied || !state.pos) { btn.hidden = true; return; }
  btn.hidden = false;
  const live = state.compassOn && state.heading != null;
  btn.classList.toggle('is-live', live);
  // the ➤ glyph points east at 0°, so offset −90 makes 0° point up
  const rot = live ? bearingDeg(state.pos, poi) - state.heading - 90 : -90;
  $('compass-arrow').style.transform = `rotate(${rot}deg)`;
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
    updateSheetWhere();
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
    if (p.category === 'stay') continue;   // nobody needs telling about their own hotel
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
  const nudgeStamp = $('nudge-initial');
  if (window.ART?.face) {
    nudgeStamp.classList.add('has-face');
    nudgeStamp.innerHTML = window.ART.face(state.city, { label: false });
  } else nudgeStamp.textContent = g.name[0];
  $('nudge-guide').textContent = g.name;
  $('nudge-msg').textContent = `${best.name} is ${fmtDistProse(bestDist)} away. ${g.nudgeAsk || 'May I tell you about it?'}`;
  const nudge = $('nudge');
  nudge.hidden = false;
  nudge.dataset.poi = best.id;
  clearTimeout(nudge._t);
  nudge._t = setTimeout(() => { nudge.hidden = true; }, 14000);
}

/* ————— offline pack (map tiles) ————— */
const TILE_CACHE = 'tg-tiles-v1'; // must match sw.js

/* iOS can evict Cache Storage under disk pressure. Sample the pack on every
   launch: if tiles are gone, clear pack-done so warmOfflinePack refetches
   (cache hits cost nothing), and say so while wifi is still an option. */
async function verifyOfflinePack() {
  if (!('caches' in window) || !store.get('pack-done', false)) return;
  let urls;
  try {
    urls = (await fetch('tiles-index.json').then(r => r.json())).tiles;
    const cache = await caches.open(TILE_CACHE);
    const step = Math.max(1, Math.floor(urls.length / 40));
    const sample = urls.filter((_, i) => i % step === 0);
    const hits = await Promise.all(sample.map(u => cache.match(u)));
    if (hits.every(Boolean)) return;
  } catch { return; }
  store.set('pack-done', false);
  if (!navigator.onLine) {
    const pill = $('pack-pill');
    pill.querySelector('.pack-label').textContent =
      'Some offline maps went missing — open me on wifi and I’ll fetch them back';
    pill.querySelector('.pack-fill').style.width = '0%';
    pill.hidden = false;
  }
}

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

/* ————— splash ————— */
function openSplash() {
  const splash = $('splash');
  splash.querySelectorAll('.splash-face').forEach(el => {
    el.innerHTML = window.ART?.face ? window.ART.face(el.dataset.face, { label: false }) : '';
  });
  splash.classList.remove('is-closing');
  splash.hidden = false;
  splash.querySelector('.splash-scroll').scrollTop = 0;
}
function closeSplash() {
  store.set('splash-seen', true);
  const splash = $('splash');
  splash.classList.add('is-closing');
  setTimeout(() => { splash.hidden = true; splash.classList.remove('is-closing'); }, 380);
}

/* ————— wiring ————— */
function wire() {
  $('wordmark').addEventListener('click', openSplash);
  $('splash-cta').addEventListener('click', closeSplash);
  document.querySelectorAll('[data-splash-city]').forEach(b =>
    b.addEventListener('click', () => {
      wink(b); // he winks before he takes her arm
      setTimeout(() => {
        setCity(b.dataset.splashCity, { pinned: true });
        setTab('guide');
        closeSplash();
      }, 420);
    }));
  // tap his portrait: a wink, a compliment, and a few hearts he pretends not to notice
  $('guide-stamp').addEventListener('click', () => {
    wink($('guide-stamp'));
    spawnHearts(document.querySelector('.guide-hero'));
    const line = nextCharm();
    if (line) showMurmur(line);
  });
  $('murmur').addEventListener('click', hideMurmur);
  // the ⌂ in the masthead: straight to tonight's bed, with distance and compass
  $('home-btn').addEventListener('click', () => {
    const bed = (cityData()?.pois || []).find(p => p.category === 'stay');
    if (!bed) return;
    startWatch(true);   // the tap doubles as the location grant iOS wants
    openSheet(bed);
  });
  // the little signature stamps wink too, for whoever finds them
  document.querySelectorAll('.sig-stamp').forEach(el =>
    el.addEventListener('click', () => wink(el)));
  document.querySelectorAll('.tab').forEach(b =>
    b.addEventListener('click', () => {
      // the flag tab is the country switcher — it asks before it navigates
      if (b.dataset.tab === 'country') { toggleCountryPicker(); return; }
      closeCountryPicker();
      setTab(b.dataset.tab);
    }));
  document.querySelectorAll('[data-pick-city]').forEach(b =>
    b.addEventListener('click', () => {
      closeCountryPicker();
      setCity(b.dataset.pickCity, { pinned: true });
      setTab('country');
    }));
  $('picker-scrim').addEventListener('click', closeCountryPicker);
  $('search').addEventListener('input', e => {
    state.query = e.target.value;
    $('search-clear').hidden = !state.query;
    renderGuide();
  });
  $('search-clear').addEventListener('click', () => {
    state.query = '';
    $('search').value = '';
    $('search-clear').hidden = true;
    renderGuide();
    $('search').focus();
  });
  $('near-locate').addEventListener('click', () => {
    $('near-msg').textContent = 'un moment — finding you…';
    startWatch(true);
  });
  $('map-locate').addEventListener('click', () => {
    startWatch(true);
    if (state.pos && state.map) state.map.setView([state.pos.lat, state.pos.lng], Math.max(state.map.getZoom(), 15));
  });
  $('map-legend-btn').addEventListener('click', () => {
    $('map-legend').hidden = !$('map-legend').hidden;
  });
  $('fact-more').addEventListener('click', drawFacts);
  $('sheet-scrim').addEventListener('click', closeSheet);
  wireSheetDrag();
  $('sheet-compass').addEventListener('click', () => { if (!state.compassOn) startCompass(); });
  $('sheet-speak').addEventListener('click', speakSheet);
  $('sheet-kept-btn').addEventListener('click', () => { if (state.currentPoi) markKept(state.currentPoi); });
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
  // ask the browser not to evict the ~55 MB tile cache under storage pressure
  navigator.storage?.persist?.().catch(() => {});
  await loadData();
  setCity(state.city);
  setTab('guide');
  if (!store.get('splash-seen', false)) openSplash();
  startWatch(false);
  verifyOfflinePack().then(warmOfflinePack);
  setInterval(() => {
    const quips = guide().quips || [];
    if (quips.length && state.tab === 'guide') {
      setQuip(quips[Math.floor(Math.random() * quips.length)]);
    }
  }, 30000);
})();
})();
