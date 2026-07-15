-- GENMURK-EPIC1-08 — auth & the graded capability model (GM-R15/R18/R19).
--
-- 04 MODELLED the capability tiers (the `power` column, `power_rank`,
-- `is_wizard`, `_world_controls`) and RLS keyed off them; the building RPCs
-- checked the tier inline. This migration makes the tier ladder the SINGLE
-- server-side authorization SEAM and closes out the admin verbs the model
-- named but had not grown:
--
--   * `_world_require_power(actor, min)` — the one gate. Resolves the live
--     acting player AND enforces the rank floor, raising a uniform capability
--     error. The building/registration RPCs are re-expressed to call it, so
--     tier decisions live in ONE function, not scattered `power_rank(...) < N`
--     ifs (the "one authorization seam" of prompt 08). `_world_controls` stays
--     the companion seam for ownership+wizard (per-target control).
--   * `world_set_power` — a god-only tier grant (the reference's @power). The
--     verb the escalation matrix needs to prove "only god may re-grade a
--     player."
--   * `world_bind_auth` — the provider-store binding step of GM-R18 first-boot
--     provisioning and closed-signup registration: link an auth principal to a
--     player object. Server-plane only, audited, idempotent. The auth ACCOUNT
--     itself is minted through Supabase Auth (the sanctioned KDF, ADR-0048) by
--     src/server/auth.ts — SQL never sees a password (GM-R19).
--
-- Additive per the studio migration law: the shipped 01-05 migrations are not
-- edited; every function here is CREATE OR REPLACE or new, and the audit-action
-- vocabulary is extended, never rewritten.

-- The audit vocabulary already anticipates 'set_power' (schema.sql) and 05
-- added 'rename'; provisioning a player's auth binding is a new world act.
alter table object_audit drop constraint object_audit_action_check;
alter table object_audit add constraint object_audit_action_check
  check (action in
    ('bootstrap','create','create_player','set_attr','set_lock',
     'move','destroy','recover','chown','set_power','rename','provision'));

-- =========================================================== the one seam
-- Resolve the acting player and enforce the capability floor in one place.
-- Returns the live actor row so callers that also need it (quota, insert) do
-- not re-query. Raises a uniform, greppable capability error otherwise. Every
-- tier-gated RPC below routes through THIS — the single authorization seam
-- (GM-R15). `power_rank` (04) is the ladder it reads; `_world_controls` (04)
-- is the per-target companion for ownership+wizard.
create or replace function public._world_require_power(p_actor uuid, p_min int)
returns objects language plpgsql stable security definer set search_path = public as $$
declare
  v_actor objects;
begin
  v_actor := _world_live_player(p_actor);
  if v_actor.id is null then
    raise exception 'no such acting player';
  end if;
  if power_rank(v_actor.power) < p_min then
    raise exception 'permission denied: this act requires power rank % (GM-R15), actor has % (%)',
      p_min, power_rank(v_actor.power), v_actor.power;
  end if;
  return v_actor;
end $$;

-- ------------------------------------------------- re-express the tier gates
-- Same semantics as 03/03-rename; the inline `power_rank(...) < N` checks are
-- replaced by the seam so building/registration authorization is decided in
-- exactly one function.

-- Building requires builder+ (rank 2). Quota (GM-R9) still enforced here.
create or replace function public._world_create_object(
  p_actor uuid, p_type text, p_name text, p_location uuid, p_destination uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_actor objects;
  v_owned int;
  v_new uuid;
begin
  v_actor := _world_require_power(p_actor, 2);   -- builder+ (the one seam)
  if v_actor.quota is not null then
    select count(*) into v_owned from objects
      where owner_id = p_actor and destroyed_at is null;
    if v_owned >= v_actor.quota then
      raise exception 'quota exceeded (% of %)', v_owned, v_actor.quota;
    end if;
  end if;
  insert into objects (type, name, owner_id, location_id, destination_id)
  values (p_type, p_name, p_actor, p_location, p_destination)
  returning id into v_new;
  insert into object_audit (actor_id, action, target_id, detail)
  values (p_actor, 'create', v_new, p_type || ' "' || p_name || '"');
  return v_new;
end $$;

-- Player creation is a god-only registration/admin act (rank 4).
create or replace function public._world_create_player(
  p_actor uuid, p_name text, p_power text, p_location uuid, p_quota integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_new uuid := gen_random_uuid();
begin
  perform _world_require_power(p_actor, 4);      -- god only (the one seam)
  if p_power not in ('player','builder','wizard','god') then
    raise exception 'unknown power tier "%"', p_power;
  end if;
  insert into objects (id, type, name, owner_id, location_id, power, quota)
  values (v_new, 'player', p_name, v_new, p_location, p_power, p_quota);
  insert into object_audit (actor_id, action, target_id, detail)
  values (p_actor, 'create_player', v_new, p_power || ' "' || p_name || '"');
  return v_new;
end $$;

-- =========================================================== @power (GM-R15)
-- Re-grade a player's capability tier. God only. The verb that makes the
-- ladder administrable — and the sharp "god-only" row of the escalation
-- matrix. Guards: target must be a live player; God #1 (the indestructible
-- root authority) may never be demoted, so a fresh world can never be locked
-- out of its own god tier.
create or replace function public._world_set_power(p_actor uuid, p_target uuid, p_power text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_target objects;
begin
  perform _world_require_power(p_actor, 4);       -- god only (the one seam)
  if p_power not in ('player','builder','wizard','god') then
    raise exception 'unknown power tier "%"', p_power;
  end if;
  select * into v_target from objects
    where id = p_target and type = 'player' and destroyed_at is null;
  if v_target.id is null then
    raise exception 'no such live player';
  end if;
  if v_target.dbref = 1 and p_power <> 'god' then
    raise exception 'God #1 may not be demoted (root authority)';
  end if;
  update objects set power = p_power where id = p_target;
  insert into object_audit (actor_id, action, target_id, detail)
  values (p_actor, 'set_power', p_target, p_power);
end $$;

create or replace function public.world_set_power(p_target uuid, p_power text)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_player_id();
begin
  if v_actor is null then raise exception 'not signed in as a player'; end if;
  perform _world_set_power(v_actor, p_target, p_power);
end $$;

-- =========================================================== provisioning
-- Bind an auth principal (auth.users.id) to a player object — the SQL half of
-- GM-R18 first-boot provisioning and closed-signup registration. The auth
-- account (its argon2/bcrypt-class secret) is minted through Supabase Auth by
-- the server plane (src/server/auth.ts); NO credential is ever passed to or
-- stored by SQL (GM-R19). Server-plane only (service_role). Idempotent:
-- re-binding the SAME principal is a no-op; binding when a DIFFERENT principal
-- is already linked refuses (the operator must unlink first — deleting the
-- auth account SET NULLs it, per the schema FK).
create or replace function public.world_bind_auth(p_player uuid, p_auth uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_player objects;
begin
  select * into v_player from objects
    where id = p_player and type = 'player' and destroyed_at is null;
  if v_player.id is null then
    raise exception 'no such live player to bind';
  end if;
  if v_player.auth_user_id is not null then
    if v_player.auth_user_id = p_auth then
      return;  -- idempotent: already bound to this principal
    end if;
    raise exception 'player #% is already bound to a different auth principal', v_player.dbref;
  end if;
  update objects set auth_user_id = p_auth where id = p_player;
  insert into object_audit (actor_id, action, target_id, detail)
  values (p_player, 'provision', p_player, 'auth binding');
end $$;

-- =========================================================== grants
-- @power is a signed-in god act (the RPC re-checks the tier); provisioning is
-- the server plane's (service_role only — a player can never bind auth).
grant execute on function public._world_require_power(uuid, int)  to service_role;
grant execute on function public._world_set_power(uuid, uuid, text) to service_role;
grant execute on function public.world_set_power(uuid, text)      to authenticated;
grant execute on function public.world_bind_auth(uuid, uuid)      to service_role;
