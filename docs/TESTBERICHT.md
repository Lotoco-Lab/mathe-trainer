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
