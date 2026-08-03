#!/usr/bin/env python3
"""Re-apply photo fields to data/*.json from photos/credits.json + files on disk.

Safe to run any time (idempotent, no network). Use after any edit that may have
dropped "photo" fields from the data files. With --snapshot, does the reverse:
collects current photo fields into photos/credits.json.
"""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CITIES = ["paris", "bruges", "amsterdam"]
CREDITS = ROOT / "photos" / "credits.json"

def snapshot():
    credits = {}
    for city in CITIES:
        data = json.loads((ROOT / "data" / f"{city}.json").read_text())
        for poi in data["pois"]:
            if poi.get("photo"):
                credits[poi["photo"]["src"]] = {
                    "credit": poi["photo"]["credit"], "license": poi["photo"]["license"]}
    CREDITS.write_text(json.dumps(credits, ensure_ascii=False, indent=2) + "\n")
    print(f"snapshot: {len(credits)} credits -> {CREDITS}")

def apply():
    credits = json.loads(CREDITS.read_text())
    for city in CITIES:
        path = ROOT / "data" / f"{city}.json"
        data = json.loads(path.read_text())
        added = 0
        for poi in data["pois"]:
            src = f"photos/{city}/{poi['id']}.jpg"
            if not poi.get("photo") and src in credits and (ROOT / src).exists():
                poi["photo"] = {"src": src, **credits[src]}
                added += 1
        if added:
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        print(f"{city}: re-applied {added} photo fields")

if __name__ == "__main__":
    snapshot() if "--snapshot" in sys.argv else apply()
