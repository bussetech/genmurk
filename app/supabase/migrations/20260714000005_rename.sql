-- GM-R7 building verb "name": rename an object. 04 shipped the rest of the
-- building surface (dig/open/create/set_attr/set_lock/move/destroy/recover)
-- but not a rename path — the command layer (GENMURK-EPIC1-06) needs one for
-- the `name <target> = <NewName>` verb. Same shape as the other audited RPCs:
-- the internal op takes an explicit actor and holds the control invariant
-- (GM-R15), the public wrapper resolves the actor from the JWT.
--
-- Only `name` is mutable here — `dbref` and `type` stay immutable
-- (enforce_object_immutability, GM-R5); renaming touches neither, and the
-- objects_touch trigger stamps updated_at as for any other update.

-- The audit action vocabulary (schema.sql) predates this verb; extend the
-- CHECK to admit 'rename' (additive migration — the shipped one is not edited).
alter table object_audit drop constraint object_audit_action_check;
alter table object_audit add constraint object_audit_action_check
  check (action in
    ('bootstrap','create','create_player','set_attr','set_lock',
     'move','destroy','recover','chown','set_power','rename'));

create or replace function public._world_rename(
  p_actor uuid, p_target uuid, p_name text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not _world_controls(p_actor, p_target) then
    raise exception 'permission denied: you do not control that object';
  end if;
  if p_name is null or length(btrim(p_name)) = 0 then
    raise exception 'a name may not be empty';
  end if;
  if not exists (select 1 from objects where id = p_target and destroyed_at is null) then
    raise exception 'no such live object';
  end if;
  update objects set name = p_name where id = p_target;
  insert into object_audit (actor_id, action, target_id, detail)
  values (p_actor, 'rename', p_target, p_name);
end $$;

create or replace function public.world_rename(p_target uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := current_player_id();
begin
  if v_actor is null then raise exception 'not signed in as a player'; end if;
  perform _world_rename(v_actor, p_target, p_name);
end $$;

grant execute on function public._world_rename(uuid, uuid, text) to service_role;
grant execute on function public.world_rename(uuid, text)        to authenticated;
