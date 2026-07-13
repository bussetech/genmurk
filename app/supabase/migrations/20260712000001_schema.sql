-- GenMURK world model — schema (GM-R5..R10). The reference's flat-file
-- *format* is not a requirement; its *semantics* are (GM-R10): four object
-- types with stable identity, an owner, and a free-form attribute map;
-- a spatial graph of rooms/exits with location and containment; boolean
-- locks stored as data; ownership, quotas, parent inheritance; recoverable
-- soft destruction. Durability and concurrent writers are Postgres's job.
--
-- One table with a type discriminator, not four (decisions.md): objects are
-- homogeneous in the reference and in the domain — one dbref space, one
-- attribute mechanism, one ownership rule, one lock mechanism, and movement
-- treats things and players identically. Type-specific shape is enforced by
-- CHECK constraints keyed on the discriminator, the eaap `role_scope_exact`
-- pattern. Where GM-R5..R10 are silent, the call is recorded in decisions.md.

create extension if not exists pgcrypto;

-- The stable public id space — the reference's `#dbref`. Numbers are
-- allocated once and NEVER reused, even across soft-destruction/recovery
-- (studio numbers-are-not-reused law; GM-R5 stable identity). The reference
-- recycled freed dbrefs from a garbage list; we modernize. Room #0 (Limbo)
-- and God #1 follow the reference's reserved low dbrefs.
create sequence object_dbref_seq start 0 minvalue 0;

create table objects (
  id             uuid primary key default gen_random_uuid(),
  dbref          bigint not null unique default nextval('object_dbref_seq'),
  type           text not null check (type in ('room','exit','thing','player')),
  name           text not null check (length(name) between 1 and 256),
  -- owner is itself an object (a player); players own themselves. The four
  -- self-referential FKs are DEFERRABLE so the bootstrap (Limbo owned by a
  -- not-yet-inserted God) and paired creates (open an exit + its room)
  -- resolve at commit.
  owner_id       uuid not null references objects(id) deferrable initially deferred,
  -- where the object sits: a room's contents have location = the room; a
  -- thing/player in a container have location = the container. Rooms have
  -- no location. Exits' location is their SOURCE room.
  location_id    uuid references objects(id) deferrable initially deferred,
  -- exits only: the room the exit leads to (nullable = an unlinked exit).
  destination_id uuid references objects(id) deferrable initially deferred,
  -- attribute inheritance parent (GM-R9, the reference's @parent).
  parent_id      uuid references objects(id) deferrable initially deferred,
  -- capability tier (GM-R15): owner(player) -> builder -> wizard -> god.
  -- Meaningful for players; non-players carry the base tier. Modeled now,
  -- enforced end-to-end in prompt 08.
  power          text not null default 'player'
                 check (power in ('player','builder','wizard','god')),
  -- object quota: max LIVE objects this player may own; null = unlimited
  -- (god). Enforced in the create RPC (GM-R9).
  quota          integer check (quota is null or quota >= 0),
  -- the auth principal bound to a player — the RLS bridge (auth.uid() ->
  -- player). Null until provisioned; GM-R18 registration is prompt 08+.
  -- ON DELETE SET NULL: retiring an auth account unlinks its player (the
  -- object persists), and re-provisioning is idempotent.
  auth_user_id   uuid unique references auth.users(id) on delete set null,
  -- soft destruction with a recovery window (GM-R9): destroyed_at set = in
  -- the bin, recoverable until the window elapses; null = live.
  destroyed_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- type-shape invariants (a database constraint, not a UI convention):
  constraint room_shape check (
    type <> 'room' or (location_id is null and destination_id is null)),
  constraint exit_shape check (
    type <> 'exit' or location_id is not null),
  constraint thing_shape check (
    type <> 'thing' or (location_id is not null and destination_id is null)),
  constraint player_shape check (
    type <> 'player' or (location_id is not null and destination_id is null)),
  -- non-players carry no elevated power, no quota, no auth binding:
  constraint power_players_only check (type = 'player' or power = 'player'),
  constraint quota_players_only check (type = 'player' or quota is null),
  constraint auth_players_only check (type = 'player' or auth_user_id is null),
  -- structural sanity (cycles of length 1); longer cycles are trigger-checked
  constraint no_self_location check (location_id is distinct from id),
  constraint no_self_parent   check (parent_id is distinct from id),
  constraint exit_not_to_self check (destination_id is distinct from id)
);

create index objects_owner    on objects (owner_id) where destroyed_at is null;
create index objects_location on objects (location_id) where destroyed_at is null;
create index objects_auth     on objects (auth_user_id) where auth_user_id is not null;
create index objects_type     on objects (type) where destroyed_at is null;

-- Free-form attribute map (GM-R5), as a TYPED table, not a JSON blob
-- (decisions.md): attributes are individually addressable, lock-flagged,
-- and inheritance-flagged; a blob would force whole-object reads and rewrites
-- and could not carry per-attribute read gates. Softcode values are strings
-- (GM-R11) — matching the engine's strings-only value domain.
create table object_attributes (
  object_id   uuid not null references objects(id) on delete cascade,
  -- attribute names are case-insensitive in the reference; stored canonical
  -- uppercase so the engine's dispatch/get is a plain key lookup.
  name        text not null check (name ~ '^[A-Z][A-Z0-9_]*$'),
  value       text not null default '',
  -- attribute-level read gate (GM-R8 predicates over attributes; the
  -- reference's `visual` flag): a non-visual attr is readable only by the
  -- object's owner and wizard/god; a visual attr by anyone who can see the
  -- object. "attribute reads gated by locks."
  visual      boolean not null default false,
  -- inheritance control (GM-R9): a no_inherit attr does not pass to children.
  no_inherit  boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (object_id, name)
);

-- Boolean locks (GM-R8), stored AS DATA — the world-API evaluates them
-- ("the engine evaluates them"). Three lock kinds gate the three actions the
-- requirement names: pickup (the reference's default/Basic lock), enter,
-- and use. The expression grammar is documented in docs/world-model.md.
create table object_locks (
  object_id   uuid not null references objects(id) on delete cascade,
  lock_type   text not null check (lock_type in ('pickup','enter','use')),
  expr        text not null check (length(expr) between 1 and 1024),
  updated_at  timestamptz not null default now(),
  primary key (object_id, lock_type)
);

-- Presence / change outbox (task 2 seam for prompt 05's transport). Movement
-- and emits append here; a room IS a channel (decisions.md realtime note),
-- so events carry the room they are visible in and a total order (seq).
-- 05 consumes this via Supabase Realtime / a changes feed — designed thin
-- now, deliberately not wired to any transport (guardrail: no transport yet).
create table world_events (
  seq         bigserial primary key,
  room_id     uuid not null references objects(id),
  kind        text not null check (kind in ('arrive','depart','emit')),
  actor_id    uuid references objects(id),
  text        text not null default '',
  created_at  timestamptz not null default now()
);
create index world_events_room_seq on world_events (room_id, seq);

-- Audit trail: every world mutation, with the acting object and detail. The
-- SECURITY DEFINER RPCs write here; raw table writes are not granted.
create table object_audit (
  id          bigserial primary key,
  actor_id    uuid references objects(id),
  action      text not null check (action in
                ('bootstrap','create','create_player','set_attr','set_lock',
                 'move','destroy','recover','chown','set_power')),
  target_id   uuid references objects(id),
  detail      text,
  at          timestamptz not null default now()
);
create index object_audit_target on object_audit (target_id, at);

-- Operator-configurable settings. The recovery window (GM-R9) and the
-- default per-player quota live here as data, not as magic numbers in code.
create table app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
insert into app_settings (key, value) values
  ('recovery_window_seconds', '604800'),  -- 7 days
  ('default_quota', '50');
