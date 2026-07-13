-- World-model lifecycle: invariants as triggers (they bind every write path,
-- including the service role) and the audited SECURITY DEFINER RPCs that are
-- the ONLY mutation path below the service role. RLS gives players/builders
-- no raw write; these functions check the capability tier (GM-R15) and write
-- an audit row. Building semantics: GM-R7 verbs (dig/open/create), GM-R8
-- locks, GM-R9 quotas/inheritance/recoverable destruction.

-- =========================================================== triggers

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger objects_touch before update on objects
  for each row execute function touch_updated_at();

-- Stable identity (GM-R5): dbref and type never change once minted.
create or replace function public.enforce_object_immutability()
returns trigger language plpgsql as $$
begin
  if new.dbref is distinct from old.dbref then
    raise exception 'dbref is immutable (stable identity, GM-R5)';
  end if;
  if new.type is distinct from old.type then
    raise exception 'object type is immutable';
  end if;
  return new;
end $$;

create trigger objects_immutable before update on objects
  for each row execute function enforce_object_immutability();

-- Containment is acyclic (GM-R6, task 2: "containment cycles refused"): a
-- move may not place an object inside itself, directly or transitively. Walk
-- the location chain upward from the new location; a hit on the row's own id
-- is a cycle. Bounded so a pre-existing bad chain cannot spin forever.
create or replace function public.enforce_no_containment_cycle()
returns trigger language plpgsql as $$
declare
  v_cur uuid := new.location_id;
  v_hops int := 0;
begin
  while v_cur is not null loop
    if v_cur = new.id then
      raise exception 'containment cycle refused (% cannot contain itself)', new.id;
    end if;
    v_hops := v_hops + 1;
    if v_hops > 128 then
      raise exception 'containment chain too deep (possible cycle)';
    end if;
    select location_id into v_cur from objects where id = v_cur;
  end loop;
  return new;
end $$;

create trigger objects_no_containment_cycle
  before insert or update of location_id on objects
  for each row execute function enforce_no_containment_cycle();

-- Attribute inheritance is acyclic (GM-R9): the parent chain must not loop.
create or replace function public.enforce_no_parent_cycle()
returns trigger language plpgsql as $$
declare
  v_cur uuid := new.parent_id;
  v_hops int := 0;
begin
  while v_cur is not null loop
    if v_cur = new.id then
      raise exception 'parent cycle refused (% cannot inherit from itself)', new.id;
    end if;
    v_hops := v_hops + 1;
    if v_hops > 128 then
      raise exception 'parent chain too deep (possible cycle)';
    end if;
    select parent_id into v_cur from objects where id = v_cur;
  end loop;
  return new;
end $$;

create trigger objects_no_parent_cycle
  before insert or update of parent_id on objects
  for each row execute function enforce_no_parent_cycle();

-- =========================================================== internal ops
-- These take an explicit actor and hold the invariants; the public wrappers
-- resolve the actor from the JWT. Seed and the server plane may drive them
-- directly (exercising the RPC logic, not INSERTing around it).

-- Control (GM-R15): the owner, or wizard/god over anything.
create or replace function public._world_controls(p_actor uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from objects a join objects t on t.id = p_target
     where a.id = p_actor
       and (t.owner_id = p_actor or power_rank(a.power) >= 3)
  )
$$;

create or replace function public._world_live_player(p_actor uuid)
returns objects language sql stable security definer set search_path = public as $$
  select * from objects
   where id = p_actor and type = 'player' and destroyed_at is null
$$;

-- GM-R7 building verbs, generic. Building requires builder+ (GM-R15). Quota
-- (GM-R9) is enforced here against LIVE owned objects.
create or replace function public._world_create_object(
  p_actor uuid, p_type text, p_name text, p_location uuid, p_destination uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_actor objects;
  v_owned int;
  v_new uuid;
begin
  v_actor := _world_live_player(p_actor);
  if v_actor.id is null then
    raise exception 'no such acting player';
  end if;
  if power_rank(v_actor.power) < 2 then
    raise exception 'building requires the builder power (GM-R15)';
  end if;
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

-- Player creation is a registration/admin act (god only), NOT a building
-- verb — players own themselves (self-referential owner, resolved via the
-- deferred FK). GM-R18 auth binding is set later (prompt 08); auth_user_id
-- stays null here.
create or replace function public._world_create_player(
  p_actor uuid, p_name text, p_power text, p_location uuid, p_quota integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_actor objects;
  v_new uuid := gen_random_uuid();
begin
  v_actor := _world_live_player(p_actor);
  if v_actor.id is null or power_rank(v_actor.power) < 4 then
    raise exception 'only god may create players (GM-R15/R18)';
  end if;
  insert into objects (id, type, name, owner_id, location_id, power, quota)
  values (v_new, 'player', p_name, v_new, p_location, p_power, p_quota);
  insert into object_audit (actor_id, action, target_id, detail)
  values (p_actor, 'create_player', v_new, p_power || ' "' || p_name || '"');
  return v_new;
end $$;

create or replace function public._world_set_attr(
  p_actor uuid, p_target uuid, p_name text, p_value text,
  p_visual boolean, p_no_inherit boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not _world_controls(p_actor, p_target) then
    raise exception 'permission denied: you do not control that object';
  end if;
  insert into object_attributes (object_id, name, value, visual, no_inherit, updated_at)
  values (p_target, upper(p_name), p_value, p_visual, p_no_inherit, now())
  on conflict (object_id, name)
  do update set value = excluded.value, visual = excluded.visual,
                no_inherit = excluded.no_inherit, updated_at = now();
  insert into object_audit (actor_id, action, target_id, detail)
  values (p_actor, 'set_attr', p_target, upper(p_name));
end $$;

create or replace function public._world_set_lock(
  p_actor uuid, p_target uuid, p_type text, p_expr text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not _world_controls(p_actor, p_target) then
    raise exception 'permission denied: you do not control that object';
  end if;
  insert into object_locks (object_id, lock_type, expr, updated_at)
  values (p_target, p_type, p_expr, now())
  on conflict (object_id, lock_type)
  do update set expr = excluded.expr, updated_at = now();
  insert into object_audit (actor_id, action, target_id, detail)
  values (p_actor, 'set_lock', p_target, p_type || ':' || p_expr);
end $$;

-- Movement (GM-R6): updates location and fires presence events onto the
-- outbox. Lock GATING (GM-R8 enter/pickup) is the world-API's job — it
-- evaluates the boolean lock and only then calls this; the DB enforces the
-- structural and capability invariants (you move yourself or what you own;
-- no cycles). Defense-in-depth DB-side lock eval is a documented later step.
create or replace function public._world_move(
  p_actor uuid, p_what uuid, p_dest uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor objects;
  v_old uuid;
begin
  v_actor := _world_live_player(p_actor);
  if v_actor.id is null then
    raise exception 'no such acting player';
  end if;
  -- may move self, or an object one controls
  if p_what <> p_actor and not _world_controls(p_actor, p_what) then
    raise exception 'permission denied: you cannot move that object';
  end if;
  if not exists (select 1 from objects where id = p_dest and destroyed_at is null) then
    raise exception 'destination does not exist';
  end if;
  select location_id into v_old from objects where id = p_what;
  update objects set location_id = p_dest where id = p_what;  -- cycle trigger guards
  if v_old is not null then
    insert into world_events (room_id, kind, actor_id, text)
    values (v_old, 'depart', p_what, '');
  end if;
  insert into world_events (room_id, kind, actor_id, text)
  values (p_dest, 'arrive', p_what, '');
  insert into object_audit (actor_id, action, target_id, detail)
  values (p_actor, 'move', p_what, coalesce(v_old::text, 'nowhere') || ' -> ' || p_dest::text);
end $$;

-- Soft destruction (GM-R9): recoverable within a window. Refuse destroying
-- Limbo/God or a non-empty container.
create or replace function public._world_destroy(p_actor uuid, p_target uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_dbref bigint;
begin
  if not _world_controls(p_actor, p_target) then
    raise exception 'permission denied: you do not control that object';
  end if;
  select dbref into v_dbref from objects where id = p_target and destroyed_at is null;
  if v_dbref is null then
    raise exception 'no such live object';
  end if;
  if v_dbref in (0, 1) then
    raise exception 'the root room and god are indestructible';
  end if;
  if exists (select 1 from objects where location_id = p_target and destroyed_at is null) then
    raise exception 'object is not empty (move its contents first)';
  end if;
  update objects set destroyed_at = now() where id = p_target;
  insert into object_audit (actor_id, action, target_id, detail)
  values (p_actor, 'destroy', p_target, null);
end $$;

create or replace function public._world_recover(p_actor uuid, p_target uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_destroyed timestamptz;
  v_window bigint;
begin
  if not _world_controls(p_actor, p_target) then
    raise exception 'permission denied: you do not control that object';
  end if;
  select destroyed_at into v_destroyed from objects where id = p_target;
  if v_destroyed is null then
    raise exception 'object is not destroyed';
  end if;
  select (value #>> '{}')::bigint into v_window
    from app_settings where key = 'recovery_window_seconds';
  if now() - v_destroyed > make_interval(secs => v_window) then
    raise exception 'recovery window elapsed';
  end if;
  update objects set destroyed_at = null where id = p_target;
  insert into object_audit (actor_id, action, target_id, detail)
  values (p_actor, 'recover', p_target, null);
end $$;

-- =========================================================== public RPCs
-- The player-facing write surface. Each resolves the actor from the JWT and
-- refuses if the caller is not a signed-in player, then defers to the
-- internal op. anon cannot resolve a player, so anon cannot mutate.

create or replace function public.world_dig(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_player_id();
begin
  if v_actor is null then raise exception 'not signed in as a player'; end if;
  return _world_create_object(v_actor, 'room', p_name, null, null);
end $$;

create or replace function public.world_open(p_name text, p_source uuid, p_dest uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_player_id();
begin
  if v_actor is null then raise exception 'not signed in as a player'; end if;
  if not _world_controls(v_actor, p_source) then
    raise exception 'you must control the source room to open an exit there';
  end if;
  if not exists (select 1 from objects where id = p_source and type = 'room') then
    raise exception 'an exit''s source must be a room';
  end if;
  if p_dest is not null and not exists (select 1 from objects where id = p_dest and type = 'room') then
    raise exception 'an exit''s destination must be a room';
  end if;
  return _world_create_object(v_actor, 'exit', p_name, p_source, p_dest);
end $$;

create or replace function public.world_create(p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_player_id();
begin
  if v_actor is null then raise exception 'not signed in as a player'; end if;
  -- new things land in the builder's inventory (location = the player)
  return _world_create_object(v_actor, 'thing', p_name, v_actor, null);
end $$;

create or replace function public.world_set_attr(
  p_target uuid, p_name text, p_value text,
  p_visual boolean default false, p_no_inherit boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_player_id();
begin
  if v_actor is null then raise exception 'not signed in as a player'; end if;
  perform _world_set_attr(v_actor, p_target, p_name, p_value, p_visual, p_no_inherit);
end $$;

create or replace function public.world_set_lock(p_target uuid, p_type text, p_expr text)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_player_id();
begin
  if v_actor is null then raise exception 'not signed in as a player'; end if;
  perform _world_set_lock(v_actor, p_target, p_type, p_expr);
end $$;

create or replace function public.world_move(p_what uuid, p_dest uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_player_id();
begin
  if v_actor is null then raise exception 'not signed in as a player'; end if;
  perform _world_move(v_actor, p_what, p_dest);
end $$;

create or replace function public.world_destroy(p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_player_id();
begin
  if v_actor is null then raise exception 'not signed in as a player'; end if;
  perform _world_destroy(v_actor, p_target);
end $$;

create or replace function public.world_recover(p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_player_id();
begin
  if v_actor is null then raise exception 'not signed in as a player'; end if;
  perform _world_recover(v_actor, p_target);
end $$;

-- =========================================================== bootstrap
-- Genesis: Limbo (#0) and God (#1), the reference's reserved low dbrefs.
-- Idempotent — a no-op if a world already exists. Called by the seed.
create or replace function public.world_bootstrap()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_god uuid := gen_random_uuid();
  v_limbo uuid := gen_random_uuid();
begin
  if exists (select 1 from objects) then
    return;
  end if;
  insert into objects (id, type, name, owner_id)
  values (v_limbo, 'room', 'Limbo', v_god);            -- dbref 0
  insert into objects (id, type, name, owner_id, location_id, power, quota)
  values (v_god, 'player', 'God', v_god, v_limbo, 'god', null);  -- dbref 1
  insert into object_audit (actor_id, action, target_id, detail)
  values (v_god, 'bootstrap', v_limbo, 'Limbo #0 + God #1');
end $$;
