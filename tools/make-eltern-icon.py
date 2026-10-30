#!/usr/bin/env python3
"""Erzeugt das Home-Bildschirm-Icon der Elternübersicht: SVG programmatisch, PNGs über Chrome (headless).
Einmalig ausführen, Ergebnis ist eingecheckt. Gleicher Blauton wie das Kinder-Icon, keine Schrift."""
import pathlib, shutil, subprocess, tempfile

OUT = pathlib.Path(__file__).resolve().parent.parent / "src" / "icons"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BLUE, YELLOW = "#1c6fd1", "#ffd43b"

SVG = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="{BLUE}"/>
  <circle cx="410" cy="100" r="26" fill="{YELLOW}"/>
  <g fill="#fff">
    <circle cx="176" cy="168" r="44"/>
    <path d="M104 392V318A72 72 0 0 1 248 318V392Z"/>
    <circle cx="336" cy="168" r="44"/>
    <path d="M264 392V318A72 72 0 0 1 408 318V392Z"/>
  </g>
  <g fill="#fff" stroke="{BLUE}" stroke-width="12" stroke-linejoin="round">
    <circle cx="256" cy="262" r="34"/>
    <path d="M204 392V350A52 52 0 0 1 308 350V392Z"/>
  </g>
</svg>
"""

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "eltern-icon.svg").write_text(SVG)
for name, size in [("eltern-touch-icon.png", 180), ("eltern-icon-192.png", 192), ("eltern-icon-512.png", 512)]:
    with tempfile.TemporaryDirectory() as tmp:
        html = pathlib.Path(tmp) / "i.html"
        html.write_text(f"<!doctype html><style>html,body{{margin:0;background:{BLUE}}}svg{{display:block;width:{size}px;height:{size}px}}</style>{SVG}")
        png = pathlib.Path(tmp) / "o.png"
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={tmp}/p", f"--window-size={size},{size}",
                        f"--screenshot={png}", f"file://{html}"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.copy(png, OUT / name)
    print("geschrieben:", name, size)
