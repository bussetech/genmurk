# Softcode meets the world (GENMURK-EPIC1-07)

The design record for the thing that makes a MUSE a MUSE: players attach
code to objects and the world runs it. Requirements: **GM-R11** ($-commands,
event triggers, the queue live in the world), **GM-R12** (wildcard dispatch),
**GM-R13** (styled output), under **GM-R14** (every mechanism below is
sandbox-shaped). Builds on the 03 engine (`app/docs/engine-design.md`), the
04 world model, the 05 transport, and the 06 dispatch pipeline
(`app/docs/command-dispatch.md`).

## 1. The shape of attached code

- **A `$`-command** is an attribute whose value is `$<pattern>:<program>`.
  The `$` sigil is requirement-of-record vocabulary (decomposition D3,
  backlog item 5); the `:` separator is provisional pending the GM-R22
  capture, like all argument punctuation. `<pattern>` is a GM-R12 wildcard
  pattern matched against the whole typed line; its captures become the
  program's substitution registers `%0..%9`.
- **An event trigger** is an attribute with a reserved name — `ON_ARRIVE`
  (movement into a room; the room and its co-located things listen) or
  `ON_USE` (a successfully entered thing) — holding a plain program. The
  enactor is bound as `%0` (display name) and `%1` (object id). These are
  GenMURK-internal names per the library naming law. **Drop-class triggers
  are documented, not built:** they arrive with the get/drop verb surface,
  which is capture-gated (GM-R22) and not in 06's shipped verb set.

## 2. The pipeline, extended (one metered branch)

```
typed line → parseCommand → dispatch
               • built-in verb        → budget-free server code (06)
               • no built-in claims it → $-command scan (metered match)
                                          → engine.runMany (SANDBOXED)
successful movement → dispatch fires triggers → engine.runMany (SANDBOXED)
engine output → buffered PendingEmits → coordinator.softcodeEmit
                (the ONE door onto the transport — 05's ordering domain)
journaled mutations → applied through the audited world_* RPCs (below)
```

`runSoftcodeBatch` in `src/server/dispatch.ts` is THE metered call: every
program runs through the engine's fair scheduler under
`SOFTCODE_RUN_BUDGET`, and softcode output enters each room's ordering
domain after the presence event that caused it — every observer orders
"Cara arrives" before what Cara's arrival triggered.

## 3. Precedence and scan rules (decided; requirements were silent)

- **Built-ins always win.** The `$`-scan only sees lines no built-in
  claims, so player softcode can never shadow `go`, `lock`, `quit`, … — an
  object in a room must never intercept another player's fixed verbs (the
  spoofing class). If the capture shows the reference allowed shadowing,
  that becomes a recorded divergence: the safe behavior wins (GM-R22 rule).
  Tested in both directions.
- **Scan scope is the typist's neighborhood:** the room they stand in, its
  co-located things (ascending dbref), then their inventory things
  (ascending dbref). Things and rooms carry `$`-commands; players and exits
  do not (v1). Attribute names are visited in sorted order.
- **First deterministic match fires — exactly one.** Single-fire bounds the
  amplification of one typed line; match multiplicity in the reference is a
  capture question, recorded as such.
- **Match work is metered.** The scan charges the engine's own `Meter`
  under a per-object allowance (`MATCH_STEPS_PER_OBJECT`): a hostile
  pattern set exhausts its OWN object's allowance (that object is skipped,
  fail-safe) and cannot deny `$`-commands to the rest of the room; a room
  full of hostile patterns costs a bounded scan, ever.

## 4. Attribution: runs AS the object, billed to the OWNER

A matched program (and every trigger program) runs with `actor` = the
object and `owner` = the object's owner (engine delta §10.9):

- **Permissions** are the object's — the second wall (`WorldModel`)
  re-checks every call, and an object controls only ITSELF beyond what its
  ownership grants (self-state is in; reaching into a co-located object is
  refused).
- **Budgets, queue depth, drain quota, and scheduler turns** are the
  owner's — a fleet of objects buys no extra share, and the enactor who
  tripped a hostile trigger is never billed and never punished (their
  session sees no error for someone else's refused program; a typist DOES
  see a typed `SOFTCODE_REFUSED` for the `$`-command they invoked).
- **Emits land in the nearest enclosing room** — a room speaks into itself,
  a thing into its room, a pocket gadget into its holder's room.

## 5. Mutations reach the world of record as the owner

On the real stack a run's journaled mutations apply through the OWNER's
JWT-scoped client (`applyMutations` — RLS + the RPC role checks stay the
final wall under softcode, exactly as under typed verbs). An owner with no
bound session has that run's mutations **skipped and counted, never
silently applied with elevated rights** — the offline-owner execution
principal is prompt 08's auth/capability work (see the 08 note in the
handoff). The proven live loop: the acceptance scenario's parlor applies a
softcode `setAttr` through its owner's session, asserted in Postgres.

## 6. Styled output (GM-R13): tokens on the wire, SGR at the edge

`src/server/style.ts`. Style travels as inert markup tokens
(`[[spec]]text[[/]]`, from `out.style` — the engine validates spec shape);
**every outbound frame is control-stripped at the one send door**
(`sanitizeOutbound` in `server.ts`), so no path — softcode emit, typed
line, RPC-written attribute — carries a raw escape byte to another client;
the CLIENT maps tokens to ANSI from a fixed SGR table (bold, dim,
underline, the classic 8 colors), dropping unknown or over-nested tokens
and always resetting at end of line. Asserted on raw wire bytes over real
sockets (`test/server/wire-sanitize.test.ts`) and on exact SGR bytes
(`test/unit/style.test.ts`). This is the transcript-sanitizer discipline
(ADR-0025 class) applied to player-generated output.

## 7. What is proven

- **Stack-free, in `npm test`:** `$`-dispatch end-to-end from a second
  player, precedence both directions, captures, scope, self-state, refusal
  surfacing (`test/server/softcode-command.test.ts`); triggers, attribution,
  the terminating trigger loop, the event storm, cross-owner blast radius
  (`test/server/triggers.test.ts`); fairness/liveness/ordering under seeded
  hostile load through the whole pipeline
  (`test/property/world-integrated.test.ts`); the style layer byte-exact.
- **Adversarial pack, world-integrated round:** fixtures 22 (cross-owner
  queue theft), 23 (A→B→A trigger chain loop), 24 (styled-output spec
  smuggling) — 24/24 green in both toy and real-world harness modes.
- **Real stack (`npm run test:building`):** the parlor scenario — wiring
  softcode through typed verbs, a second player's `$`-command, the arrival
  trigger firing through the queue, styled emit as tokens, and the
  journaled mutation applied via the owner's JWT, asserted in Postgres.

Clean-room note: everything above cites GM-Rn requirements and repo
vocabulary only; no reference source was consulted. Player-visible surface
questions ($-sigil punctuation, trigger multiplicity) are marked
provisional for the GM-R22 capture.
