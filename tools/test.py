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
state = {"offline": False, "results": None, "swbuild": None}
TEST_CONFIG = "export const CONFIG = { supabaseUrl: '/sb', anonKey: 'test-anon-key' };\n"


class FakeSupabase:
    """Bildet die Regeln von supabase/schema.sql nach (Kopplung, Idempotenz, Zugriffsschutz), damit
    Sync-Client und Elternansicht ohne Cloud-Projekt gegen echtes HTTP getestet werden können."""
    ANON = "test-anon-key"
    PUBLISHABLE = "sb_publishable_testkey"
    USERS = {"eltern@test.de": ("geheim123", "u1"), "andere@test.de": ("pw-other", "u2")}
    ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    def __init__(self):
        self.lock = threading.Lock()
        self.reset()

    def reset(self):
        self.devices, self.codes, self.sessions, self.attempts = {}, {}, {}, []
        self.pushes = 0
        self.fail = 0

    def dump(self):
        return {"sessions": [{"device": k[0], "id": k[1], "rev": v["rev"], "owner": v["owner"], "data": v["data"]} for k, v in self.sessions.items()],
                "devices": len(self.devices), "revoked": sum(1 for d in self.devices.values() if d["revoked"]), "pushes": self.pushes}

    def handle(self, method, path, headers, body):
        import secrets, hashlib, urllib.parse as up
        with self.lock:
            u = up.urlparse(path)
            route = u.path[len("/sb"):]
            key = headers.get("apikey")
            if key not in (self.ANON, self.PUBLISHABLE):
                return 401, {"message": "No API key found in request"}
            bearer = (headers.get("Authorization") or "").replace("Bearer ", "")
            user = {"jwt-u1": "u1", "jwt-u2": "u2"}.get(bearer)
            if bearer and bearer != self.ANON and not user:
                return 401, {"message": "invalid JWT"}  # u. a. ein sb_publishable_-Schlüssel als Bearer
            try:
                req = json.loads(body) if body else {}
            except ValueError:
                return 400, {"message": "bad json"}
            if route == "/auth/v1/token":
                pw = self.USERS.get(req.get("email"))
                if not pw or pw[0] != req.get("password"):
                    return 400, {"error_description": "Invalid login credentials"}
                return 200, {"access_token": "jwt-" + pw[1], "user": {"id": pw[1]}}
            if method == "GET" and route == "/rest/v1/sessions":
                if not user:
                    return 401, {"message": "permission denied for table sessions"}
                rows = [{"id": k[1], "device_id": k[0], "rev": v["rev"], "data": v["data"], "updated_at": v["updated"]} for k, v in self.sessions.items() if v["owner"] == user]
                return 200, sorted(rows, key=lambda r: r["updated_at"], reverse=True)
            if method == "GET" and route == "/rest/v1/devices":
                if "token_hash" in u.query:
                    return 401, {"code": "42501", "message": "permission denied for table devices"}  # Spaltenrechte
                if not user:
                    return 401, {"message": "permission denied for table devices"}
                return 200, [{"id": k, "label": d["label"], "created_at": d["created"], "last_seen": d["seen"], "revoked_at": "x" if d["revoked"] else None} for k, d in self.devices.items() if d["owner"] == user]
            if method == "POST" and route.startswith("/rest/v1/rpc/"):
                return self.rpc(route.rsplit("/", 1)[1], req, user, secrets, hashlib)
            return 404, {"message": "not found"}

    def rpc(self, fn, a, user, secrets, hashlib):
        now = time.time()
        iso = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
        h = lambda t: hashlib.sha256(t.encode()).hexdigest()
        if fn == "create_pairing_code":
            if not user:
                return 401, {"code": "PT401", "message": "permission denied for function create_pairing_code"}
            if sum(1 for c in self.codes.values() if c["owner"] == user and not c["used"] and c["exp"] > now) >= 5:
                return 429, {"code": "PT429", "message": "too_many_codes"}
            code = "".join(self.ALPHA[b % 32] for b in secrets.token_bytes(8))
            self.codes[h(code)] = {"owner": user, "exp": now + 600, "used": False}
            return 200, code
        if fn == "redeem_pairing_code":
            self.attempts = [t for t in self.attempts if t > now - 600]
            if len(self.attempts) >= 20:
                return 429, {"code": "PT429", "message": "too_many_attempts"}
            c = self.codes.get(h(str(a.get("p_code", "")).upper()))
            if not c or c["used"] or c["exp"] <= now:
                self.attempts.append(now)
                return 400, {"code": "PT400", "message": "invalid_code"}
            c["used"] = True
            token, dev = secrets.token_hex(32), secrets.token_hex(8)
            self.devices[dev] = {"owner": c["owner"], "label": str(a.get("p_label") or "Kind-Gerät")[:40], "hash": h(token), "created": iso, "seen": None, "revoked": False}
            return 200, {"token": token, "device_id": dev}
        if fn == "sync_push":
            self.pushes += 1
            dev = next(((k, d) for k, d in self.devices.items() if d["hash"] == h(str(a.get("p_token") or "")) and not d["revoked"]), None)
            if not dev:
                return 401, {"code": "PT401", "message": "invalid_token"}
            items = a.get("p_sessions")
            if not isinstance(items, list) or len(items) > 20:
                return 400, {"code": "PT400", "message": "bad_request"}
            acked = []
            for it in items:
                try:
                    __import__("uuid").UUID(str(it.get("id")))
                except ValueError:
                    return 400, {"code": "PT400", "message": "bad_request"}
                if not isinstance(it, dict) or not isinstance(it.get("rev"), int) or it["rev"] < 0:
                    return 400, {"code": "PT400", "message": "bad_request"}
                key = (dev[0], it["id"])
                cur = self.sessions.get(key)
                if cur is None or cur["rev"] < it["rev"]:
                    self.sessions[key] = {"owner": dev[1]["owner"], "rev": it["rev"], "data": it, "updated": iso + "%06d" % len(self.sessions)}
                acked.append({"id": it["id"], "rev": self.sessions[key]["rev"]})
            dev[1]["seen"] = iso
            return 200, {"acked": acked}
        if not user:
            return 401, {"code": "PT401", "message": "permission denied for function " + fn}
        if fn == "revoke_device":
            d = self.devices.get(a.get("p_id"))
            if d and d["owner"] == user:
                d["revoked"] = True
            return 204, None
        if fn == "delete_all_data":
            self.sessions = {k: v for k, v in self.sessions.items() if v["owner"] != user}
            self.codes = {k: v for k, v in self.codes.items() if v["owner"] != user}
            for d in self.devices.values():
                if d["owner"] == user:
                    d["revoked"] = True
            return 204, None
        return 404, {"message": "unknown function"}


sb = FakeSupabase()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def drop(self):
        self.close_connection = True  # keine Antwort = Netzwerkfehler im Browser
        self.connection.close()

    def reply_json(self, status, payload):
        data = b"" if payload is None else json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        if self.path == "/__result":
            state["results"] = json.loads(body)
            self.send_response(204)
            self.end_headers()
        elif self.path.startswith("/sb/"):
            self.sb(body)
        else:
            self.send_error(404)

    def sb(self, body=b""):
        if state["offline"]:
            return self.drop()
        if sb.fail > 0:
            sb.fail -= 1
            return self.drop()
        status, payload = sb.handle(self.command, self.path, self.headers, body)
        self.reply_json(status, payload)

    def do_GET(self):
        path, _, query = self.path.partition("?")
        if path == "/__offline":
            state["offline"] = True
        elif path == "/__online":
            state["offline"] = False
        elif state["offline"]:
            return self.drop()
        elif path == "/__sbreset":
            sb.reset()
        elif path == "/__sbfail":
            sb.fail = int(query.split("=")[1])
        elif path == "/__sbstate":
            return self.reply_json(200, sb.dump())
        elif path == "/__sbexpire":
            for c in sb.codes.values():
                c["exp"] = 0
        elif path == "/__swbuild":
            state["swbuild"] = query.split("=")[1] or None
        elif path.startswith("/sb/"):
            return self.sb()
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
        if path == "/app/js/config.js":  # Testaufbau: Verbindung zum Fake-Dienst
            data = TEST_CONFIG.encode()
        elif path == "/app/sw.js" and state["swbuild"]:  # simuliert eine neue App-Version
            data = re.sub(rb"const BUILD = '\w+'", b"const BUILD = '" + state["swbuild"].encode() + b"'", data)
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
    import base64
    for p in list((ROOT / "src").rglob("*")) + list((ROOT / "supabase").rglob("*")) + [ROOT / "CLAUDE.md"]:
        if not p.is_file() or p.suffix == ".png":
            continue
        txt = p.read_text()
        if re.search(r"sb_secret_|service_role\s*[:=]\s*['\"]", txt) and p.suffix in (".js", ".html"):
            problems.append(f"Geheimer Schlüssel im Client-Code: {p.name}")
        for tok in re.findall(r"eyJ[\w-]+\.([\w-]+)\.[\w-]+", txt):
            payload = json.loads(base64.urlsafe_b64decode(tok + "=" * (-len(tok) % 4)))
            if payload.get("role") != "anon":
                problems.append(f"JWT mit Rolle {payload.get('role')} in {p.name} – nur anon-Schlüssel erlaubt")
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
    while state["results"] is None and time.time() - t0 < 300 and chrome.poll() is None:
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
