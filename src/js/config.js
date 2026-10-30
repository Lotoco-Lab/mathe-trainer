// Verbindung zum zentralen Synchronisierungsdienst (Supabase, EU-Region).
// Beide Werte sind öffentlich gedacht: Der anon-Schlüssel erlaubt nur die in
// supabase/schema.sql freigegebenen Funktionen; alle Daten sind per Row-Level-Security geschützt.
// Leer lassen = Synchronisierung aus, die App läuft rein lokal. NIE den service_role-Schlüssel eintragen!
export const CONFIG = {
  supabaseUrl: '',
  anonKey: '',
};
