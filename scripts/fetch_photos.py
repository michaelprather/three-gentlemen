#!/usr/bin/env python3
"""Fetch an openly licensed identification photo for each POI from Wikimedia.

Resolution order per POI:
  1. Wikipedia link in the data file -> that article's lead image (pageimage)
  2. No wiki link -> en-wiki article of the same name, accepted only when the
     article's coordinates fall within 400 m of the POI
  3. Commons geosearch within 120 m of the POI
Lead images that are maps, logos, flags, coats of arms, or SVGs are rejected.
Only files hosted on Commons (i.e. freely licensed) are used.

Writes photos/<city>/<poi-id>.jpg (640 px wide, recompressed via sips),
adds {"photo": {"src", "credit", "license"}} to each POI in data/*.json,
and a per-POI outcome report to the path given as argv[1] (default
photo_report.json next to this script).
"""
import html
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITIES = ["paris", "bruges", "amsterdam"]
UA = {"User-Agent": "ThreeGentlemenGuide/1.0 (personal offline trip app; contact: michaelprather on GitHub)"}
BAD_FILE = re.compile(
    r"(?i)(\bmap\b|locator|logo|coat[_ ]of[_ ]arms|blason|wapen[_ ]?van|escudo|"
    r"\bflag\b|\bseal\b|diagram|pictogram|icon\b|banner|\.svg$|\.gif$)")

def fetch_url(url, timeout=30):
    """GET with retry/backoff on 429 and 5xx."""
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503) or attempt == 4:
                raise
            wait = int(e.headers.get("Retry-After") or 0) or (5 * 2 ** attempt)
            time.sleep(min(wait, 120))
    raise RuntimeError("unreachable")

def api(host, params):
    params = dict(params, format="json", formatversion="2")
    url = f"https://{host}/w/api.php?" + urllib.parse.urlencode(params)
    return json.loads(fetch_url(url))

def wiki_title_from_link(link):
    m = re.match(r"https?://([a-z\-]+)\.(?:m\.)?wikipedia\.org/wiki/([^#?]+)", link or "")
    if not m:
        return None, None
    return m.group(1), urllib.parse.unquote(m.group(2))

def lead_image(lang, title):
    """Return (filename, page coords) for an article's lead image."""
    d = api(f"{lang}.wikipedia.org", {
        "action": "query", "titles": title, "redirects": 1,
        "prop": "pageimages|coordinates", "piprop": "name"})
    pages = d.get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing"):
        return None, None
    p = pages[0]
    coord = None
    if p.get("coordinates"):
        coord = (p["coordinates"][0]["lat"], p["coordinates"][0]["lon"])
    return p.get("pageimage"), coord

def geosearch_commons(lat, lng, radius=120):
    d = api("commons.wikimedia.org", {
        "action": "query", "list": "geosearch", "gsnamespace": 6,
        "gscoord": f"{lat}|{lng}", "gsradius": radius, "gslimit": 20})
    for hit in d.get("query", {}).get("geosearch", []):
        name = hit["title"].replace("File:", "")
        if name.lower().endswith((".jpg", ".jpeg")) and not BAD_FILE.search(name):
            return name
    return None

def commons_info(filename, width=640):
    """thumburl + credit + license for a Commons-hosted file, else None."""
    d = api("commons.wikimedia.org", {
        "action": "query", "titles": f"File:{filename}",
        "prop": "imageinfo", "iiprop": "url|extmetadata", "iiurlwidth": width,
        "iiextmetadatafilter": "Artist|LicenseShortName"})
    pages = d.get("query", {}).get("pages", [])
    if not pages or pages[0].get("missing") or not pages[0].get("imageinfo"):
        return None  # not on Commons -> not freely licensed, skip
    ii = pages[0]["imageinfo"][0]
    meta = ii.get("extmetadata", {})
    credit = html.unescape(re.sub(r"<[^>]+>", "", meta.get("Artist", {}).get("value", ""))).strip()
    credit = re.sub(r"\s+", " ", credit)[:80] or "Wikimedia Commons"
    lic = meta.get("LicenseShortName", {}).get("value", "").strip()
    if not lic or "fair use" in lic.lower() or "non-free" in lic.lower():
        return None
    return {"thumburl": ii.get("thumburl") or ii["url"], "credit": credit, "license": lic}

def dist_m(a, b):
    import math
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = (math.sin((la2 - la1) / 2) ** 2
         + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2)
    return 2 * 6371000 * math.asin(math.sqrt(h))

def resolve(poi):
    """Return (filename, how) or (None, reason)."""
    lang, title = wiki_title_from_link(poi.get("link"))
    if title:
        name, _ = lead_image(lang, title)
        if name and not BAD_FILE.search(name):
            return name, f"wiki:{lang}:{title}"
        # bad or missing lead image -> geosearch fallback
        gs = geosearch_commons(poi["lat"], poi["lng"])
        if gs:
            return gs, "geosearch(after bad lead)"
        return None, f"no usable lead image ({name or 'none'})"
    # no wikipedia link: try article of the same name, coordinate-validated
    name, coord = lead_image("en", poi["name"])
    if name and coord and dist_m(coord, (poi["lat"], poi["lng"])) < 400 \
            and not BAD_FILE.search(name):
        return name, "wiki:en:name-match"
    gs = geosearch_commons(poi["lat"], poi["lng"])
    if gs:
        return gs, "geosearch"
    return None, "nothing nearby on Commons"

def fetch_thumb(url, dest):
    tmp = dest.with_suffix(".tmp")
    tmp.write_bytes(fetch_url(url, timeout=60))
    subprocess.run(
        ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "72",
         "--resampleWidth", "640", str(tmp), "--out", str(dest)],
        check=True, capture_output=True)
    tmp.unlink()

def main():
    report = {}
    for city in CITIES:
        path = ROOT / "data" / f"{city}.json"
        data = json.loads(path.read_text())
        outdir = ROOT / "photos" / city
        outdir.mkdir(parents=True, exist_ok=True)
        for poi in data["pois"]:
            pid = poi["id"]
            dest = outdir / f"{pid}.jpg"
            if poi.get("photo") and dest.exists():
                report[f"{city}/{pid}"] = "kept existing"
                continue
            try:
                filename, how = resolve(poi)
                if not filename:
                    report[f"{city}/{pid}"] = f"SKIP: {how}"
                    print(f"  – {city}/{pid}: {how}")
                    continue
                info = commons_info(filename)
                if not info:
                    report[f"{city}/{pid}"] = f"SKIP: not on Commons ({filename})"
                    print(f"  – {city}/{pid}: not freely licensed ({filename})")
                    continue
                fetch_thumb(info["thumburl"], dest)
                poi["photo"] = {
                    "src": f"photos/{city}/{pid}.jpg",
                    "credit": info["credit"],
                    "license": info["license"],
                }
                report[f"{city}/{pid}"] = f"OK via {how}: {filename}"
                print(f"  ✓ {city}/{pid} ({info['license']})")
            except Exception as e:  # noqa: BLE001 — record and move on
                report[f"{city}/{pid}"] = f"ERROR: {e}"
                print(f"  ! {city}/{pid}: {e}")
            time.sleep(1.0)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        print(f"{city}: wrote {path.name}")
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "scripts" / "photo_report.json"
    out.write_text(json.dumps(report, indent=2))
    ok = sum(1 for v in report.values() if v.startswith(("OK", "kept")))
    print(f"\n{ok}/{len(report)} POIs have photos. Report: {out}")

if __name__ == "__main__":
    main()
