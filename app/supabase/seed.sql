-- Seed a synthetic world shaped so isolation is TESTABLE: two rooms, players
-- at every capability tier, cross-room objects, a co-located non-owner, and
-- an attribute behind a read gate. It walks the RPC logic (the internal ops
-- with god as the actor) rather than INSERTing around it, so quota checks,
-- cycle guards, audit rows, and presence events all fire — the stratum
-- "seeds exercise the RPCs" gotcha. Objects are looked up by NAME in the
-- isolation test (dbrefs are deterministic here but names are the handle).

do $$
declare
  g uuid; town uuid; cave uuid;
  merlin uuid; alice uuid; bob uuid; cara uuid;
  lantern uuid; key uuid; broken uuid;
begin
  perform world_bootstrap();                       -- Limbo #0, God #1
  select id into g from objects where dbref = 1;    -- God

  -- rooms (#2, #3) — god builds them
  town := _world_create_object(g, 'room', 'Town Square', null, null);
  cave := _world_create_object(g, 'room', 'Dark Cave',   null, null);

  -- players across all four tiers (#4..#7); each owns itself
  merlin := _world_create_player(g, 'Merlin', 'wizard',  town, null);   -- wizard
  alice  := _world_create_player(g, 'Alice',  'builder', town, 50);      -- builder
  bob    := _world_create_player(g, 'Bob',    'builder', cave, 50);      -- builder (owns the key in the Cave)
  cara   := _world_create_player(g, 'Cara',   'player',  town, 50);      -- plain player, co-located with Alice's lantern

  -- exits (#8, #9): the spatial graph — Town <-> Cave
  perform _world_create_object(g, 'exit', 'north', town, cave);
  perform _world_create_object(g, 'exit', 'south', cave, town);

  -- things (#10, #11): the lantern sits in Town (co-located with Cara, a
  -- non-owner), the key sits in the Cave with Bob
  lantern := _world_create_object(alice, 'thing', 'a brass lantern', town, null);
  key     := _world_create_object(bob,   'thing', 'a rusty key',     cave, null);

  -- attributes behind the read gate: DESC is visual (any co-located viewer),
  -- SECRET is not (owner + wizard only) — the attribute-lock proof
  perform _world_set_attr(alice, lantern, 'DESC',   'A polished brass lantern.', true,  false);
  perform _world_set_attr(alice, lantern, 'SECRET', 'the vault code is 4771',    false, false);
  perform _world_set_attr(bob,   key,     'DESC',   'A small rusty key.',        true,  false);

  -- a boolean lock stored as data (GM-R8): pickup gated on a visible attr.
  -- Owner/wizard read it; peers do not.
  perform _world_set_lock(alice, lantern, 'pickup', 'DESC:*brass*');

  -- a pre-destroyed object so the proof can assert "only wizard/god see the
  -- bin": Alice destroys her own broken lamp (#12); afterwards she can no
  -- longer see it, Merlin (wizard) can.
  broken := _world_create_object(alice, 'thing', 'a broken lamp', town, null);
  perform _world_destroy(alice, broken);
end $$;
