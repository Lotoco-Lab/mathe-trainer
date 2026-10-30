#!/usr/bin/env python3
"""HTTPS-Testserver fürs iPhone (nur lokales Netz, nur lesend, nur dist/).
  https://<Mac>.local:8443/   die App
  http://<Mac>.local:8080/    nur Startseite + Download der Test-CA (ca.crt)
Beenden mit Strg+C. Es wird nichts im Netzwerk veröffentlicht oder verändert."""
import argparse, pathlib, socket, ssl, subprocess, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST, CERTS = ROOT / "dist", ROOT / "certs"
MIME = {".js": "text/javascript", ".webmanifest": "application/manifest+json", ".css": "text/css", ".html": "text/html; charset=utf-8", ".png": "image/png"}


def lan_info():
    host = subprocess.run(["scutil", "--get", "LocalHostName"], capture_output=True, text=True).stdout.strip() or socket.gethostname().split(".")[0]
    ips = [i for i in (subprocess.run(["ipconfig", "getifaddr", f"en{n}"], capture_output=True, text=True).stdout.strip() for n in range(5)) if i]
    return f"{host}.local", ips


class AppHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        sys.stderr.write(f"[https] {self.address_string()} {fmt % args}\n")

    def do_GET(self):
        path = self.path.split("?")[0]
        f = (DIST / (path.lstrip("/") or "index.html")).resolve()
        if f.is_dir():
            f = f / "index.html"
        if not f.is_file() or DIST.resolve() not in f.parents:
            self.send_error(404)
            return
        data = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(f.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


class CaHandler(BaseHTTPRequestHandler):
    host = ""

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[http ] {self.address_string()} {fmt % args}\n")

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/ca.crt":
            data, ctype = (CERTS / "ca.crt").read_bytes(), "application/x-x509-ca-cert"
        elif path == "/":
            page = (f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
                    f"<body style='font:20px -apple-system,sans-serif;padding:24px'><h1>Mathe-Trainer</h1>"
                    f"<p>1. <a href='/ca.crt'>Test-Zertifikat laden</a> und installieren (siehe Anleitung).</p>"
                    f"<p>2. Danach die App öffnen: <a href='https://{self.host}:8443/'>https://{self.host}:8443/</a></p></body>")
            data, ctype = page.encode(), "text/html; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8443)
    ap.add_argument("--ca-port", type=int, default=8080)
    ap.add_argument("--bind", default="0.0.0.0")
    a = ap.parse_args()
    if not (CERTS / "server.crt").is_file():
        sys.exit("Zertifikate fehlen – zuerst ./tools/make-certs.sh ausführen.")
    if not (DIST / "index.html").is_file():
        sys.exit("dist/ fehlt – zuerst python3 tools/build.py ausführen.")
    host, ips = lan_info()
    CaHandler.host = host
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.load_cert_chain(CERTS / "server.crt", CERTS / "server.key")
    https = ThreadingHTTPServer((a.bind, a.port), AppHandler)
    https.socket = ctx.wrap_socket(https.socket, server_side=True)
    http = ThreadingHTTPServer((a.bind, a.ca_port), CaHandler)
    threading.Thread(target=http.serve_forever, daemon=True).start()
    print(f"App:         https://{host}:{a.port}/   (oder https://{ips[0] if ips else '<IP>'}:{a.port}/)")
    print(f"Zertifikat:  http://{host}:{a.ca_port}/   (nur ca.crt-Download)")
    print("Strg+C beendet den Server.")
    try:
        https.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet.")


if __name__ == "__main__":
    main()
