-- GENMURK-EPIC1-09 — the faithful layer (GM-R8/R9/R16/R17): pickup/drop over
-- the pickup lock, in-world mail, and moderation with an audit trail. Additive
-- per the studio migration law — the shipped 01..07 migrations are untouched;
-- every function here is new or CREATE OR REPLACE, the audit vocabulary is
-- extended (never rewritten), and one nullable column is added to objects.
--
-- Framed per GD-0025: the reference's moderation, mail, and take/drop verbs are
-- honoured as what taught the domain; where the sandbox (GM-R14) or the studio
-- security model forces a difference, the safe behavior wins and it is
-- documented for the returning user (/compatibility/).

-- The audit vocabulary anticipated build/lifecycle acts; the faithful layer
-- adds take/drop (GM-R8/R6 containment moves) and the moderation acts (GM-R16).
-- Mail send is journaled too (who mailed whom, when — never the body).
alter table object_audit drop constraint object_audit_action_check;
alter table object_audit add constraint object_audit_action_check
  check (action in
    ('bootstrap','create','create_player','set_attr','set_lock',
     'move','destroy','recover','chown','set_power','rename','provision',
     'register','set_registration',
     'get','drop','warn','boot','silence','unsilence','mail'));

-- Moderation state (GM-R16): a silenced player may not speak until the window
-- elapses. Null = not silenced. Players only (a non-player carries no session).
alter table objects add column if not exists silenced_until timestamptz;

-- Operator-configurable faithful-layer settings (data, not magic numbers).
insert into app_settings (key, value) values
  ('mail_inbox_max', '100'),            -- GM-R17 quota: max live messages per inbox
  ('silence_default_minutes', '60')     -- GM-R16 default silence window
on conflict (key) do nothing;

-- =========================================================== take / drop (GM-R8)
-- The pickup lock (GM-R8) gates taking a thing from the room; the drop returns
-- it. Following the 06 exit-`use` precedent, the boolean LOCK is evaluated on
-- the world-API (in-snapshot, the engine's evaluator) BEFORE these RPCs; the
-- RPC holds the STRUCTURAL wall — you may only take a live thing co-located in
-- your own room into your own hands, and only drop a thing you are holding into
-- the room you stand in. Defense-in-depth DB-side lock evaluation stays a
-- documented later step (dependency register), exactly as for exit locks.

create or replace function public._world_get(p_actor uuid, p_thing uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor objects;
  v_thing objects;
begin
  v_actor := _world_live_player(p_actor);
  if v_actor.id is null then
    raise exception 'no such acting player';
  end if;
  select * into v_thing from objects
    where id = p_thing and type = 'thing' and destroyed_at is null;
  if v_thing.id is null then
    raise exception 'no such thing to take';
  end if;
  if v_thing.location_id is distinct from v_actor.location_id then
    raise exception 'that is not here to take';
  end if;
  update objects set location_id = p_actor where id = p_thing;   -- into inventory
  insert into object_audit (actor_id, action, target_id, detail)
  values (p_actor, 'get', p_thing, 'pickup');
end $$;

create or replace function public._world_drop(p_actor uuid, p_thing uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor objects;
  v_thing objects;
begin
  v_actor := _world_live_player(p_actor);
  if v_actor.id is null then
    raise exception 'no such acting player';
  end if;
  if v_actor.location_id is null then
    raise exception 'you are nowhere to drop anything';
  end if;
  select * into v_thing from objects
    where id = p_thing and type = 'thing' and destroyed_at is null;
  if v_thing.id is null or v_thing.location_id is distinct from p_actor then
    raise exception 'you are not holding that';
  end if;
  update objects set location_id = v_actor.location_id where id = p_thing;  -- into the room
  insert into object_audit (actor_id, action, target_id, detail)
  values (p_actor, 'drop', p_thing, 'drop');
end $$;

create or replace function public.world_get(p_thing uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_player_id();
begin
  if v_actor is null then raise exception 'not signed in as a player'; end if;
  perform _world_get(v_actor, p_thing);
end $$;

create or replace function public.world_drop(p_thing uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_player_id();
begin
  if v_actor is null then raise exception 'not signed in as a player'; end if;
  perform _world_drop(v_actor, p_thing);
end $$;

-- =========================================================== in-world mail (GM-R17)
-- Player-to-player mail: durable until the recipient deletes it (no auto-expiry
-- in v1 — decisions.md). Quota-aware (a bounded inbox) and moderation-visible
-- (wizard/god may read any message; the body is never journaled). A silenced
-- player may not send (moderation applies to mail as to speech).
create table if not exists mail (
  id                bigserial primary key,
  sender_id         uuid not null references objects(id),
  recipient_id      uuid not null references objects(id),
  subject           text not null default '' check (length(subject) <= 128),
  body              text not null check (length(body) between 1 and 4096),
  sent_at           timestamptz not null default now(),
  read_at           timestamptz,                       -- null = unread
  recipient_deleted boolean not null default false     -- soft delete by recipient
);
create index if not exists mail_recipient on mail (recipient_id, sent_at)
  where recipient_deleted = false;

alter table mail enable row level security;

-- A message is readable by its sender, its (non-deleting) recipient, or any
-- wizard/god (GM-R16 moderation visibility). anon resolves to no player → none.
create policy mail_read on mail for select using (
  public.is_wizard()
  or sender_id = public.current_player_id()
  or (recipient_id = public.current_player_id() and recipient_deleted = false)
);

create or replace function public.world_mail_send(p_to uuid, p_subject text, p_body text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_actor objects;
  v_to objects;
  v_live int;
  v_cap int;
  v_id bigint;
begin
  v_actor := _world_live_player(current_player_id());
  if v_actor.id is null then
    raise exception 'not signed in as a player';
  end if;
  if v_actor.silenced_until is not null and v_actor.silenced_until > now() then
    raise exception 'you are silenced and cannot send mail';
  end if;
  select * into v_to from objects
    where id = p_to and type = 'player' and destroyed_at is null;
  if v_to.id is null then
    raise exception 'no such player to mail';
  end if;
  if p_body is null or length(btrim(p_body)) = 0 then
    raise exception 'a message may not be empty';
  end if;
  -- quota (GM-R17): the recipient's live inbox is bounded.
  select (value #>> '{}')::int into v_cap from app_settings where key = 'mail_inbox_max';
  select count(*) into v_live from mail
    where recipient_id = p_to and recipient_deleted = false;
  if v_cap is not null and v_live >= v_cap then
    raise exception 'recipient mailbox is full';
  end if;
  insert into mail (sender_id, recipient_id, subject, body)
  values (v_actor.id, p_to, coalesce(left(p_subject, 128), ''), p_body)
  returning id into v_id;
  -- journal the ACT (who mailed whom, and the subject) — never the body.
  insert into object_audit (actor_id, action, target_id, detail)
  values (v_actor.id, 'mail', p_to, coalesce(nullif(btrim(p_subject), ''), '(no subject)'));
  return v_id;
end $$;

create or replace function public.world_mail_mark_read(p_mail bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_player_id();
begin
  if v_actor is null then raise exception 'not signed in as a player'; end if;
  update mail set read_at = coalesce(read_at, now())
   where id = p_mail and recipient_id = v_actor and recipient_deleted = false;
  if not found then raise exception 'no such message in your inbox'; end if;
end $$;

create or replace function public.world_mail_delete(p_mail bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_player_id();
begin
  if v_actor is null then raise exception 'not signed in as a player'; end if;
  update mail set recipient_deleted = true
   where id = p_mail and recipient_id = v_actor and recipient_deleted = false;
  if not found then raise exception 'no such message in your inbox'; end if;
end $$;

-- =========================================================== moderation (GM-R16)
-- Wizard+ tooling: warn, boot (a transport disconnect — the RPC records the
-- act, the coordinator performs it), and silence/unsilence. Every act is
-- journaled through object_audit (who/what/when/why), the same audit trail the
-- world mutations use. God #1 is never a moderation target, and a wizard may
-- not moderate an equal-or-higher tier (only a god may reach a wizard) — so the
-- tooling cannot be turned sideways or upward (decisions.md).

create or replace function public._world_moderation_target(p_actor objects, p_target uuid)
returns objects language plpgsql stable security definer set search_path = public as $$
declare v_t objects;
begin
  select * into v_t from objects
    where id = p_target and type = 'player' and destroyed_at is null;
  if v_t.id is null then
    raise exception 'no such live player to moderate';
  end if;
  if v_t.dbref = 1 then
    raise exception 'God #1 may not be moderated (root authority)';
  end if;
  if power_rank(p_actor.power) < 4
     and power_rank(v_t.power) >= power_rank(p_actor.power) then
    raise exception 'you may not moderate an equal or higher tier';
  end if;
  return v_t;
end $$;

create or replace function public.world_warn(p_target uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor objects;
begin
  v_actor := _world_require_power(current_player_id(), 3);   -- wizard+
  perform _world_moderation_target(v_actor, p_target);
  insert into object_audit (actor_id, action, target_id, detail)
  values (v_actor.id, 'warn', p_target, coalesce(nullif(btrim(p_reason), ''), '(no reason given)'));
end $$;

create or replace function public.world_boot(p_target uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor objects;
begin
  v_actor := _world_require_power(current_player_id(), 3);   -- wizard+
  perform _world_moderation_target(v_actor, p_target);
  -- the disconnect itself is the coordinator's (transport plane); this records
  -- the moderation act durably regardless of whether a session is connected.
  insert into object_audit (actor_id, action, target_id, detail)
  values (v_actor.id, 'boot', p_target, coalesce(nullif(btrim(p_reason), ''), '(no reason given)'));
end $$;

create or replace function public.world_silence(p_target uuid, p_minutes int, p_reason text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v_actor objects;
  v_mins int;
  v_until timestamptz;
begin
  v_actor := _world_require_power(current_player_id(), 3);   -- wizard+
  perform _world_moderation_target(v_actor, p_target);
  if p_minutes is not null and p_minutes > 0 then
    v_mins := p_minutes;
  else
    select (value #>> '{}')::int into v_mins from app_settings where key = 'silence_default_minutes';
    v_mins := coalesce(v_mins, 60);
  end if;
  v_until := now() + make_interval(mins => v_mins);
  update objects set silenced_until = v_until where id = p_target;
  insert into object_audit (actor_id, action, target_id, detail)
  values (v_actor.id, 'silence', p_target,
          v_mins::text || 'm: ' || coalesce(nullif(btrim(p_reason), ''), '(no reason given)'));
  return v_until;
end $$;

create or replace function public.world_unsilence(p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_actor objects;
begin
  v_actor := _world_require_power(current_player_id(), 3);   -- wizard+
  perform _world_moderation_target(v_actor, p_target);
  update objects set silenced_until = null where id = p_target;
  insert into object_audit (actor_id, action, target_id, detail)
  values (v_actor.id, 'unsilence', p_target, null);
end $$;

-- =========================================================== grants
-- Player-facing verbs → authenticated (the RPCs resolve the actor from the JWT
-- and check capability/structure). Internal ops → service_role.
-- migration 04's blanket grants predate this table, so grant explicitly: the
-- server plane (service_role) reads inboxes for the recipient; anon/authenticated
-- get SELECT so the mail_read RLS policy (recipient/sender/wizard) is the gate.
grant select on mail to anon, authenticated;
grant all on mail to service_role;
grant usage, select on sequence mail_id_seq to service_role;

grant execute on function public._world_get(uuid, uuid)              to service_role;
grant execute on function public._world_drop(uuid, uuid)             to service_role;
grant execute on function public.world_get(uuid)                     to authenticated;
grant execute on function public.world_drop(uuid)                    to authenticated;

grant execute on function public.world_mail_send(uuid, text, text)   to authenticated;
grant execute on function public.world_mail_mark_read(bigint)        to authenticated;
grant execute on function public.world_mail_delete(bigint)           to authenticated;

grant execute on function public._world_moderation_target(objects, uuid) to service_role;
grant execute on function public.world_warn(uuid, text)              to authenticated;
grant execute on function public.world_boot(uuid, text)              to authenticated;
grant execute on function public.world_silence(uuid, int, text)      to authenticated;
grant execute on function public.world_unsilence(uuid)               to authenticated;
