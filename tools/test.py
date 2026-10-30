#!/usr/bin/env python3
"""Baut die App, prüft sie statisch und führt alle Browser-Tests in Chrome (headless) aus.
Der Testserver kann das Netz „abschalten“, um den Offlinebetrieb echt zu prüfen."""
import json, mimetypes, pathlib, re, shutil, subprocess, sys, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build

ROOT = build.ROOT
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
MIME = {".js": "text/javascript", ".webmanifest": "application/manifest+json", ".css": "text/css", ".html": "text/html; charset=utf-8", ".png": "image/png"}
state = {"offline": False, "results": None}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path == "/__result":
            state["results"] = json.loads(body)
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path == "/__offline":
            state["offline"] = True
        elif self.path == "/__online":
            state["offline"] = False
        elif state["offline"]:
            self.close_connection = True  # keine Antwort = Netzwerkfehler im Browser
            self.connection.close()
            return
        else:
            return self.serve_file()
        self.send_response(204)
        self.end_headers()

    def serve_file(self):
        path = self.path.split("?")[0]
        base, rel = (ROOT / "dist", path[5:]) if path.startswith("/app/") else (ROOT / "tests", path[7:]) if path.startswith("/tests/") else (None, "")
        f = (base / (rel or "index.html")).resolve() if base else None
        if not f or not f.is_file() or base.resolve() not in f.parents:
            self.send_response(404)
            self.end_headers()
            return
        data = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(f.suffix, mimetypes.guess_type(f.name)[0] or "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


def static_checks():
    dist = ROOT / "dist"
    problems = []
    manifest = json.loads((dist / "manifest.webmanifest").read_text())
    for icon in manifest["icons"]:
        if not (dist / icon["src"]).is_file():
            problems.append(f"Manifest-Icon fehlt: {icon['src']}")
    for need in ["index.html", "sw.js", "icons/apple-touch-icon.png", "styles.css"]:
        if not (dist / need).is_file():
            problems.append(f"Datei fehlt im Build: {need}")
    sw = (dist / "sw.js").read_text()
    precache = json.loads(re.search(r"const PRECACHE = (\[[\s\S]*?\]);", sw).group(1))
    on_disk = {"./" + p.relative_to(dist).as_posix() for p in dist.rglob("*") if p.is_file() and p.name != "sw.js"}
    if set(precache) - {"./"} != on_disk:
        problems.append(f"Precache-Liste stimmt nicht mit dist/ überein: {set(precache) ^ on_disk}")
    html = (dist / "index.html").read_text()
    for must in ["viewport-fit=cover", "apple-mobile-web-app-capable", 'rel="apple-touch-icon"', 'rel="manifest"']:
        if must not in html:
            problems.append(f"index.html: {must} fehlt")
    for p in list((ROOT / "src").rglob("*.js")) + [ROOT / "src/index.html"]:
        if re.search(r"https?://(?!www\.w3\.org)", p.read_text()):
            problems.append(f"Externe URL in {p.name} – App muss ohne Netz auskommen")
    return problems


def main():
    build.build()
    problems = static_checks()
    report = [f"Statische Prüfung: {'OK' if not problems else 'FEHLER'}"] + [f"  - {p}" for p in problems]

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    profile = tempfile.mkdtemp(prefix="mathe-chrome-")
    chrome = subprocess.Popen(
        [CHROME, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", f"--user-data-dir={profile}", "--window-size=500,900", f"http://localhost:{port}/tests/tests.html"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    t0 = time.time()
    while state["results"] is None and time.time() - t0 < 180 and chrome.poll() is None:
        time.sleep(0.5)
    chrome.terminate()
    shutil.rmtree(profile, ignore_errors=True)
    server.shutdown()

    results = state["results"]
    if results is None:
        report.append("FEHLER: Browser lieferte keine Testergebnisse.")
        failed = 1
    else:
        failed = sum(1 for r in results if not r["ok"])
        for r in results:
            report.append(f"{'OK  ' if r['ok'] else 'FAIL'} {r['name']}" + ("" if r["ok"] else f"\n       {r['error']}"))
        report.append(f"\n{len(results) - failed} von {len(results)} Tests bestanden ({time.time() - t0:.1f} s)")
    text = "\n".join(report)
    print(text)
    (ROOT / "test-results").mkdir(exist_ok=True)
    (ROOT / "test-results" / "latest.txt").write_text(text + "\n")
    sys.exit(1 if failed or problems else 0)


if __name__ == "__main__":
    main()
