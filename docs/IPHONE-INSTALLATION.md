# Mathe-Trainer auf dem iPhone testen

Voraussetzung: Mac und iPhone sind im selben WLAN. Auf dem Mac ist nichts weiter zu installieren (Python 3 genügt).
Die App ist eine PWA: Sie läuft nach der Installation ohne Internet; der Mac wird nur zum ersten Laden gebraucht.

## A. Auf dem Mac vorbereiten (Terminal im Projektordner)

```bash
python3 tools/test.py            # optional: Tests + Build (alle sollten „OK“ sein)
./tools/make-certs.sh            # einmalig: erzeugt Test-Zertifikate in certs/
python3 tools/serve-https.py     # startet den Testserver (Strg+C beendet ihn)
```

Der Server zeigt zwei Adressen an (Beispiel):
- App: `https://<Mac-Name>.local:8443/`
- Zertifikat: `http://<Mac-Name>.local:8080/`

Falls macOS fragt, ob Python eingehende Netzwerkverbindungen erlauben darf: **Erlauben** (nur für diesen Test; danach Server beenden).

## B. Test-Zertifikat auf dem iPhone installieren (einmalig)

Safari erlaubt Offline-Apps nur über HTTPS mit einem vertrauten Zertifikat. Dafür wird die eigene Test-CA installiert.

1. In **Safari** `http://<Mac-Name>.local:8080/` öffnen → **„Test-Zertifikat laden“** → **Zulassen**.
2. **Einstellungen → „Profil geladen“** (oben, unter deinem Namen) → **Installieren** → Code eingeben → **Installieren**.
3. **Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen** → bei „Mathe-Trainer Test-CA (nur lokal)“ den Schalter **einschalten**.

Die CA gilt nur für lokale Namen/Adressen (Name Constraints), nicht für normale Webseiten.

## C. App installieren

1. In Safari `https://<Mac-Name>.local:8443/` öffnen (ohne Warnung; die Seite zeigt unten „✓ Funktioniert auch ohne Internet“, sobald alles zwischengespeichert ist).
2. **Teilen-Symbol → „Zum Home-Bildschirm“ → Hinzufügen.**
3. Die App ab jetzt über das Icon „Mathe-Trainer“ starten (Vollbild, ohne Safari-Leiste).

Lässt sich `.local` nicht auflösen, stattdessen die IP-Adresse aus der Server-Ausgabe verwenden (`https://192.168.x.x:8443/`; das Zertifikat enthält sie).

## D. Offlinetest

1. App einmal öffnen, bis unten „✓ Funktioniert auch ohne Internet“ steht.
2. **Flugmodus an** (oder Server am Mac mit Strg+C beenden).
3. App vom Home-Bildschirm starten, eine Übung rechnen, App schließen und neu öffnen → Fortschritt muss noch da sein.

## E. Aufräumen nach dem Test

- Server am Mac beenden (Strg+C).
- Wenn die Test-CA nicht mehr gebraucht wird: **Einstellungen → Allgemein → VPN & Geräteverwaltung → Profil → Profil entfernen**. Die installierte App bleibt nutzbar, solange sie im Cache ist; ein späteres Update braucht wieder einen HTTPS-Server.
- Soll die App dauerhaft ohne Mac laufen, ist ein HTTPS-Hosting nötig (z. B. eigener Webserver im Heimnetz oder statisches Hosting). Das wurde bewusst **nicht** eingerichtet (keine Veröffentlichung ohne Freigabe).

## Update der App
Code ändern → `python3 tools/test.py` → `python3 tools/serve-https.py` → App auf dem iPhone mit Netz zum Mac öffnen und zweimal schließen/öffnen (der neue Service Worker übernimmt dann). Die Build-Nummer steht unter „Mein Fortschritt“.

## Wenn etwas nicht klappt
- „Verbindung nicht privat“: Zertifikat nicht vertraut → Schritt B.3 prüfen.
- Kein „✓ Funktioniert auch ohne Internet“: Seite neu laden; Safari-Privatmodus funktioniert nicht für Offline-Apps.
- Fortschritt weg: Safari-Website-Daten löschen entfernt auch den Fortschritt (Einstellungen → Safari). Die installierte App hat eigenen Speicher, getrennt von Safari.
