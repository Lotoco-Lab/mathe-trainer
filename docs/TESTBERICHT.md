# Testbericht V1.0 (30.10.2026)

## Automatisch geprüft (Chrome headless auf dem Mac, `python3 tools/test.py`: 42 von 42 bestanden)
- **Rechenlogik:** 12 Generator-Gruppen (4 Rechenarten × 3 Stufen) mit je 300 Stichproben: Ergebnis korrekt, ganzzahlig, positiv, Zahlenraum ≤ 1000, Stufenregeln (z. B. Plus Stufe 1 ohne / Stufe 2 mit Zehnerübergang, Division ohne Rest). 10 verschiedene Aufgaben je Einheit; Gemischt enthält alle vier Rechenarten.
- **Rechenhilfen:** über 3000 Schrittzeilen werden automatisch nachgerechnet; Tipp vor der Lösung; Lösungsweg nach dem zweiten Fehlversuch.
- **Eingabe:** Tastenblock (12 Tasten), max. 4 Ziffern, keine führende Null, Löschen, „Fertig“ erst mit Eingabe, Hardware-Tastatur.
- **Übungsablauf:** zwei Versuche, Wiederholungsrunde für Fehler, Sterne-Wertung.
- **Lernfortschritt:** Speichern und Wiederfinden nach App-Neustart, Bestwerte, knifflige Aufgaben (aufnehmen, wiederholen, nach 2× richtig entfernen), Tage-Serie, Verlauf-Begrenzung, Zurücksetzen, Schutz vor beschädigten/manipulierten Daten und gesperrtem Speicher.
- **Oberfläche (E2E):** komplette Übungen über die Tasten bedient, alle Rechenarten × Stufen, Fehlerweg, Fehler-Training, Fortschrittsseite.
- **Offline:** Service Worker aktiv, alle 13 Dateien im Cache; Testserver wird abgeschaltet und die App startet, rechnet und speichert trotzdem. Gegenprobe: Mit absichtlich kaputtem Service Worker schlägt dieser Test fehl.
- **Build:** Produktionsbuild (45 KB, Build-ID im Service Worker), Precache-Liste = Dateien in `dist/`, keine externen URLs.
- **HTTPS-Aufbau (Mac-seitig):** Test-CA + Serverzertifikat per `openssl verify` gültig, Server antwortet per HTTPS (Hostname und IP), `ca.crt` wird korrekt ausgeliefert, Pfad-Ausbruch (`../certs`) liefert 404, ohne CA-Vertrauen wird die Verbindung abgelehnt.
- Sichtprüfung per Screenshot (390×844 px, iPhone-Format): Startseite und Übungsbildschirm.

## Ausstehend: Praxistest auf dem iPhone (nicht automatisch prüfbar)
- [ ] Test-CA installieren und vertrauen; iOS akzeptiert die Name Constraints der CA (nicht verifiziert – falls nicht, melden, dann wird die CA ohne Constraints neu erzeugt).
- [ ] `https://…:8443` ohne Zertifikatswarnung; „Zum Home-Bildschirm“; Icon/Name/Vollbild.
- [ ] Offline im Flugmodus (Start, Übung, Neustart, Fortschritt bleibt).
- [ ] Touch-Gefühl: Tastengröße, kein Doppeltipp-Zoom, Daumen-Erreichbarkeit, Lesbarkeit der Rechenhilfen für das Kind.
- [ ] Notch/Home-Indikator (Safe Areas), Hochformat, kleines iPhone (SE-Größe).
- [ ] Altersgerechter Schwierigkeitsgrad je Stufe und Verständlichkeit der Erklärungen (inhaltliche Rückmeldung vom Kind/den Eltern).

## Bekannte Einschränkungen
- Nur Hochformat getestet; Dunkelmodus nicht vorgesehen; keine Sprachausgabe/Töne.
- Division nur ohne Rest, Zahlenraum bis 1000 (Stufe 3). Schriftliche Verfahren sind nicht enthalten.
- Safari/iOS kann Website-Daten nach längerer Nichtnutzung löschen; Fortschritt liegt nur lokal (bewusst, kein Backup).
- Dauerhafter Betrieb ohne Mac erfordert ein HTTPS-Hosting – nicht eingerichtet (keine Veröffentlichung ohne Freigabe).

---
# V1.1 (Branch feature/v1.1, Stand 30.10.2026, `python3 tools/test.py`: 72 von 72 bestanden)

**Automatisch geprüft:** 50 Aufgaben je Einheit (Dubletten, Zähler 18/50), Wiederholungsrunde (gekennzeichnet, unbewertet, max. 10), Pause/Fortsetzen, Neustart mitten in der Übung inkl. Fehlversuch, Lernprotokoll (Einheiten- und Aufgabenfelder, ISO-Zeitstempel, keine personenbezogenen Felder), Migration von V1.0 (Daten unverändert, Sicherung, Wiederherstellung, defekte Daten), Fehlerarten-Erkennung, Elternauswertung (Übersicht, Verlauf, CSV), Sync gegen echtes HTTP (Kopplung, Einmalcode, Ablauf, Versuchsbegrenzung, Idempotenz, Revisionsregel, Ausfall mit Wiederholversuchen, Offline, Parallelität, Pakete, Bereinigung nur bestätigter Daten, aufgehobene Kopplung), Zugriffsschutz (anon/Geräte-Token lesen nichts, fremdes Elternkonto sieht nichts, falsche Anmeldung, Fremdgerät trennen wirkungslos), Löschung und Export, Elternseite im Browser (Anmeldung nötig, Detail, Fehlerarten, Code, keine gespeicherten Zugangsdaten), Offlinebetrieb mit abgeschaltetem Server, PWA-Update (neuer Cache, alter entfernt, Daten/Offline bleiben).
**Statische Prüfung:** kein geheimer Schlüssel im Client-Code, nur JWTs mit Rolle `anon`.
**Nicht prüfbar ohne Cloud-Projekt/iPhone:** Ausführung von `supabase/schema.sql` auf echtem Supabase (Tests laufen gegen einen Nachbau der Regeln), iOS-Verhalten (Installation, Update ohne Neuinstallation, Hintergrund), Zustellung über echtes Mobilfunknetz.

---
# V1.1 – Abnahmevorbereitung (Branch feature/v1.1, 30.10.2026)

## Live-Smoke-Test gegen das echte Supabase-Projekt (Frankfurt, Free)
| Prüfung | Ergebnis | Durchgeführt von |
|---|---|---|
| Anonym: `sessions`, `devices`, `pairing_codes`, `pairing_attempts` nicht lesbar (401, „permission denied“) | bestanden | Claude (`smoke.py --anon-only`) |
| Anonym: direktes Schreiben, `create_pairing_code`, `delete_all_data` abgewiesen; falsches Geräte-Token 401; falscher Kopplungscode → `invalid_code`; Selbstregistrierung gesperrt (`signup_disabled`) | bestanden | Claude |
| Elternanmeldung, falsches Passwort, Code erzeugen/einlösen/Einmaligkeit, Schreiben durch Kind-Gerät, Idempotenz, Revisionsregel, ungültige Daten, Geräte-Token liest nichts, Eltern lesen/Export, `token_hash` unlesbar, kein Direkt-Schreiben, Löschen + Trennen | **30 von 30 bestanden** (inkl. Begrenzung der Fehlversuche) | Nutzer (`smoke.py --throttle`, Zugangsdaten verdeckt im Terminal) – Ergebnis vom Nutzer gemeldet, Ausgabe lag mir nicht vor |
| Testdaten gelöscht, Geräte getrennt | ja (laut Nutzer) | Nutzer |
| CORS von `https://lotoco-lab.github.io` zu Supabase (Vorabfrage `OPTIONS`) | erlaubt (`allow-origin: *`, Header `apikey`, `authorization`) | Claude |

## Update von V1.0 mit echter alter App (`python3 tools/upgrade-check/run.py`: bestanden)
Die V1.0-App (Commit `7b674a9`) erzeugt in Chrome echte Lerndaten (10 Aufgaben, 2 Fehler → Sterne, knifflige Aufgaben, Stufe), danach wird auf demselben Pfad der V1.1-Build ausgeliefert:
- 1. Öffnen zeigt noch V1.0 (aus dem alten Cache, wie auf dem iPhone), nach dem Hintergrund-Update zeigt das 2. Öffnen V1.1.
- `mathe.progress.v1` bleibt Byte-für-Byte inhaltsgleich, Sicherung `mathe.backup.v1.0` identisch, `mathe.meta` Schema 2, Sterne (★★☆), Stufe und „Knifflige Aufgaben (2)“ erscheinen in V1.1.
- Alter Cache `mathe-<V1.0>` ist entfernt, nur der neue Cache bleibt.

## Repo-Prüfung (öffentlich sichtbar werdende Inhalte)
- Kein Passwort, kein geheimer Schlüssel (`service_role`/`sb_secret`/JWT-Rollen ≠ anon geprüft in `tools/test.py`), keine Zertifikate/Schlüsseldateien (`certs/` ignoriert), `gitleaks` über den Branch: nur der Publishable-Key (öffentlich vorgesehen, per `.gitleaks.toml` freigegeben).
- Kein Name/keine persönliche E-Mail: Alle Commits von `Lotoco-Lab` mit Noreply-Adresse. Keine Pfade mit Benutzer-/Ordnernamen in Doku. Hostname des Test-Macs aus der iPhone-Anleitung entfernt.
- Vorname des Kindes: in allen Dateien auf `feature/v1.1` und in allen Commits dieses Branches **0 Treffer**. Hinweis: Der lokale Branch `archiv-nicht-pushen` enthält noch einen alten Commit mit dem Namen (nie gepusht) – vor einer Veröffentlichung löschen (siehe Freigabeplan).
- Testdaten (`eltern@test.de`, `geheim123`) stehen nur im Test-Nachbau `tools/test.py` (Fake-Konten, ohne Bezug zum echten Konto).

## Automatische Tests: 73 von 73 bestanden (siehe `test-results/latest.txt`).
