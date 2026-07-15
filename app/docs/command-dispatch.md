# Command dispatch, building verbs & movement (GENMURK-EPIC1-06)

The design record for the player's hands: how a typed line becomes a world
change or a spoken word. Requirements: **GM-R6** (movement + presence),
**GM-R7** (building verbs), **GM-R12** (name matching), **GM-R8** (lock
gating), **GM-R22** (the compatibility harness, `app/gm-r22/`).

## 1. The pipeline

```
player input  →  parseCommand (src/server/verbs.ts)
              →  dispatch (src/server/dispatch.ts)
                   • speech/presence → RoomCoordinator (05's ordering domain)
                   • building/movement → WorldGateway → audited world_* RPCs
                   • movement additionally → coordinator.moveSession (presence)
```

`dispatch()` is transport-agnostic: it takes a `send` sink and a `disconnect`
signal, so the SAME pipeline runs under the live WebSocket server
(`server.ts`) and under the stack-free dispatch tests
(`test/server/dispatch.test.ts`). The server owns the connection, the auth
handshake, and per-session ordering (a promise chain so a `say` typed after a
`go` lands in the destination room); the dispatcher owns verb routing.

## 2. The budget boundary (GM-R14)

Built-in verbs are **ordinary code and budget-free**: dig/open/create/set/
name/describe/lock/go/enter/leave/look are fixed verbs the server implements,
not untrusted input, so no fuel meter runs. **Only softcode is fuel-metered**
— and as of GENMURK-EPIC1-07 that branch exists: a line no built-in claims
goes to the `$`-command scan, and matched programs (like event-trigger
programs) run through the sandboxed engine under `SOFTCODE_RUN_BUDGET`;
engine output reaches the transport ONLY through the world-API-mediated door
into each room's ordering domain. Keeping the two paths visibly separate —
one metered, one not — is the point. Design record for the metered side:
`app/docs/softcode-world.md`.

## 3. The gateway seam (world of record)

`WorldGateway` (`src/server/gateway.ts`) is the command layer's only door onto
the world. Two implementations behind one interface:

- **`SupabaseGateway`** — the real path. Every mutation is an audited
  `world_*` RPC called **as the actor** (a JWT-scoped client), so RLS + the
  RPC role checks stay the final wall. Reads/resolution use a per-command
  **snapshot** of the actor's neighborhood (`loadSnapshot`) fed through the
  same `WorldModel` the engine uses.
- **`FixtureGateway`** — a stack-free test double built on the same
  `WorldSnapshot` + `resolveName` + lock evaluator, so name matching and lock
  semantics have ONE source of truth. Only the creating verbs (dig/open/
  create/rename) are re-expressed in memory; the real RPCs remain the
  authority the acceptance scenario (`test/world/building.test.ts`) proves.

New world-of-record surface this prompt added: **`world_rename`**
(migration `20260714000005_rename.sql`) — GM-R7's "name" verb, the one
building RPC 04 had not shipped. Same audited shape as its siblings.

## 4. Name matching (GM-R12), and its scope

A typed target token → an object id reuses 04's `resolveName`: `me`, `here`,
`#dbref`, exact (case-insensitive) beats partial (substring) match, ambiguity
is reported. It is **neighborhood-scoped**: you can name-resolve only what is
in your loaded snapshot — self, your room and its contents, your inventory,
and **everything you own** (owned objects are always loaded). Two consequences
the build session exposes and the tests pin:

- A builder can name their freshly-dug rooms from anywhere (they own them),
  so opening exits **both ways between two owned rooms** works wherever they
  stand.
- A room you neither occupy nor own (e.g. God's Town Square, once you have
  stepped away into your Vault) is **not** name-resolvable. Referencing a
  distant unowned room by name fails with `NO_SUCH_ROOM`. Linking to arbitrary
  distant rooms by dbref is a documented later step (it needs a resolution
  path that does not go through the neighborhood snapshot).

### Tiebreaks decided where the requirement was silent

- **Partial match is substring, not prefix** (a plain `lantern` resolves
  `a brass lantern`). Carried from 04's `resolve.ts`; recorded as a GM-R22
  divergence candidate for the returning user.
- **Exit resolution for movement** is case-insensitive prefix over the room's
  exits (a short `go n` takes `north`), matching the exit-name convention;
  full `resolveName` is used for building-verb targets.

## 5. Building & who may build where (GM-R7 / GM-R15)

- `dig` requires the **builder** power (the RPC enforces it; the fixture
  mirrors it). `create` lands a thing in the builder's inventory. `set` /
  `describe` (sugar for the `DESCRIBE` attribute) / `name` / `lock` require
  **control** of the target (owner, or wizard+).
- **Opening an exit requires controlling the SOURCE room** (`world_open`). So a
  plain builder builds in rooms they dug and own; **wiring an exit from a
  shared room they do not own is a wizard act** in v1 (the seed itself has God
  build Town and Cave). Room build-permission flags — the reference's
  `JUMP_OK` / `LINK_OK` / `ABODE` class — that let a room owner delegate
  building are a documented later step, not invented here.

## 6. Movement & lock gating (GM-R6 / GM-R8)

- `go <exit>` resolves the exit in the current room, evaluates the **exit's
  `use` lock** in-snapshot (reusing the engine's lock evaluator), and only
  then calls `world_move` as the actor. A failed lock is a `LOCKED` refusal —
  no RPC is issued. `enter <thing>` / `leave` are containment moves, the
  thing's **`enter` lock** gating entry.
- **Which lock gates an exit** was silent in the requirement; decided: an
  exit's `use` lock gates its traversal. A destination room's own `enter` lock
  is DB-side defense-in-depth, a documented later step (consistent with
  `lifecycle.sql`'s existing note that DB-side lock eval is deferred).
- Presence: after a successful move the dispatcher calls
  `coordinator.moveSession`, which fans `depart` to the old room and `arrive`
  to the new — 05's single-writer ordering. The `world_move` RPC additionally
  writes `arrive`/`depart` to `world_events` (the durable record; the live
  order stays the coordinator's).

## 7. What is proven

- **Stack-free** (`test/server/dispatch.test.ts`, in `npm test`): routing,
  building, name matching, movement + presence, a lock refusal, the builder
  power gate.
- **Real stack** (`test/world/building.test.ts`, `npm run test:building`, a
  live-stack acceptance gate like the isolation proof): a scripted session
  digs two rooms, opens exits both ways, creates + locks a thing, has another
  player fail the lock, and moves so presence fires — all through Postgres,
  with the durable `world_events` rows asserted.
- **GM-R22 surface** (`npm run conformance`, in `npm test`): every shipped
  command routes to its declared behavior class; provenance is clean; the
  capture-pending state is loud.
