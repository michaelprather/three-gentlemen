#!/usr/bin/env python3
"""Python port of build_pack.mjs for machines without Node.
Regenerates precache-manifest.js and tiles-index.json; keep both scripts in sync."""
import hashlib
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent

def walk(d):
    return sorted(p for p in d.rglob("*") if p.is_file())

tiles = [str(p.relative_to(ROOT)) for p in walk(ROOT / "tiles") if p.suffix == ".png"]
(ROOT / "tiles-index.json").write_text(json.dumps({"tiles": tiles}, separators=(",", ":")))

SHELL_DIRS = ["css", "fonts", "icons", "js", "data", "photos"]
shell = ["index.html", "manifest.webmanifest", "tiles-index.json"]
for d in SHELL_DIRS:
    for f in walk(ROOT / d):
        rel = str(f.relative_to(ROOT))
        if rel.endswith(".svg") and rel.startswith("icons/"):
            continue
        shell.append(rel)

h = hashlib.sha256()
for f in shell:
    try:
        h.update((ROOT / f).read_bytes())
    except OSError:
        pass
version = h.hexdigest()[:10]
(ROOT / "precache-manifest.js").write_text(
    f"self.__VERSION={json.dumps(version)};\nself.__PRECACHE={json.dumps(shell, separators=(',', ':'))};\n")
print(f"precache: {len(shell)} shell files, {len(tiles)} tiles, version {version}")
