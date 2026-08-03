# Dear Madame,

A one-trip, offline-first personal tour guide PWA. Three cities, three charming
local guides — Julien (Paris), Willem (Bruges), Daan (Amsterdam) — each with an
animated hand-drawn portrait, his country's own colours, and letters narrating
history, oddities, and food wisdom for whatever you wander past.

- Open the site once on wifi, **Add to Home Screen** (Safari share menu), and
  let the "Preparing offline maps" bar finish. After that it works fully
  offline, including in airplane mode (GPS still works without cell data).
- First launch opens the **splash** — the envelope introducing the three
  gentlemen. Tap the "Dear Madame," wordmark to see it again.
- Views: **Guide** (his letter + everything worth seeing, with category
  filters), **Days** (the trip, day by day, today's card flagged),
  **Country** (his homeland: phrases, tourist FAQs, and a reshuffling deck of
  odd facts — the tab wears the country's flag and name), **Near me** (sorted
  by distance from you, filterable), **Map** (offline street maps, pins, blue
  dot, and a Key for the pin glyphs).
- Each city wears its country: bordeaux ink, gilt rules and fleurons for
  France; chocolate, Belgian gold and scalloped edges for Belgium; Delft blue,
  Dutch orange and De Stijl bars for the Netherlands. City skylines rise
  behind each guide's portrait; flag ribbons run through the chrome.
- He'll gently interrupt when you walk within ~130 m of something good.
  Toggle that off at the bottom of the Guide tab.

Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
POI photos via [Wikimedia Commons](https://commons.wikimedia.org), individually
credited on each card and in `photos/credits.json`.
Built with Leaflet. Fonts: Fraunces & Literata (OFL). All artwork (portraits,
skylines, icons) is inline SVG in `js/art.js` and `index.html` — no external
assets, so the whole personality survives airplane mode.
