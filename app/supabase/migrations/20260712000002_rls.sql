-- Row-level security: authorization is enforced at the data layer and is
-- provable (the isolation proof, test/world/isolation.test.ts, is a v1
-- acceptance gate). Deny-by-default. A player sees the room they are in and
-- what shares it — not the database. A cross-room read returns ZERO ROWS,
-- not an error; anonymous sees nothing anywhere. The capability tiers
-- (GM-R15) are modeled here (the `power` column + these policy hooks) and
-- enforced end-to-end on every privileged verb in prompt 08.

-- Helper functions are SECURITY DEFINER so policy evaluation reads the
-- caller's own scope without recursing through RLS. They expose only the
-- signed-in player's own id / power / location. Used by the policies below
-- AND by the lifecycle RPCs (migration 03), so they are defined first.

create or replace function public.current_player_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from objects
   where auth_user_id = auth.uid() and type = 'player' and destroyed_at is null
$$;

create or replace function public.current_player_power()
returns text language sql stable security definer set search_path = public as $$
  select power from objects
   where auth_user_id = auth.uid() and type = 'player' and destroyed_at is null
$$;

create or replace function public.current_player_location()
returns uuid language sql stable security definer set search_path = public as $$
  select location_id from objects
   where auth_user_id = auth.uid() and type = 'player' and destroyed_at is null
$$;

create or replace function public.is_wizard()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.current_player_power() in ('wizard','god'), false)
$$;

-- Total order on the capability ladder, for the RPC role checks (GM-R15).
create or replace function public.power_rank(p text)
returns int language sql immutable as $$
  select case p
           when 'player'  then 1
           when 'builder' then 2
           when 'wizard'  then 3
           when 'god'     then 4
           else 0
         end
$$;

-- Anon must be able to EXECUTE the policy helpers (they resolve to "no
-- player" and yield zero rows) — the grant migration grants that.

-- ------------------------------------------------------------ enable RLS

alter table objects           enable row level security;
alter table object_attributes enable row level security;
alter table object_locks      enable row level security;
alter table world_events      enable row level security;
alter table object_audit      enable row level security;
alter table app_settings      enable row level security;

-- ----------------------------------------------------------------- objects

-- A player sees: everything (wizard/god); else, among LIVE objects — itself,
-- objects it owns, the room it is in, and whatever shares that room (things,
-- players, exits). Destroyed objects are visible only to wizard/god (for
-- recovery). current_player_id()/location() are null for anon, so every
-- comparison is null → anon sees nothing.
create policy objects_read on objects for select using (
  public.is_wizard()
  or (destroyed_at is null and (
        id = public.current_player_id()
        or owner_id = public.current_player_id()
        or id = public.current_player_location()
        or location_id = public.current_player_location()
  ))
);

-- -------------------------------------------------------------- attributes

-- Readable only if the OBJECT is visible (the sub-select rides objects' own
-- RLS, so an invisible object yields zero rows here too) AND the attribute's
-- read gate opens: visual to anyone who sees the object, non-visual only to
-- the owner and wizard/god.
create policy attrs_read on object_attributes for select using (
  exists (select 1 from objects o where o.id = object_attributes.object_id)
  and (
    visual
    or public.is_wizard()
    or exists (
      select 1 from objects o
       where o.id = object_attributes.object_id
         and o.owner_id = public.current_player_id())
  )
);

-- ------------------------------------------------------------------- locks

-- Lock expressions are owner/wizard metadata (they can encode who holds a
-- key). The world-API evaluates them server-side; players do not read peers'
-- locks.
create policy locks_read on object_locks for select using (
  public.is_wizard()
  or exists (
    select 1 from objects o
     where o.id = object_locks.object_id
       and o.owner_id = public.current_player_id())
);

-- ------------------------------------------------------------ world events

-- Presence/change feed: a player reads events for the room they are in;
-- wizard/god read all. (Prompt 05's transport reads this server-side.)
create policy events_read on world_events for select using (
  public.is_wizard()
  or room_id = public.current_player_location()
);

-- ------------------------------------------------------------------- audit

create policy audit_read on object_audit for select using (public.is_wizard());

-- ------------------------------------------------------------- app settings

create policy settings_read on app_settings for select using (public.is_wizard());

-- No INSERT / UPDATE / DELETE policies exist on ANY table: players and
-- builders have no raw write path. Every mutation goes through the audited
-- SECURITY DEFINER RPCs in migration 03, which check the capability tier and
-- write the audit row. The service role (the server plane) bypasses RLS but
-- not the constraints and triggers.
