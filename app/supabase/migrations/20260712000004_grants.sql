-- Explicit grants (the local/default ACL for postgres-created objects gives
-- the API roles no table access and no function EXECUTE — good: access here
-- is deliberate, minimal, auditable). The grant is the outer gate; RLS is the
-- row gate. anon and authenticated get SELECT so a denied read returns ZERO
-- ROWS via RLS, never a permission error (the isolation contract). No table
-- write grants below service_role: every mutation is an RPC.

grant select on all tables in schema public to anon, authenticated;

-- the server plane (bootstrap, seed, the future engine commit path)
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- policy helpers run inside RLS evaluation for whoever queries — anon
-- included (they resolve to "no player" and yield zero rows)
grant execute on function public.current_player_id()       to anon, authenticated, service_role;
grant execute on function public.current_player_power()    to anon, authenticated, service_role;
grant execute on function public.current_player_location() to anon, authenticated, service_role;
grant execute on function public.is_wizard()               to anon, authenticated, service_role;
grant execute on function public.power_rank(text)          to anon, authenticated, service_role;

-- the player-facing write surface: signed-in players only (the RPCs check
-- the capability tier and refuse; anon cannot resolve a player, so cannot
-- even pass the first gate)
grant execute on function public.world_dig(text)                             to authenticated;
grant execute on function public.world_open(text, uuid, uuid)                to authenticated;
grant execute on function public.world_create(text)                          to authenticated;
grant execute on function public.world_set_attr(uuid, text, text, boolean, boolean) to authenticated;
grant execute on function public.world_set_lock(uuid, text, text)            to authenticated;
grant execute on function public.world_move(uuid, uuid)                      to authenticated;
grant execute on function public.world_destroy(uuid)                         to authenticated;
grant execute on function public.world_recover(uuid)                         to authenticated;

-- the internal ops + bootstrap are the server plane's (seed drives them to
-- exercise the RPC logic rather than INSERT around it)
grant execute on function public._world_controls(uuid, uuid)                 to service_role;
grant execute on function public._world_create_object(uuid, text, text, uuid, uuid) to service_role;
grant execute on function public._world_create_player(uuid, text, text, uuid, integer) to service_role;
grant execute on function public._world_set_attr(uuid, uuid, text, text, boolean, boolean) to service_role;
grant execute on function public._world_set_lock(uuid, uuid, text, text)     to service_role;
grant execute on function public._world_move(uuid, uuid, uuid)               to service_role;
grant execute on function public._world_destroy(uuid, uuid)                  to service_role;
grant execute on function public._world_recover(uuid, uuid)                  to service_role;
grant execute on function public.world_bootstrap()                           to service_role;
