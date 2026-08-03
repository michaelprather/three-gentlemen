/* Dear Madame — per-city artwork.
   Everything inline SVG, no external assets: the app must draw itself in airplane mode.
   Skylines are single silhouette paths, tinted via currentColor so each city's
   accent ink colours its own horizon. */
window.ART = (() => {
  'use strict';

  const sky = (d, extra = '', rule = 'nonzero') =>
    `<svg class="skyline" viewBox="0 0 360 64" preserveAspectRatio="xMidYMax meet" aria-hidden="true">` +
    `<path fill="currentColor" fill-rule="${rule}" d="${d}"/>${extra}</svg>`;

  /* Paris — Haussmann roofs, Arc de Triomphe, Sacré-Cœur, Eiffel, Notre-Dame, Panthéon */
  const PARIS =
    'M0,64 L0,38 L6,38 L6,33 L9,33 L9,38 L20,38 L20,33 L23,33 L23,38 L28,38' +
    ' L30,38 L30,21 L33,21 L33,18 L59,18 L59,21 L62,21 L62,38 L66,38 L66,42 L74,42 L74,38 L77,38 L77,42 L90,42 L90,36' +
    ' L94,36 Q100,26 106,36 L108,36 L108,34 L110,34 Q113,20 122,17 L122,10 L120,10 L120,8 L122,8 L122,4 L124,4 L124,8 L126,8 L126,10 L124,10 L124,17 Q133,20 136,34 L136,36 L138,36' +
    ' L140,36 Q146,26 152,36 L154,36 L154,44 L162,44 L162,40 L165,40 L165,44 L178,44 L178,64' +
    ' L182,64 Q193,40 200,28 L198,28 L198,25 L202,25 L204,14 L203,14 L203,11 L206,11 L208,3 L209,0 L210,0 L211,3 L213,11 L216,11 L216,14 L215,14 L217,25 L221,25 L221,28 L219,28 Q226,40 237,64' +
    ' L250,64 L250,22 L266,22 L266,30 L268,30 L271,14 L272,11 L273,14 L276,30 L278,30 L278,22 L294,22 L294,64' +
    ' L306,64 L306,38 L310,38 L310,34 L316,34 L316,32 Q318,22 327,20 L327,15 L328,15 L328,12 L330,12 L330,15 L331,15 L331,20 Q340,22 342,32 L342,34 L348,34 L348,38 L352,38 L352,64 Z' +
    ' M40,64 L40,32 Q46,24 52,32 L52,64 Z' +
    ' M188,64 Q209,38 230,64 Z';

  /* Bruges — step gables, Church of Our Lady, the Belfort, a windmill, the Kruispoort */
  const BRUGES =
    'M0,64 L0,44 L4,44 L4,40 L8,40 L8,36 L12,36 L12,32 L15,32 L15,28 L18,28 L18,32 L21,32 L21,36 L25,36 L25,40 L29,40 L29,44 L33,44 L33,48' +
    ' L36,48 L44,38 L52,48 L56,48 L56,64' +
    ' L66,64 L66,26 L70,26 L70,22 L74,22 L74,26 L76,26 L81,6 L82,2 L83,6 L88,26 L90,26 L90,22 L94,22 L94,26 L98,26 L98,64' +
    ' L104,64 L104,46 L108,46 L112,40 L116,46 L124,46 L128,38 L132,46 L140,46 L140,42 L143,42 L143,46 L148,46 L148,50 L152,50 L152,64' +
    ' L162,64 L162,34 L170,34 L170,20 L176,20 L176,6 L179,6 L179,10 L184,10 L184,3 L187,3 L187,10 L192,10 L192,6 L195,6 L195,10 L196,10 L196,20 L202,20 L202,34 L210,34 L210,64' +
    ' L220,64 L220,44 L223,44 L223,40 L227,40 L227,36 L231,36 L231,32 L234,32 L234,36 L238,36 L238,40 L242,40 L242,44 L245,44 L245,64' +
    ' L272,64 L274,36 Q275,28 280,28 Q285,28 286,36 L288,64' +
    ' L322,64 L322,34 L321,34 L328,22 L335,34 L334,34 L334,44 L344,44 L344,34 L343,34 L350,22 L357,34 L356,34 L356,64 Z' +
    ' M268,13 L271,10 L292,45 L289,48 Z' +
    ' M292,13 L289,10 L268,45 L271,48 Z';

  /* Amsterdam — spout, bell, neck & step gables, Westerkerk, Montelbaanstoren, Magere Brug */
  const AMSTERDAM =
    'M0,64 L0,30 L4,30 L4,26 L16,26 L16,30 L20,30 L20,36 L26,36 C30,35 31,30 32,27 L33,24 L39,24 L40,27 C41,30 42,35 46,36 L48,36' +
    ' L52,38 L52,28 L56,28 L58,28 L58,20 L61,17 L64,20 L64,28 L68,28 L68,38 L72,38' +
    ' L76,38 L76,34 L80,34 L80,30 L84,30 L84,26 L87,26 L87,30 L91,30 L91,34 L95,34 L95,38 L98,38' +
    ' L98,40 L102,40 L102,34 L108,28 L114,34 L114,40 L118,40 L118,64' +
    ' L130,64 L130,26 L136,26 L136,18 L139,18 Q136,14 139,11 L143,9 L146,1 L149,9 L153,11 Q156,14 153,18 L156,18 L156,26 L162,26 L162,64' +
    ' L168,64 L168,38 C172,37 173,32 174,29 L175,26 L181,26 L182,29 C183,32 184,37 188,38 L192,38' +
    ' L192,34 L196,34 L196,30 L200,30 L200,26 L203,26 L203,30 L207,30 L207,34 L211,34 L211,38 L214,38' +
    ' L218,38 L218,32 L224,26 L230,32 L230,38 L236,38 L236,30 L240,30 L240,22 L244,19 L248,22 L248,30 L252,30 L252,38 L256,38 L256,64' +
    ' L266,64 L266,30 L268,30 L278,10 L278,6 L277,6 L277,4 L281,4 L281,6 L280,6 L280,10 L290,30 L292,30 L292,64' +
    ' L300,64 L300,46 L352,46 L352,64 Z' +
    ' M306,64 Q315,48 324,64 Z' +
    ' M328,64 Q337,48 346,64 Z' +
    ' M312,46 L318,28 L324,46 Z M315,44 L318,33 L321,44 Z' +
    ' M332,46 L338,28 L344,46 Z M335,44 L338,33 L341,44 Z';

  const SKYLINES = {
    paris: sky(PARIS, '', 'evenodd'),
    bruges: sky(BRUGES),
    amsterdam: sky(AMSTERDAM, '', 'evenodd'),
  };

  /* One building lifted from each horizon for the city tab — the same paths as
     the skylines above, re-origined to stand alone: the Eiffel Tower, the
     Belfort, the Westerkerk. Drawn to a shared 64-unit height so their true
     proportions survive side by side. */
  const land = (w, d, rule = 'nonzero') =>
    `<svg class="landmark" viewBox="0 0 ${w} 64" preserveAspectRatio="xMidYMax meet" aria-hidden="true">` +
    `<path fill="currentColor" fill-rule="${rule}" d="${d}"/></svg>`;

  const LANDMARKS = {
    paris: land(55,
      'M0,64 Q11,40 18,28 L16,28 L16,25 L20,25 L22,14 L21,14 L21,11 L24,11 L26,3 L27,0 L28,0 L29,3' +
      ' L31,11 L34,11 L34,14 L33,14 L35,25 L39,25 L39,28 L37,28 Q44,40 55,64 Z' +
      ' M6,64 Q27,38 48,64 Z', 'evenodd'),
    bruges: land(48,
      'M0,64 L0,34 L8,34 L8,20 L14,20 L14,6 L17,6 L17,10 L22,10 L22,3 L25,3 L25,10 L30,10 L30,6' +
      ' L33,6 L33,10 L34,10 L34,20 L40,20 L40,34 L48,34 L48,64 Z'),
    amsterdam: land(32,
      'M0,64 L0,26 L6,26 L6,18 L9,18 Q6,14 9,11 L13,9 L16,1 L19,9 L23,11 Q26,14 23,18' +
      ' L26,18 L26,26 L32,26 L32,64 Z'),
  };

  /* ————— the gentlemen themselves —————
     One drawing style, three characters: paper skin, ink lines, each in his
     country's colours. Class hooks (.head .eye .brow-* .mouth .hair) are
     animated from app.css; ids are suffixed per instance so several portraits
     can live in the page at once. */

  const SKIN = '#eeddc2', INK = '#241c14';

  const shoulders = (fill) =>
    `<path d="M14,120 C16,100 30,88 46,86 L60,92 L74,86 C90,88 104,100 106,120 Z" fill="${fill}" stroke="${INK}" stroke-width="1.4"/>`;
  const neck = () =>
    `<rect x="53" y="66" width="14" height="20" rx="4" fill="${SKIN}" stroke="${INK}" stroke-width="1.2"/>`;
  const ears = (lx, rx, y) =>
    `<circle cx="${lx}" cy="${y}" r="4" fill="${SKIN}" stroke="${INK}" stroke-width="1.2"/>` +
    `<circle cx="${rx}" cy="${y}" r="4" fill="${SKIN}" stroke="${INK}" stroke-width="1.2"/>`;
  const eyes = (lx, rx, y, r) =>
    `<g class="eye eye-l"><circle cx="${lx}" cy="${y}" r="${r}" fill="${INK}"/></g>` +
    `<g class="eye eye-r"><circle cx="${rx}" cy="${y}" r="${r}" fill="${INK}"/></g>`;

  const BODIES = {
    julien: accent =>
      shoulders('#433931') +
      `<path d="M52,86 L60,92 L68,86 L66,100 Q60,106 54,100 Z" fill="${accent}" stroke="${INK}" stroke-width="1.1"/>` +
      neck(),
    willem: () =>
      shoulders('#d9c9a8') +
      `<path d="M45,97 L75,97 L73,120 L47,120 Z" fill="#7a4522" stroke="${INK}" stroke-width="1.2"/>` +
      `<path d="M47,97 L40,88 M73,97 L80,88" fill="none" stroke="${INK}" stroke-width="1.2"/>` +
      `<path d="M50,85 L60,91 L70,85 L65,99 L55,99 Z" fill="#c2922b" stroke="${INK}" stroke-width="1.1"/>` +
      neck(),
    daan: () =>
      shoulders('#24517e') +
      `<path d="M43,93 C46,87 50,84 54,83 L59,91 L50,100 Z" fill="#c9682e" stroke="${INK}" stroke-width="1.1"/>` +
      `<path d="M77,93 C74,87 70,84 66,83 L61,91 L70,100 Z" fill="#c9682e" stroke="${INK}" stroke-width="1.1"/>` +
      neck(),
  };

  const HEADS = {
    julien: () =>
      ears(40, 80, 55) +
      `<path d="M41,51 C41,35 49,28 60,28 C71,28 79,35 79,51 C79,66 71,78 60,78 C49,78 41,66 41,51 Z" fill="${SKIN}" stroke="${INK}" stroke-width="1.5"/>` +
      `<path d="M40,56 C38,32 48,23 60,23 C72,23 82,32 80,56 C79,44 78,38 74,36 C66,33 52,33 46,36 C42,38 41,44 40,56 Z" fill="#cfc4b0" stroke="${INK}" stroke-width="1.3"/>` +
      `<path d="M49,29.5 C53,27.5 58,26.8 62,27 M67,30 C70,31 73,33 75,35.5" fill="none" stroke="${INK}" stroke-width=".8" opacity=".5"/>` +
      `<path class="brow-l" d="M42,48 L52,46.5" stroke="#8d8271" stroke-width="2.4" stroke-linecap="round" fill="none"/>` +
      `<path class="brow-r" d="M68,44 L78,46.5" stroke="#8d8271" stroke-width="2.4" stroke-linecap="round" fill="none"/>` +
      eyes(47.5, 72.5, 55.5, 2.4) +
      `<g fill="none" stroke="${INK}" stroke-width="1.4">` +
      `<circle cx="47.5" cy="55.5" r="7.4"/><circle cx="72.5" cy="55.5" r="7.4"/>` +
      `<path d="M54.9,55.5 Q60,53.6 65.1,55.5"/></g>` +
      `<path d="M60,57 C59.4,60.5 58.2,63 58.6,64.5 Q60,66 62,65.2" fill="none" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/>` +
      `<path d="M50.5,71 Q60,64.5 69.5,71 Q60,73.5 50.5,71 Z" fill="#b9ad97" stroke="${INK}" stroke-width="1"/>` +
      `<path class="mouth" d="M54,75.5 Q60,78 66,75.5" fill="none" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/>`,
    willem: () =>
      ears(40, 80, 54) +
      `<path d="M40,51 C40,34 49,27 60,27 C71,27 80,34 80,51 C80,65 72,77 60,77 C48,77 40,65 40,51 Z" fill="${SKIN}" stroke="${INK}" stroke-width="1.5"/>` +
      `<path d="M40,48 C40,74 46,86 60,86 C74,86 80,74 80,48 L80,54 C78,66 72,72 60,72 C48,72 42,66 40,54 Z" fill="#6b4423" stroke="${INK}" stroke-width="1.2"/>` +
      `<g fill="#6b4423" stroke="${INK}" stroke-width="1.1">` +
      `<circle cx="42" cy="43" r="6.5"/><circle cx="48" cy="35" r="6.5"/><circle cx="56" cy="31" r="6.5"/>` +
      `<circle cx="65" cy="31" r="6.5"/><circle cx="73" cy="35" r="6.5"/><circle cx="78" cy="43" r="6.5"/></g>` +
      `<path class="brow-l" d="M43,47.5 L53,46" stroke="#4c3018" stroke-width="2.6" stroke-linecap="round" fill="none"/>` +
      `<path class="brow-r" d="M67,46 L77,47.5" stroke="#4c3018" stroke-width="2.6" stroke-linecap="round" fill="none"/>` +
      eyes(48.5, 71.5, 54, 2.5) +
      `<circle cx="43.5" cy="60.5" r="3.8" fill="#e0a8a0" opacity=".55"/>` +
      `<circle cx="76.5" cy="60.5" r="3.8" fill="#e0a8a0" opacity=".55"/>` +
      `<path d="M60,56 C59.2,59.5 58.2,61.5 58.6,63 Q60,64.8 62.2,63.8" fill="none" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/>` +
      `<g class="mouth"><path d="M52,67.5 Q60,72.5 68,67.5" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/>` +
      `<path d="M56,70.9 Q60,72.6 64,70.9" fill="none" stroke="${INK}" stroke-width="1" stroke-linecap="round" opacity=".55"/></g>`,
    daan: () =>
      ears(42, 78, 55) +
      `<path d="M42,50 C42,33 50,27 60,27 C70,27 78,33 78,50 C78,66 70,79 60,79 C50,79 42,66 42,50 Z" fill="${SKIN}" stroke="${INK}" stroke-width="1.5"/>` +
      `<path class="hair" d="M41,52 C39,33 48,24 58,24 C64,19 74,19 81,16 C83,24 80,29 77,32 C80,37 79,46 78,52 C76,38 70,32 60,32 C50,32 43,40 41,52 Z" fill="#bd9455" stroke="${INK}" stroke-width="1.3"/>` +
      `<path class="brow-l" d="M43,48 L53,47.5" stroke="#8a6b3c" stroke-width="2.4" stroke-linecap="round" fill="none"/>` +
      `<path class="brow-r" d="M67,43.5 L77,46.5" stroke="#8a6b3c" stroke-width="2.4" stroke-linecap="round" fill="none"/>` +
      eyes(48, 72, 54.5, 2.4) +
      `<path d="M60,56 C59.3,59.5 58.2,62 58.6,63.5 Q60,65 62,64.2" fill="none" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/>` +
      `<g fill="#a08454" opacity=".7">` +
      '<circle cx="46.5" cy="64" r=".9"/><circle cx="49" cy="69" r=".9"/><circle cx="52.5" cy="73.5" r=".9"/>' +
      '<circle cx="57" cy="76.5" r=".9"/><circle cx="63" cy="76.5" r=".9"/><circle cx="67.5" cy="73.5" r=".9"/>' +
      '<circle cx="71" cy="69" r=".9"/><circle cx="73.5" cy="64" r=".9"/><circle cx="50.5" cy="65.5" r=".9"/>' +
      '<circle cx="55" cy="70" r=".9"/><circle cx="65" cy="70" r=".9"/><circle cx="69.5" cy="65.5" r=".9"/></g>' +
      `<g class="mouth"><path d="M52,72 Q59,75 68,70.5" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round"/>` +
      `<path d="M68,70.5 L70.2,69" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/></g>`,
  };

  const CITY_GUIDE = { paris: 'julien', bruges: 'willem', amsterdam: 'daan' };
  const GUIDE_STYLE = {
    julien: { accent: '#7c2438', soft: '#f1dee2', label: 'JULIEN · PARIS' },
    willem: { accent: '#7a4522', soft: '#f2e3d3', label: 'WILLEM · BRUGGE' },
    daan: { accent: '#24517e', soft: '#dfe7ee', label: 'DAAN · AMSTERDAM' },
  };

  let faceN = 0;
  function face(city, { label = true } = {}) {
    const guide = CITY_GUIDE[city];
    if (!guide) return '';
    const s = GUIDE_STYLE[guide];
    const uid = 'f' + (++faceN);
    const arc = label
      ? `<path id="arc-${uid}" d="M16.8,75.7 A46,46 0 0 0 103.2,75.7" fill="none"/>` +
        `<use href="#arc-${uid}" stroke="${s.accent}" stroke-width="13" opacity=".92"/>` +
        `<text font-family="Fraunces, Georgia, serif" font-weight="600" font-size="8" letter-spacing="1.3" fill="#f6efe3">` +
        `<textPath href="#arc-${uid}" startOffset="50%" text-anchor="middle">${s.label}</textPath></text>`
      : '';
    return `<svg class="face" data-guide="${guide}" viewBox="0 0 120 120" aria-hidden="true">` +
      `<defs><clipPath id="fc-${uid}"><circle cx="60" cy="60" r="56"/></clipPath></defs>` +
      `<circle cx="60" cy="60" r="58" fill="${s.soft}"/>` +
      `<g clip-path="url(#fc-${uid})">${BODIES[guide](s.accent)}<g class="head">${HEADS[guide]()}</g></g>` +
      arc +
      `<circle cx="60" cy="60" r="57.2" fill="none" stroke="${s.accent}" stroke-width="2.6"/>` +
      `<circle cx="60" cy="60" r="52.5" fill="none" stroke="${s.accent}" stroke-width="1" stroke-dasharray="2 4"/>` +
      `</svg>`;
  }

  return {
    skyline: city => SKYLINES[city] || '',
    landmark: city => LANDMARKS[city] || '',
    face,
  };
})();
