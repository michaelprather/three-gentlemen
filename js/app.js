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
/* what his rubber stamp says when a story is marked heard */
const POSTMARK_WORD = { paris: 'Bien entendu', bruges: 'Goed ontvangen', amsterdam: 'Genoteerd' };
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
  beauty: null,             // per-city carousel of the city at her best
  city: store.get('city', 'paris'),
  cityPinned: store.get('city-pinned', false),
  tab: 'guide',
  filter: 'all',         // POI category filter, shared by City + Near lists
  query: '',                // City-list search; while set, it outranks the filter
  dayPick: null,            // weekday chosen on the Days chips; follows across borders
  nearOpen: false,          // the ◎ panel is up
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
  const files = [...CITIES.map(c => `data/${c}.json`), 'data/itinerary.json', 'data/countries.json', 'data/beauty.json'];
  const results = await Promise.all(files.map(f =>
    fetch(f).then(r => r.json()).catch(() => null)));
  CITIES.forEach((c, i) => { if (results[i]) state.data[c] = results[i]; });
  state.itinerary = results[CITIES.length] || null;
  state.countries = results[CITIES.length + 1] || null;
  state.beauty = results[CITIES.length + 2] || null;
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
  // the tab bar is his: flag, his face, his skyline, his names
  $('tab-country-name').textContent = COUNTRY_NAME[slug];
  $('tab-guide-name').textContent = guide().name;
  $('tab-city-name').textContent = cityData()?.city || '';
  if (window.ART) {
    $('tab-face').innerHTML = window.ART.face(slug, { label: false });
    $('tab-skyline').innerHTML = window.ART.skyline(slug);
  }
  if (state.tab === 'country') renderCountry();
  if (state.tab === 'days') renderDays();
  const stamp = $('guide-stamp');
  if (stamp) { stamp.style.animation = 'none'; void stamp.offsetWidth; stamp.style.animation = ''; }
  renderGuide();
  renderCity();
  renderBeauty();
  // a new gentleman takes over: he greets her, he winks about it, and his
  // flag ripples up the mast and the tab bar
  if (slug !== prev) {
    const hellos = guide().hello || [];
    if (hellos.length) setQuip(hellos[Math.floor(Math.random() * hellos.length)]);
    wink($('guide-stamp'));
    document.querySelectorAll('.mast-flag, .tab-flag').forEach(f => {
      f.classList.remove('is-waving');
      void f.offsetWidth;
      f.classList.add('is-waving');
      clearTimeout(f._waveT);
      f._waveT = setTimeout(() => f.classList.remove('is-waving'), 750);
    });
  }
  renderNear({ deal: true });
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

/* stagger the rows in like cards off a deck, capped so long lists stay brisk */
function dealIn(list) {
  [...list.children].forEach((el, i) => el.style.setProperty('--d', `${Math.min(i, 8) * 26}ms`));
}

function renderGuide() {
  const g = guide();
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
  $('nudge-toggle').checked = state.nudgesOn;
}

/* ————— his city: her portraits, his list ————— */
function renderCity({ deal = true } = {}) {
  const g = guide(), d = cityData();
  $('city-title').textContent = d?.city || '';
  $('city-sub').textContent = g.name === '…' ? '' :
    `every stone of it in ${g.name}’s keeping`;

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
  // the deal-in cascade only plays on a fresh page — a search redraws on every
  // keystroke, and state re-renders happen behind the open sheet
  const noDeal = !!q || !deal;
  [stay, iti, wan].forEach(l => {
    l.classList.toggle('no-deal', noDeal);
    if (!noDeal) dealIn(l);
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
}

/* ————— the beauty of the place — a few photographs he keeps in his coat ————— */
function renderBeauty() {
  const wrap = $('beauty'), track = $('beauty-track'), dots = $('beauty-dots');
  if (!wrap) return;
  const shots = state.beauty?.[state.city] || [];
  wrap.hidden = !shots.length;
  track.textContent = '';
  dots.textContent = '';
  shots.forEach((s, i) => {
    const fig = document.createElement('figure');
    fig.className = 'beauty-slide';
    fig.style.setProperty('--tilt', `${i % 2 ? .7 : -.7}deg`);
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = s.src;
    img.alt = s.name || '';
    const cap = document.createElement('figcaption');
    const line = document.createElement('span');
    line.className = 'beauty-cap';
    line.textContent = s.caption || '';
    const credit = document.createElement('span');
    credit.className = 'beauty-credit';
    credit.textContent = `Photo: ${s.credit} · ${s.license}`;
    cap.append(line, credit);
    fig.append(img, cap);
    // the photograph is also a door — tap it and he tells the story
    if (s.poi) fig.addEventListener('click', () => {
      const p = poiById(state.city, s.poi);
      if (p) openSheet(p);
    });
    track.appendChild(fig);
    const dot = document.createElement('span');
    dot.className = 'beauty-dot' + (i ? '' : ' is-active');
    dots.appendChild(dot);
  });
  track.scrollLeft = 0;
}

/* keep the dots under the carousel honest as she swipes */
let beautyRaf = 0;
function onBeautyScroll() {
  if (beautyRaf) return;
  beautyRaf = requestAnimationFrame(() => {
    beautyRaf = 0;
    const track = $('beauty-track');
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0, bestD = Infinity;
    [...track.children].forEach((el, i) => {
      const c = el.offsetLeft + el.offsetWidth / 2;
      if (Math.abs(c - mid) < bestD) { bestD = Math.abs(c - mid); best = i; }
    });
    [...$('beauty-dots').children].forEach((d, i) => d.classList.toggle('is-active', i === best));
  });
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

/* a burst of gilt stars off the button when she keeps a place for later */
function spawnSparks(host) {
  if (!host) return;
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('span');
    s.className = 'spark';
    s.textContent = '✦';
    const a = (i / 6) * 2 * Math.PI + Math.random() * .6;
    const r = 26 + Math.random() * 22;
    s.style.setProperty('--sx', `${Math.round(Math.cos(a) * r)}px`);
    s.style.setProperty('--sy', `${Math.round(Math.sin(a) * r * .7)}px`);
    s.style.setProperty('--sr', `${Math.round(Math.random() * 90 - 45)}deg`);
    s.style.animationDelay = `${i * 20}ms`;
    host.appendChild(s);
    setTimeout(() => s.remove(), 800);
  }
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
        renderCity();
        renderNear({ deal: true });
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

function dayCard(day, isToday) {
  const card = document.createElement('section');
  card.className = 'day-card';
  card.dataset.day = day.day;
  if (day.city) card.dataset.dayCity = day.city;
  if (isToday) card.classList.add('is-today');

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
  return card;
}

function renderDays() {
  const it = state.itinerary;
  if (!it) return;
  $('days-title').textContent = (it.titles || {})[state.city] || it.title || 'The shape of the week';
  $('days-intro').textContent = (it.intros || {})[state.city] || it.intro || '';

  // only his own days — the week's other pages belong to the other gentlemen.
  // Border days (Sun, Mon) carry both cities and appear in both countries.
  const days = (it.days || []).filter(d =>
    (d.cities || (d.city ? [d.city] : [])).includes(state.city));

  // the trip is one of each weekday, so the weekday name is enough to know "today"
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  let sel = state.dayPick;
  if (!days.some(d => d.day === sel)) {
    sel = days.some(d => d.day === todayName) ? todayName : days[0]?.day;
  }
  state.dayPick = sel;

  const chips = $('day-chips');
  chips.textContent = '';
  days.forEach(d => {
    const chip = document.createElement('button');
    chip.className = 'day-chip'
      + (d.day === sel ? ' is-active' : '')
      + (d.day === todayName ? ' is-today' : '');
    chip.setAttribute('role', 'tab');
    chip.setAttribute('aria-selected', d.day === sel ? 'true' : 'false');
    chip.innerHTML =
      `<span class="day-chip-name">${d.day.slice(0, 3)}</span>` +
      (d.route ? `<span class="day-chip-route">${d.route}</span>` : '');
    chip.addEventListener('click', () => { state.dayPick = d.day; renderDays(); });
    chips.appendChild(chip);
  });

  const list = $('day-list');
  list.textContent = '';
  const day = days.find(d => d.day === sel);
  if (day) list.appendChild(dayCard(day, day.day === todayName));
}

function renderNear({ deal = false } = {}) {
  // deal only on deliberate arrivals — GPS fixes re-render every few seconds
  const list = $('list-near');
  list.classList.toggle('no-deal', !deal);
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
  if (deal) dealIn(list);
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
  window.scrollTo(0, 0);
}

/* ————— near me — the ◎ panel, up from the masthead ————— */
function openNear() {
  state.nearOpen = true;
  $('near-panel').hidden = false;
  $('near-scrim').hidden = false;
  $('near-panel').querySelector('.near-scroll').scrollTop = 0;
  renderNear({ deal: true });
  startWatch(false);
}
function closeNear() {
  state.nearOpen = false;
  $('near-panel').hidden = true;
  $('near-scrim').hidden = true;
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
  (cityData()?.pois || []).filter(p => !p.offMap).forEach((p, i) => {
    // the .pin-drop wrapper takes the entrance animation so the pin itself
    // keeps its rotate/scale transforms untouched
    const icon = L.divIcon({
      className: '',
      html: `<div class="pin-drop" style="animation-delay:${Math.min(i * 45, 700)}ms">` +
        `<div class="pin${p.category === 'stay' ? ' is-stay' : ''}${state.heard.has(p.id) ? ' is-heard' : ''}${state.kept.has(p.id) ? ' is-kept' : ''}"><i>${CAT_GLYPH[p.category] || '·'}</i></div></div>`,
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
  // a nudge can open a new card while a stamp-close is pending — cancel it
  clearTimeout(stampT);
  $('postmark').hidden = true;
  $('sheet').classList.remove('is-stamped');
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

/* his rubber stamp comes down on the letter, and a beat later it's filed away */
let stampT = 0;
function stampAndClose() {
  $('postmark-word').textContent = POSTMARK_WORD[state.city] || 'Received';
  $('postmark-sig').textContent = `— ${guide().name}`;
  $('postmark').hidden = false;   // un-hiding restarts the slam animation
  $('sheet').classList.add('is-stamped');
  clearTimeout(stampT);
  stampT = setTimeout(closeSheet, 900);
}

function closeSheet() {
  TTS.stop();
  clearTimeout(stampT);
  $('postmark').hidden = true;
  const sheet = $('sheet');
  sheet.hidden = true;
  sheet.classList.remove('is-dragging', 'is-settling', 'is-stamped');
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
  const adding = !state.kept.has(poi.id);
  if (adding) { state.kept.add(poi.id); spawnSparks($('sheet-kept-btn')); }
  else state.kept.delete(poi.id);
  store.set('kept', [...state.kept]);
  $('sheet-kept-btn').textContent = state.kept.has(poi.id) ? 'Kept for you ★' : 'Keep this one for me ☆';
  renderCity({ deal: false }); renderNear();
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
  renderCity({ deal: false }); renderNear();
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
    if (state.nearOpen) renderNear();
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
  const from = store.get('geo-city', null);
  if (geoCity && geoCity !== from) {
    store.set('geo-city', geoCity);
    store.set('city-pinned', false);
    state.cityPinned = false;
    if (geoCity !== state.city) setCity(geoCity);
    // she has truly left a city she was in — the departed gentleman gets a last word
    if (from) maybeFarewell(from, geoCity);
  }
}

/* ————— the farewell letter ————— */
function tallyPhrase(city) {
  const pois = state.data[city]?.pois || [];
  const n = pois.filter(p => state.heard.has(p.id)).length;
  if (!n) return 'none of my stories — which I choose to find mysterious';
  if (n === 1) return 'just one of my stories';
  return `${n} of my stories`;
}
function maybeFarewell(from, to) {
  const g = state.data[from]?.guide, f = g?.farewell;
  if (!f) return;
  const shown = store.get('farewell-shown', {});
  const key = `${from}>${to}`;
  if (shown[key]) return;                    // one goodbye per border, ever
  shown[key] = true;
  store.set('farewell-shown', shown);
  const el = $('farewell');
  el.dataset.dayCity = from;                 // his colours, not his successor's
  $('farewell-face').innerHTML = window.ART?.face ? window.ART.face(from, { label: false }) : '';
  $('farewell-name').textContent = g.name;
  $('farewell-sig').textContent = g.name;
  $('farewell-body').textContent = f.body.replace('{tally}', tallyPhrase(from));
  $('farewell-close').textContent = f.close || 'Farewell';
  // let the new gentleman's takeover settle before the old one clears his throat
  setTimeout(() => { $('farewell-scrim').hidden = false; el.hidden = false; }, 1200);
}
function closeFarewell() {
  $('farewell').hidden = true;
  $('farewell-scrim').hidden = true;
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
      // the flag tab opens his country; a second tap asks which country
      if (b.dataset.tab === 'country' && state.tab === 'country') { toggleCountryPicker(); return; }
      closeCountryPicker();
      setTab(b.dataset.tab);
    }));
  $('country-switch').addEventListener('click', openCountryPicker);
  document.querySelectorAll('[data-pick-city]').forEach(b =>
    b.addEventListener('click', () => {
      closeCountryPicker();
      setCity(b.dataset.pickCity, { pinned: true });
      setTab('country');
    }));
  $('picker-scrim').addEventListener('click', closeCountryPicker);
  $('near-btn').addEventListener('click', openNear);
  $('near-close').addEventListener('click', closeNear);
  $('near-scrim').addEventListener('click', closeNear);
  $('beauty-track').addEventListener('scroll', onBeautyScroll, { passive: true });
  $('search').addEventListener('input', e => {
    state.query = e.target.value;
    $('search-clear').hidden = !state.query;
    renderCity();
  });
  $('search-clear').addEventListener('click', () => {
    state.query = '';
    $('search').value = '';
    $('search-clear').hidden = true;
    renderCity();
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
  // marking a story heard earns the letter his postmark before it's filed away
  $('sheet-heard-btn').addEventListener('click', () => {
    const p = state.currentPoi;
    if (!p) return;
    const adding = !state.heard.has(p.id);
    markHeard(p);
    if (adding) stampAndClose(); else closeSheet();
  });
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
  $('farewell-close').addEventListener('click', closeFarewell);
  $('farewell-scrim').addEventListener('click', closeFarewell);
  $('nudge-toggle').addEventListener('change', e => {
    state.nudgesOn = e.target.checked;
    store.set('nudges-on', state.nudgesOn);
  });
  $('reset-heard').addEventListener('click', () => {
    state.heard.clear(); store.set('heard', []);
    renderCity(); renderNear();
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
