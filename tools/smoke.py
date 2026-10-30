#!/usr/bin/env python3
"""Smoke-Test gegen das ECHTE Supabase-Projekt (Zugriffsschutz, Kopplung, Sync, Export, Löschung).
Aufruf im Terminal:  python3 tools/smoke.py
 - URL und öffentlicher Schlüssel kommen aus src/js/config.js (oder MATHE_SUPABASE_URL / MATHE_SUPABASE_KEY).
 - E-Mail und Passwort des Eltern-Kontos werden verdeckt abgefragt und nirgends gespeichert oder ausgegeben.
 - ACHTUNG: Der letzte Schritt löscht ALLE Lerndaten dieses Eltern-Kontos und trennt alle Geräte.
   Deshalb nur VOR dem Echtbetrieb ausführen (oder mit --keep, dann entfällt Löschung/Aufräumen).
 --throttle prüft zusätzlich die Begrenzung der Fehlversuche (sperrt das Koppeln danach ca. 10 Minuten)."""
import getpass, json, os, pathlib, re, sys, urllib.error, urllib.request, uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
KEEP = "--keep" in sys.argv


def config():
    url, key = os.environ.get("MATHE_SUPABASE_URL"), os.environ.get("MATHE_SUPABASE_KEY")
    if not (url and key):
        txt = (ROOT / "src/js/config.js").read_text()
        url = re.search(r"supabaseUrl:\s*'([^']*)'", txt).group(1)
        key = re.search(r"anonKey:\s*'([^']*)'", txt).group(1)
    if not (url and key):
        sys.exit("Keine Verbindungsdaten: src/js/config.js ausfüllen oder MATHE_SUPABASE_URL/KEY setzen.")
    return url.rstrip("/"), key


URL, KEY = config()
results = []


def call(method, path, body=None, token=None, key=KEY):
    h = {"apikey": key, "Content-Type": "application/json"}
    bearer = token or (key if key.startswith("eyJ") else None)
    if bearer:
        h["Authorization"] = f"Bearer {bearer}"
    req = urllib.request.Request(URL + path, method=method, headers=h, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, raw.decode(errors="replace")[:200]


def check(name, ok, detail=""):
    ok = bool(ok)
    results.append(ok)
    print(("OK   " if ok else "FAIL ") + name + ("" if ok else f"  → {detail}"))


def denied(status, payload):  # gesperrt = Fehlerstatus oder leere Liste
    return status in (401, 403, 404) or status >= 400 or payload == []


def main():
    print(f"Projekt: {URL}\n")
    email = input("Eltern-E-Mail: ").strip()
    password = getpass.getpass("Eltern-Passwort (verdeckt): ")

    # --- Zugriffsschutz ohne Anmeldung ---
    for t in ("sessions", "devices", "pairing_codes", "pairing_attempts"):
        s, p = call("GET", f"/rest/v1/{t}?select=*&limit=1")
        check(f"anonym kann Tabelle {t} nicht lesen", denied(s, p) and not (isinstance(p, list) and p), (s, p))
    s, p = call("POST", "/rest/v1/sessions", {"device_id": str(uuid.uuid4()), "id": str(uuid.uuid4()), "owner_id": str(uuid.uuid4()), "rev": 1, "data": {}})
    check("anonym kann nicht direkt in sessions schreiben", s >= 400, (s, p))
    for fn in ("create_pairing_code", "delete_all_data"):
        s, p = call("POST", f"/rest/v1/rpc/{fn}", {})
        check(f"anonym darf {fn} nicht aufrufen", s in (401, 403), (s, p))
    s, p = call("POST", "/rest/v1/rpc/sync_push", {"p_token": "falsch", "p_sessions": []})
    check("falsches Geräte-Token wird abgelehnt (401)", s == 401, (s, p))
    s, p = call("POST", "/rest/v1/rpc/redeem_pairing_code", {"p_code": "AAAAAAAA", "p_label": "x"})
    check("falscher Kopplungscode wird abgelehnt", s == 200 and p == {"error": "invalid_code"}, (s, p))
    s, p = call("POST", "/auth/v1/signup", {"email": f"smoke-{uuid.uuid4().hex[:8]}@example.invalid", "password": uuid.uuid4().hex})
    check("Selbstregistrierung ist ausgeschaltet", s >= 400 and not (isinstance(p, dict) and p.get("access_token")), (s, str(p)[:120]))
    if isinstance(p, dict) and (p.get("id") or p.get("user")):
        print("      WARNUNG: Es wurde ein Konto angelegt! Registrierung im Dashboard ausschalten und das Konto löschen.")

    # --- Elternanmeldung ---
    s, p = call("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": password})
    check("Elternanmeldung mit Passwort", s == 200 and isinstance(p, dict) and "access_token" in p, s)
    if s != 200:
        print("Anmeldung fehlgeschlagen – Abbruch.")
        return 1
    tok = p["access_token"]
    s, p = call("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": password + "x"})
    check("falsches Passwort wird abgelehnt", s == 400, s)

    # --- Kopplung ---
    s, code = call("POST", "/rest/v1/rpc/create_pairing_code", {}, token=tok)
    check("Eltern erzeugen Kopplungscode", s == 200 and isinstance(code, str) and re.fullmatch(r"[A-HJ-NP-Z2-9]{8}", code), (s, code))
    s, dev = call("POST", "/rest/v1/rpc/redeem_pairing_code", {"p_code": code, "p_label": "Smoke-Test"})
    check("Kind-Gerät löst Code ein und erhält Token", s == 200 and isinstance(dev, dict) and len(dev.get("token", "")) >= 32, (s, "…"))
    token = dev["token"]
    s, p = call("POST", "/rest/v1/rpc/redeem_pairing_code", {"p_code": code, "p_label": "Zweitgerät"})
    check("Code ist nur einmal einlösbar", s == 200 and p == {"error": "invalid_code"}, (s, p))

    # --- Schreiben durch das Kind-Gerät ---
    sid = str(uuid.uuid4())
    rec = lambda rev, n: {"v": 1, "id": sid, "rev": rev, "start": "2026-10-30T10:00:00.000Z", "last": "2026-10-30T10:05:00.000Z", "end": None, "op": "add", "level": 1, "mode": "op", "total": 50, "processed": n, "firstOk": n, "secondOk": 0, "failed": 0, "helps": 0, "open": 50 - n, "status": "unterbrochen", "tasks": [{"q": "34 + 28", "a": 62, "g": [60, 62], "n": 2, "h": True, "ok": True, "p": "main", "rep": False, "t": "2026-10-30T10:01:00.000Z"}]}
    s, p = call("POST", "/rest/v1/rpc/sync_push", {"p_token": token, "p_sessions": [rec(1, 5)]})
    check("Kind-Gerät überträgt eine Einheit", s == 200 and p == {"acked": [{"id": sid, "rev": 1}]}, (s, p))
    s, p = call("POST", "/rest/v1/rpc/sync_push", {"p_token": token, "p_sessions": [rec(1, 5)]})
    check("Wiederholte Übertragung ist idempotent", s == 200 and p == {"acked": [{"id": sid, "rev": 1}]}, (s, p))
    s, p = call("POST", "/rest/v1/rpc/sync_push", {"p_token": token, "p_sessions": [rec(2, 9)]})
    check("Neuere Revision aktualisiert", s == 200 and p["acked"][0]["rev"] == 2, (s, p))
    s, p = call("POST", "/rest/v1/rpc/sync_push", {"p_token": token, "p_sessions": [rec(1, 1)]})
    check("Ältere Revision überschreibt nichts", s == 200 and p["acked"][0]["rev"] == 2, (s, p))
    s, p = call("POST", "/rest/v1/rpc/sync_push", {"p_token": token, "p_sessions": [{"id": "kein-uuid", "rev": 1}]})
    check("Ungültige Daten werden abgelehnt", s == 400, (s, p))
    s, p = call("GET", "/rest/v1/sessions?select=*", token=token)
    check("Geräte-Token kann nichts lesen", s in (401, 403), (s, p))

    # --- Lesen/Export durch Eltern, Trennung der Rollen ---
    s, rows = call("GET", "/rest/v1/sessions?select=id,device_id,rev,data,updated_at&order=updated_at.desc&limit=1000", token=tok)
    mine = [r for r in rows if r["id"] == sid] if isinstance(rows, list) else []
    check("Eltern lesen die übertragene Einheit (Export-Datenquelle)", s == 200 and len(mine) == 1 and mine[0]["rev"] == 2 and mine[0]["data"]["processed"] == 9, (s, str(rows)[:120]))
    s, p = call("GET", "/rest/v1/devices?select=token_hash", token=tok)
    check("token_hash ist auch für Eltern nicht lesbar", s >= 400, (s, p))
    s, devs = call("GET", "/rest/v1/devices?select=id,label,revoked_at", token=tok)
    check("Eltern sehen ihre Geräte", s == 200 and any(d["label"] == "Smoke-Test" for d in devs), (s, devs))
    s, p = call("POST", "/rest/v1/sessions", {"device_id": str(uuid.uuid4()), "id": str(uuid.uuid4()), "owner_id": str(uuid.uuid4()), "rev": 1, "data": {}}, token=tok)
    check("Eltern können nicht direkt in sessions schreiben", s >= 400, (s, p))
    s, p = call("GET", "/rest/v1/pairing_codes?select=*", token=tok)
    check("Eltern können pairing_codes nicht lesen", s >= 400 or p == [], (s, p))

    if KEEP:
        print("\n--keep: Löschung/Aufräumen übersprungen (Smoke-Test-Gerät und -Daten bleiben bestehen).")
    else:
        if input("\nJetzt ALLE Lerndaten dieses Kontos löschen und Geräte trennen? Tippe JA: ").strip() != "JA":
            print("Abgebrochen – Testdaten bleiben bestehen.")
        else:
            s, p = call("POST", "/rest/v1/rpc/delete_all_data", {}, token=tok)
            check("Eltern löschen alle Lerndaten", s in (200, 204), (s, p))
            s, rows = call("GET", "/rest/v1/sessions?select=id", token=tok)
            check("Nach dem Löschen sind keine Einheiten mehr vorhanden", s == 200 and rows == [], (s, rows))
            s, p = call("POST", "/rest/v1/rpc/sync_push", {"p_token": token, "p_sessions": [rec(3, 9)]})
            check("Geräte sind getrennt (kein Wiederhochladen)", s == 401, (s, p))
    if "--throttle" in sys.argv:  # sperrt die Kopplung ca. 10 Minuten: nur am Ende und bewusst
        codes = [call("POST", "/rest/v1/rpc/redeem_pairing_code", {"p_code": "ZZZZZZZZ", "p_label": "x"})[0] for _ in range(25)]
        check("Fehlversuche beim Koppeln werden begrenzt (429 nach 20)", 429 in codes and codes[:15].count(200) == 15, codes)
    print(f"\n{sum(results)} von {len(results)} Prüfungen bestanden.")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
