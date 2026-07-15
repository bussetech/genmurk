-- GENMURK-EPIC1-08 (follow-on) — OPEN REGISTRATION with an optional instance
-- passphrase (GM-R18, decisions.md "Signup posture"). The ruled v1 posture is
-- now: registration MAY be open, gated by a single instance-wide passphrase as
-- lightweight anti-spam. Three modes, an operator (god) choice:
--
--   closed      — god-provisioned only (the prior behavior; safe default)
--   open        — anyone may self-register a base-tier player
--   passphrase  — anyone who presents the one instance passphrase may register
--
-- The passphrase is a CREDENTIAL: stored ONLY as a bcrypt hash (pgcrypto, the
-- same KDF class as GM-R18 auth), never plaintext, never in the repo. It gates
-- the WORLD registration, checked server-side BEFORE any account is minted, so
-- a wrong passphrase creates nothing. A registered player is always base tier
-- (no privilege from self-registration).
--
-- Additive per the migration law: new settings, new functions, audit enum
-- extended, shipped migrations untouched.

alter table object_audit drop constraint object_audit_action_check;
alter table object_audit add constraint object_audit_action_check
  check (action in
    ('bootstrap','create','create_player','set_attr','set_lock','move',
     'destroy','recover','chown','set_power','rename','provision','register',
     'set_registration'));

-- Registration policy lives in app_settings as data (like the recovery window
-- and default quota): the mode, and the bcrypt hash of the instance passphrase
-- (null unless mode = 'passphrase'). Safe default: closed.
insert into app_settings (key, value) values
  ('registration_mode', '"closed"'),
  ('registration_passphrase_hash', 'null')
on conflict (key) do nothing;

-- ------------------------------------------------- operator: set the policy
-- God-only (the one seam, migration 06). Setting 'passphrase' mode requires a
-- non-empty passphrase, stored bcrypt-hashed; the other modes clear the hash.
-- search_path includes `extensions`: pgcrypto (crypt/gen_salt) lives there on
-- the sanctioned stack, not in public (ADR-0048).
create or replace function public.world_set_registration(p_mode text, p_passphrase text default null)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform _world_require_power(current_player_id(), 4);   -- god only
  if p_mode not in ('closed','open','passphrase') then
    raise exception 'unknown registration mode "%" (closed|open|passphrase)', p_mode;
  end if;
  if p_mode = 'passphrase' then
    if p_passphrase is null or length(btrim(p_passphrase)) = 0 then
      raise exception 'passphrase mode requires a non-empty passphrase';
    end if;
    update app_settings set value = to_jsonb(crypt(p_passphrase, gen_salt('bf'))), updated_at = now()
      where key = 'registration_passphrase_hash';
  else
    update app_settings set value = 'null'::jsonb, updated_at = now()
      where key = 'registration_passphrase_hash';
  end if;
  update app_settings set value = to_jsonb(p_mode), updated_at = now()
    where key = 'registration_mode';
  -- audit the MODE, never the passphrase
  insert into object_audit (actor_id, action, target_id, detail)
  values (current_player_id(), 'set_registration', current_player_id(), p_mode);
end $$;

-- ------------------------------------------------ public: what mode are we in
-- Anyone (even anon) may learn whether registration is open and whether a
-- passphrase is needed — never the passphrase itself. Lets a client prompt
-- correctly without a login.
create or replace function public.world_registration_mode()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'mode', coalesce((select value #>> '{}' from app_settings where key = 'registration_mode'), 'closed'),
    'requires_passphrase',
      coalesce((select value #>> '{}' from app_settings where key = 'registration_mode'), 'closed') = 'passphrase'
  )
$$;

-- ---------------------------------------- server plane: gate check + provision
-- Verify the registration gate. Returns true iff registration should proceed:
-- open → always; passphrase → the presented passphrase matches the stored
-- hash; closed → never. Service-plane only (the server calls it BEFORE minting
-- an account); not exposed to anon, so it is not a passphrase-guessing oracle.
create or replace function public._world_check_registration(p_passphrase text)
returns boolean language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_mode text;
  v_hash text;
begin
  select value #>> '{}' into v_mode from app_settings where key = 'registration_mode';
  v_mode := coalesce(v_mode, 'closed');
  if v_mode = 'open' then
    return true;
  elsif v_mode = 'closed' then
    return false;
  else -- passphrase
    select value #>> '{}' into v_hash from app_settings where key = 'registration_passphrase_hash';
    if v_hash is null or p_passphrase is null then
      return false;
    end if;
    return crypt(p_passphrase, v_hash) = v_hash;
  end if;
end $$;

-- Self-registration player creation (service plane). Distinct from the god-only
-- _world_create_player: its gate is the registration policy (checked by the
-- server before this call), and it always mints a BASE-tier player — a
-- self-registered account can never arrive with elevated power. The new player
-- lands in Limbo #0 (the reference's connect room), owns itself, gets the
-- default quota, and is bound to its auth principal in one shot. Refuses a
-- duplicate live player name and an already-bound principal.
create or replace function public.world_register_player(p_name text, p_auth uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_limbo uuid;
  v_quota integer;
  v_new uuid := gen_random_uuid();
begin
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'a player name may not be empty';
  end if;
  if exists (select 1 from objects where type = 'player' and destroyed_at is null and lower(name) = lower(btrim(p_name))) then
    raise exception 'the name "%" is already taken', btrim(p_name);
  end if;
  if exists (select 1 from objects where auth_user_id = p_auth) then
    raise exception 'that account already has a player';
  end if;
  select id into v_limbo from objects where dbref = 0 and type = 'room';
  if v_limbo is null then
    raise exception 'no Limbo #0 (world not bootstrapped)';
  end if;
  select (value #>> '{}')::integer into v_quota from app_settings where key = 'default_quota';
  insert into objects (id, type, name, owner_id, location_id, power, quota, auth_user_id)
  values (v_new, 'player', btrim(p_name), v_new, v_limbo, 'player', v_quota, p_auth);
  insert into object_audit (actor_id, action, target_id, detail)
  values (v_new, 'register', v_new, 'self-registered');
  return v_new;
end $$;

-- ------------------------------------------------------------------- grants
grant execute on function public.world_set_registration(text, text)  to authenticated;
grant execute on function public.world_registration_mode()           to anon, authenticated;
grant execute on function public._world_check_registration(text)     to service_role;
grant execute on function public.world_register_player(text, uuid)   to service_role;
