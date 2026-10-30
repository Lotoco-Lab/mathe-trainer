-- Mathe-Trainer V1.1: Datenbankschema für die Eltern-Synchronisierung (Supabase / PostgreSQL).
-- EINMALIG im Supabase-SQL-Editor ausführen (Projekt in EU-Region, z. B. Frankfurt).
--
-- Sicherheitsmodell
--  * Eltern: Supabase-Auth-Konto (E-Mail + Passwort, Registrierung im Dashboard AUSSCHALTEN, Konto selbst anlegen).
--  * Kind-Gerät: kein Konto. Es besitzt ein zufälliges Geräte-Token (nur dessen SHA-256 liegt auf dem Server),
--    erhalten durch Einlösen eines 10-Minuten-Einmalcodes, den die Eltern nach Anmeldung erzeugen.
--  * Der öffentliche anon-Schlüssel darf AUSSCHLIESSLICH die Funktionen redeem_pairing_code und sync_push aufrufen;
--    auf Tabellen hat anon keinerlei Rechte. Eltern lesen/löschen nur eigene Zeilen (Row-Level-Security).
--  * Geräte können nur schreiben (sync_push), nie lesen.
--
-- Kompatibilität mit den Projekteinstellungen "Automatically expose new tables" = AUS und
-- "Automatic RLS" = AN: Alle Rechte werden unten ausdrücklich vergeben bzw. entzogen, RLS wird für
-- jede Tabelle selbst eingeschaltet. Das Skript ist wiederholt ausführbar.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.devices (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  label       text not null default 'Kind-Gerät' check (char_length(label) <= 40),
  token_hash  bytea not null unique,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz,
  revoked_at  timestamptz
);

create table if not exists public.pairing_codes (
  code_hash   bytea primary key,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create table if not exists public.pairing_attempts (
  at timestamptz not null default now()
);

create table if not exists public.sessions (
  device_id   uuid not null references public.devices(id) on delete cascade,
  id          uuid not null,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  rev         integer not null check (rev >= 0),
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  primary key (device_id, id)
);
create index if not exists sessions_owner_updated on public.sessions (owner_id, updated_at desc);

-- Row-Level-Security: ohne Policy kein Zugriff.
alter table public.devices          enable row level security;
alter table public.pairing_codes    enable row level security;
alter table public.pairing_attempts enable row level security;
alter table public.sessions         enable row level security;

drop policy if exists devices_owner_read on public.devices;
create policy devices_owner_read   on public.devices  for select to authenticated using (owner_id = auth.uid());
drop policy if exists sessions_owner_read on public.sessions;
create policy sessions_owner_read  on public.sessions for select to authenticated using (owner_id = auth.uid());
drop policy if exists sessions_owner_del on public.sessions;
create policy sessions_owner_del   on public.sessions for delete to authenticated using (owner_id = auth.uid());

-- Tabellenrechte: nur das Nötigste, token_hash bleibt auch für Eltern unlesbar.
revoke all on public.devices, public.pairing_codes, public.pairing_attempts, public.sessions from anon, authenticated;
grant select (id, label, created_at, last_seen, revoked_at) on public.devices to authenticated;
grant select, delete on public.sessions to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Funktionen (SECURITY DEFINER, feste search_path)
-- ---------------------------------------------------------------------------------------------

-- Eltern: Einmalcode erzeugen (8 Zeichen ohne verwechselbare Zeichen, 10 Minuten gültig).
create or replace function public.create_pairing_code() returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(8);
  code text := '';
  i int;
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'PT401'; end if;
  delete from pairing_codes where expires_at < now() - interval '1 day';
  if (select count(*) from pairing_codes where owner_id = auth.uid() and used_at is null and expires_at > now()) >= 5 then
    raise exception 'too_many_codes' using errcode = 'PT429';
  end if;
  for i in 0..7 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  insert into pairing_codes (code_hash, owner_id, expires_at)
  values (digest(code, 'sha256'), auth.uid(), now() + interval '10 minutes');
  return code;
end $$;

-- Kind-Gerät: Code einlösen → Geräte-Token (wird nur hier einmal ausgegeben).
create or replace function public.redeem_pairing_code(p_code text, p_label text default 'Kind-Gerät') returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_hash bytea := digest(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256');
  v_owner uuid;
  v_token text := encode(gen_random_bytes(32), 'hex');
  v_device uuid;
begin
  delete from pairing_attempts where at < now() - interval '1 hour';
  if (select count(*) from pairing_attempts where at > now() - interval '10 minutes') >= 20 then
    raise exception 'too_many_attempts' using errcode = 'PT429';
  end if;
  update pairing_codes set used_at = now()
   where code_hash = v_hash and used_at is null and expires_at > now()
   returning owner_id into v_owner;
  if v_owner is null then
    insert into pairing_attempts default values;
    raise exception 'invalid_code' using errcode = 'PT400';
  end if;
  insert into devices (owner_id, label, token_hash)
  values (v_owner, left(coalesce(nullif(trim(p_label), ''), 'Kind-Gerät'), 40), digest(v_token, 'sha256'))
  returning id into v_device;
  return jsonb_build_object('token', v_token, 'device_id', v_device);
end $$;

-- Kind-Gerät: Übungsdatensätze idempotent übertragen (höhere rev überschreibt, gleiche/ältere nicht).
create or replace function public.sync_push(p_token text, p_sessions jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_dev devices%rowtype;
  v_elem jsonb;
  v_id uuid;
  v_rev int;
  v_cur int;
  v_acked jsonb := '[]'::jsonb;
begin
  select * into v_dev from devices
   where token_hash = digest(coalesce(p_token, ''), 'sha256') and revoked_at is null;
  if not found then raise exception 'invalid_token' using errcode = 'PT401'; end if;
  if jsonb_typeof(p_sessions) <> 'array' or jsonb_array_length(p_sessions) > 20 then
    raise exception 'bad_request' using errcode = 'PT400';
  end if;
  for v_elem in select * from jsonb_array_elements(p_sessions) loop
    if octet_length(v_elem::text) > 200000 then raise exception 'too_large' using errcode = 'PT400'; end if;
    begin
      v_id  := (v_elem ->> 'id')::uuid;
      v_rev := (v_elem ->> 'rev')::int;
    exception when others then
      raise exception 'bad_request' using errcode = 'PT400';
    end;
    if v_rev is null or v_rev < 0 then raise exception 'bad_request' using errcode = 'PT400'; end if;
    insert into sessions as s (device_id, id, owner_id, rev, data)
    values (v_dev.id, v_id, v_dev.owner_id, v_rev, v_elem)
    on conflict (device_id, id) do update
      set rev = excluded.rev, data = excluded.data, updated_at = now()
      where s.rev < excluded.rev;
    select rev into v_cur from sessions where device_id = v_dev.id and id = v_id;
    v_acked := v_acked || jsonb_build_object('id', v_id, 'rev', v_cur);
  end loop;
  update devices set last_seen = now() where id = v_dev.id;
  return jsonb_build_object('acked', v_acked);
end $$;

-- Eltern: Gerät trennen.
create or replace function public.revoke_device(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'PT401'; end if;
  update devices set revoked_at = now() where id = p_id and owner_id = auth.uid() and revoked_at is null;
end $$;

-- Eltern: alle Lerndaten löschen und alle Geräte trennen (damit lokale Altdaten nicht wieder hochgeladen werden).
create or replace function public.delete_all_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = 'PT401'; end if;
  delete from sessions where owner_id = auth.uid();
  delete from pairing_codes where owner_id = auth.uid();
  update devices set revoked_at = now() where owner_id = auth.uid() and revoked_at is null;
end $$;

-- Funktionsrechte: standardmäßig niemand, dann gezielt freigeben.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.redeem_pairing_code(text, text) to anon, authenticated;
grant execute on function public.sync_push(text, jsonb)          to anon, authenticated;
grant execute on function public.create_pairing_code()           to authenticated;
grant execute on function public.revoke_device(uuid)             to authenticated;
grant execute on function public.delete_all_data()               to authenticated;

-- Aufbewahrung: Daten bleiben bis zur Löschung durch die Eltern (empfohlen: höchstens 24 Monate).
-- Optional automatisch (Erweiterung pg_cron aktivieren):
--   select cron.schedule('mathe-retention', '0 3 * * 0', $q$ delete from public.sessions where updated_at < now() - interval '24 months' $q$);
