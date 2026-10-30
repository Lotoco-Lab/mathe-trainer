# Supabase einrichten und prüfen (Projekt `mathe-trainer`, Frankfurt, Free)

Stand: Schema und Client sind vorbereitet und gegen einen Nachbau getestet; **die Datenbank selbst ist noch nicht eingerichtet.**

## Prüfung von `supabase/schema.sql` gegen die Projekteinstellungen
| Einstellung | Ergebnis |
|---|---|
| Data API aktiv | Passt: Zugriff läuft über PostgREST (`/rest/v1/…`), die App braucht keine weitere Schnittstelle. |
| „Automatically expose new tables“ **aus** | Passt: Das Schema verlässt sich nicht auf Standardrechte. Es entzieht zuerst alles (`revoke all … from anon, authenticated`) und vergibt nur: Eltern (`authenticated`) dürfen Zeilen aus `sessions` lesen/löschen und ausgewählte Spalten aus `devices` lesen. `anon` hat auf **keiner** Tabelle Rechte. |
| „Automatic RLS“ **an** | Passt: RLS wird zusätzlich je Tabelle ausdrücklich eingeschaltet. Policies binden jede Zeile an `owner_id = auth.uid()`. Ohne Policy gibt es keinen Zugriff (`pairing_*` haben bewusst keine). |
| Funktionen | `revoke execute … from public, anon, authenticated`, danach gezielt: `redeem_pairing_code`, `sync_push` für `anon`; `create_pairing_code`, `revoke_device`, `delete_all_data` nur für angemeldete Eltern. Alle `SECURITY DEFINER` mit festem `search_path`. |
| Auth | Eltern: E-Mail + Passwort (Hash bei Supabase). **Registrierung muss aus sein**, Konto von Hand anlegen. |
| Kopplung / Trennung Eltern–Kind | Kind-Gerät hat nie ein Konto: Einmalcode (10 min, 8 Zeichen) → Zufalls-Token, serverseitig nur als SHA-256. Token kann nur `sync_push`; Lesen ist technisch unmöglich. Eltern können Geräte trennen; „Alle Daten löschen“ trennt ebenfalls alle. |

Anpassungen aus dieser Prüfung: Policies sind nun wiederholt ausführbar (`drop policy if exists`); der Client sendet neue Schlüssel im Format `sb_publishable_…` nur im `apikey`-Header (nicht als Bearer, sonst lehnt das Gateway ab) – alte JWT-anon-Schlüssel funktionieren weiter.

Bekannte, bewusst akzeptierte Restrisiken: Wer 20 falsche Codes in 10 Minuten abschickt, sperrt die Kopplung für kurze Zeit (nur Ärgernis, keine Datenpreisgabe). Die Elternseite maskiert alle Werte aus der Datenbank (kein Skript-Einschleusen über Aufgabentexte). Bei Inaktivität pausiert der Free-Plan das Projekt nach ca. einer Woche (im Dashboard wieder startbar, Daten bleiben).

## Einrichtung – einfachster sicherer Weg (ca. 10 Minuten, Passwörter nur bei dir)
1. **SQL einspielen:** Dashboard → *SQL Editor* → New query → Inhalt von `supabase/schema.sql` einfügen (im Terminal kopierbar mit `pbcopy < supabase/schema.sql`) → *Run*. Erwartung: „Success“.
2. **Registrierung aus:** *Authentication → Sign In / Providers* (bzw. *Settings*) → **„Allow new users to sign up“ ausschalten**.
3. **Eltern-Konto:** *Authentication → Users → Add user → Create new user*: E-Mail + starkes Passwort (12+ Zeichen), „Auto Confirm User“ an.
4. **Schlüssel eintragen:** *Project Settings → API (bzw. API Keys)*: *Project URL* und den **öffentlichen** Schlüssel (`anon` bzw. `publishable`) in `src/js/config.js` eintragen – beide sind öffentlich gedacht. **Nie** `service_role`/`secret` verwenden. (Ich trage sie gern ein, wenn du mir URL und öffentlichen Schlüssel nennst.)
5. **Smoke-Test:** im Terminal `python3 tools/smoke.py` – fragt E-Mail/Passwort verdeckt ab, prüft 29 Punkte gegen das echte Projekt (Zugriffsschutz, Kopplung, Schreiben, Idempotenz, Lesen/Export, Löschen). Am Ende wird zur Sicherheit „JA“ abgefragt, bevor Daten gelöscht werden (`--keep` überspringt das).
6. **Dashboard-Check:** *Advisors → Security* öffnen: es sollten keine Warnungen zu RLS oder öffentlich lesbaren Tabellen erscheinen.
7. Danach: iPhone-Praxistest (Kopplung, Offline-Phase, Nachsynchronisierung) mit dem Plan aus `docs/V1.1-ELTERN-UND-SYNC.md`, Abschnitt 8.

### Alternative: Ich richte es über den Supabase-Connector ein
Wenn du in Claude den **Supabase-Connector** verbindest (OAuth, du bestätigst im Browser; am besten nur Projekt `mathe-trainer`), kann ich Schritt 1 und die Prüfung der Berechtigungen/Advisors selbst ausführen. Schritt 2 und 3 (Registrierung aus, Eltern-Konto mit Passwort) bleiben bei dir, damit kein Passwort durch den Chat geht. Der Connector hat weitreichende Rechte im Projekt (SQL, Migrationen) – nur verbinden, wenn du das willst.

## Offene Punkte
- Ausführung des Schemas und `tools/smoke.py` gegen das echte Projekt (benötigt Schritt 1–4).
- Offline-/Sync-Verhalten der echten App mit echtem Netz auf dem iPhone.
- MFA für das Eltern-Konto ist nicht eingebaut (Passwort genügt für V1.1; bei Bedarf nachrüsten).
