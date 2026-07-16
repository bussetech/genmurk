# The GenMURK world model (GM-R5..R10)

Design of record for the relational world model — the four object types and
their semantics (attributes, locks, ownership, containment, movement) on
Supabase/Postgres, with row-level security aligned to the capability model
(GM-R15) that prompt 08 enforces end to end. The reference's flat-file
*format* is not a requirement; its *semantics* are (GM-R10). Where GM-R5..R10
are silent, the call is recorded here and in the project `decisions.md`.

Built and proven in GENMURK-EPIC1-04. Companion to the engine design
(`engine-design.md`): this is the world the softcode engine's `WorldAPI` seam
reads and writes.

## 1. One object table, a type discriminator

`objects` holds room / exit / thing / player in one table (not four). Objects
are homogeneous in the reference and in the domain: one `#dbref` number space,
one attribute mechanism, one ownership rule, one lock mechanism, and movement
treats things and players identically. Type-specific shape is a set of CHECK
constraints keyed on the `type` discriminator (the eaap `role_scope_exact`
pattern), so the database — not app code — refuses a room with a location or a
non-player with an elevated power.

| column | meaning |
| --- | --- |
| `id` | internal uuid PK |
| `dbref` | the stable public id — the reference's `#N`, from a sequence; **allocated once, never reused**, even across soft-destruction/recovery (studio numbers law; GM-R5). Limbo is `#0`, God is `#1`, following the reference's reserved low dbrefs |
| `type` | room / exit / thing / player (immutable after creation) |
| `name`, `owner_id` | free-form name; owner is an object (a player). Players own themselves |
| `location_id` | where it sits: a room's contents point at the room; a thing/player in a container point at the container; an exit's location is its **source** room; rooms have none |
| `destination_id` | exits only: the room the exit leads to (nullable = unlinked) |
| `parent_id` | attribute-inheritance parent (GM-R9) |
| `power` | capability tier (GM-R15): `player` → `builder` → `wizard` → `god`; base for non-players |
| `quota` | max LIVE objects a player may own (GM-R9); null = unlimited (god) |
| `auth_user_id` | the RLS bridge to `auth.users` — set when a player is provisioned (GM-R18, prompt 08); `ON DELETE SET NULL` |
| `destroyed_at` | soft destruction (GM-R9): non-null = in the recovery bin |

The self-referential FKs (`owner`/`location`/`destination`/`parent`) are
`DEFERRABLE INITIALLY DEFERRED` so genesis (Limbo owned by a not-yet-inserted
God) and paired creates resolve at commit.

Attributes are a **typed table** (`object_attributes`), not a JSON blob:
individually addressable, with a per-attribute read gate (`visual`) and an
inheritance flag (`no_inherit`). Names are case-insensitive, stored canonical
uppercase. Values are strings — matching the engine's strings-only value
domain (GM-R11). Locks are a **data table** (`object_locks`): `pickup` /
`enter` / `use`, each an expression string the world-API evaluates (§4).

## 2. Movement and the presence-event seam

Movement (`world_move`) updates `location_id` — a trigger refuses containment
cycles (an object inside itself, directly or transitively) — and appends
`arrive`/`depart` rows to `world_events`, the presence/change **outbox**. A
room is a channel (`decisions.md` realtime note), so each event carries the
room it is visible in and a total order (`seq bigserial`). This is the seam
**prompt 05's transport** consumes (Supabase Realtime / a changes feed); it is
designed thin here and deliberately not wired to any transport (guardrail: no
transport in this prompt).

## 3. RLS + the grant matrix (deny by default)

Every table is deny-by-default. `anon`/`authenticated` get only `SELECT`; a
denied read is **zero rows via RLS, never a permission error** (the isolation
contract). No table has an INSERT/UPDATE/DELETE policy — every mutation goes
through an audited `SECURITY DEFINER` RPC that checks the capability tier and
writes an `object_audit` row. The service role (the server plane) bypasses RLS
but not the constraints and triggers.

Visibility, as built (a player sees the room they are in, not the database):

| table | who reads which rows |
| --- | --- |
| `objects` | wizard/god: all (incl. destroyed). Else, among LIVE objects: self, owned, the room I'm in, and whatever shares it (co-located things/players/exits) + my inventory |
| `object_attributes` | the object must be visible AND (the attr is `visual` \| I own the object \| wizard/god). A non-visual attr is a zero row to a co-located non-owner — "attribute reads gated by locks" |
| `object_locks` | owner + wizard/god only |
| `world_events` | events for the room I'm in; wizard/god all |
| `object_audit`, `app_settings` | wizard/god only |

Helper functions (`current_player_id/power/location`, `is_wizard`,
`power_rank`) are `SECURITY DEFINER` so policies read the caller's scope
without recursing through RLS.

### Capability tiers (GM-R15) — modeled now, enforced in 08

The `power` ladder is a column plus policy/RPC hooks. The mutation RPCs check
it today: building verbs (`world_dig`/`world_open`/`world_create`) require
`builder`+; player creation requires `god`; control (set attr/lock, move,
destroy, recover) requires ownership or `wizard`+. Prompt 08 wires the tiers to
the full player-facing command set and any remaining privileged verbs.

## 4. Boolean locks (GM-R8)

Locks are stored as data and evaluated by the world-API per action. Grammar (a
deliberately-bounded subset of the reference's boolean key language; where the
reference is richer the safe subset wins and the divergence is documented —
the GM-R14/R22 rubric):

```
expr    := or
or      := and ('|' and)*
and     := unary ('&' unary)*
unary   := '!' unary | primary
primary := '(' or ')' | '#'<dbref> | 'owner' '(' '#'<dbref> ')'
         | NAME ':' glob | 'true' | 'false'
```

- `#N` — passes if the actor **is** object `#N` or **carries** it (holds a key)
- `owner(#N)` — passes if the actor **owns** object `#N` (GM-R8's ownership
  predicate — GENMURK-EPIC1-09; a relationship a `#N` key cannot state)
- `NAME:glob` — passes if the actor's `NAME` attribute matches the glob (`*`/`?`)
- constants `true` / `false`

Evaluation is **bounded by construction** (GM-R14): the source is length-capped,
the parser refuses nesting past a depth cap, and every evaluated node spends one
unit of a step budget — so a hostile stored lock terminates fast and a
**malformed, over-nested, or budget-exhausting lock fails closed** (denies)
rather than throwing. The glob compiler is backtrack-free, so an `ATTR:*a*a*…`
predicate cannot go super-linear. The world-API exposes `canPickup` / `canEnter`
/ `canUse` hooks; an object with no lock of a kind is open (reference default).
Lock *gating* lives in the world-API (the engine evaluates locks); the DB
enforces the structural + capability invariants. A defense-in-depth DB-side lock
eval — for movement (`world_move`) and pickup (`world_get`) — is a documented
later option. Proof: `test/unit/world-lock.test.ts` +
`test/unit/world-lock-hostile.test.ts`.

## 5. Attribute inheritance (GM-R9)

Resolution order, tested in `test/unit/world-inherit.test.ts`:

1. An object's **own** attribute always wins — including a `no_inherit` one
   (`no_inherit` blocks passing *down*, not reading on self).
2. Otherwise walk the parent chain; the **first ancestor that has the
   attribute** decides: if that attribute is `no_inherit`, it is not inherited
   (resolves to "not found"); otherwise its value is inherited.
3. The walk is depth-bounded; the DB forbids parent cycles (trigger) as the
   primary guard, this is defense in depth.

## 6. The synchronous-seam resolution (world-API over a snapshot)

The engine's `WorldAPI` is **synchronous** — it cannot await a database round
trip inside the fuel-metered `evaluate()` loop. So a run works against a
**snapshot**: the actor's relevant slice of the world, loaded once
(`loadSnapshot`, service-role read so lock evaluation can see locks the actor
may not `SELECT`), read/written synchronously during the run, its buffered
`WorldMutation`s applied through the audited RPCs **as the actor** after the
run (`applyMutations`). `RunOutcome.mutations` is exactly that buffer. The
world-API re-checks GM-R15 control on every call — the **second wall** (the
engine sandbox is the first, RLS + the RPC role checks the third), so even a
mis-scoped snapshot cannot leak or write across ownership. This is the loop
05's transport and 08's command layer will drive; it is a designed, tested
seam here.

## 7. What is proven

- **Isolation proof** (`test/world/isolation.test.ts`, `npm run test:isolation`
  against a live local stack): signs in at every tier and asserts exact row
  counts — 30+ assertions spanning all four object types and four tiers
  (player/builder/wizard/god); cross-room reads are zero rows; the non-visual
  `SECRET` is a zero row to a co-located non-owner; wizard sees the bin and the
  audit trail. Anonymous sees nothing anywhere.
- **Lock semantics** (`test/unit/world-lock.test.ts`): the grammar evaluates
  through the world-API, allow and deny, and fails closed on malformed input.
- **Destroy → recover within window → recover-after-window refused**
  (isolation test, AC3), exercised through the real RPCs.
- **The engine test double swaps for the real world-API and the adversarial
  pack stays green** — `npm run proof:realworld` (21/21, budgets hold), plus a
  literal end-to-end run through Postgres in the isolation suite (AC4).

The isolation proof is a **local/stack acceptance gate** (the eaap precedent):
it is not in the stack-free `npm test` that the app CI job runs; a CI supabase
service could run it later.

## 8. Local stack

`supabase/config.toml` targets a free `5454x` port block (the default block is
held by another studio stack — the stratum port-collision gotcha). Signups are
disabled; accounts are operator/test-provisioned. `npm run db:reset` applies
the migrations (`schema → rls → lifecycle → grants`) and the seed, which walks
the RPC logic (god as actor) rather than INSERTing around it, so quota checks,
cycle guards, audit rows, and events all fire.
