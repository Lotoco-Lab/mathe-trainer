#!/usr/bin/env python3
"""Produktionsbuild: src/ -> dist/. Setzt Build-ID und Precache-Liste in den Service Worker ein."""
import hashlib, json, pathlib, re, shutil, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC, DIST = ROOT / "src", ROOT / "dist"


def build():
    if DIST.exists():
        shutil.rmtree(DIST)
    shutil.copytree(SRC, DIST, ignore=shutil.ignore_patterns(".DS_Store"))

    files = sorted(p for p in SRC.rglob("*") if p.is_file() and p.name != ".DS_Store")
    digest = hashlib.sha256()
    for p in files:
        digest.update(p.relative_to(SRC).as_posix().encode())
        digest.update(p.read_bytes())
    build_id = digest.hexdigest()[:10]

    precache = ["./"] + [f"./{p.relative_to(SRC).as_posix()}" for p in files if p.name != "sw.js"]

    sw = (DIST / "sw.js").read_text()
    sw, n1 = re.subn(r"const BUILD = 'dev';", f"const BUILD = '{build_id}';", sw)
    sw, n2 = re.subn(r"/\*__PRECACHE__\*/ \[\]", json.dumps(precache, indent=2), sw)
    ver = (DIST / "js" / "version.js").read_text()
    ver, n3 = re.subn(r"'dev'", f"'{build_id}'", ver)
    if (n1, n2, n3) != (1, 1, 1):
        sys.exit(f"Build fehlgeschlagen: Platzhalter nicht gefunden {(n1, n2, n3)}")
    (DIST / "sw.js").write_text(sw)
    (DIST / "js" / "version.js").write_text(ver)

    # Jede in index.html referenzierte lokale Datei muss im Precache stehen.
    html = (DIST / "index.html").read_text()
    for ref in re.findall(r'(?:href|src)="([^"#]+)"', html):
        if not ref.startswith(("http", "data:")) and f"./{ref}" not in precache:
            sys.exit(f"Build fehlgeschlagen: {ref} fehlt im Precache")

    total = sum(p.stat().st_size for p in DIST.rglob("*") if p.is_file())
    print(f"Build {build_id}: {len(precache) - 1} Dateien, {total / 1024:.0f} KB -> {DIST}")
    return build_id


if __name__ == "__main__":
    build()
