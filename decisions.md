---
layout: page
title: Architecture decisions
eyebrow: The build
description: "GenMURK's architecture decision log, in public — the settled calls (Supabase, Workers-class compute, the WebSocket presence transport, an apex PROD domain, and building our own softcode engine) and the one still open: the themed creative direction."
permalink: /decisions/
---

The build's architecture decisions, recorded in public as they're made. Most are
settled; the themed creative direction is still open. This is direction of
record, not a final blueprint — where a call hasn't been made, this page says
so. The source is public: read it at
[github.com/bussetech/genmurk](https://github.com/bussetech/genmurk).

## Settled

### Supabase is the default database
The running GenMURK world is stored in **Supabase (Postgres)** — the studio's
default for hosted apps of this kind. The four object types and their
attributes, locks, containment, and ownership (GM-R5..R10) are modeled
relationally, with row-level security aligned to the capability model (GM-R15).
The reference's bespoke flat-file format is not preserved; its *semantics* are.
*(Studio decision of record: ADR-0048.)*

### The world model: one object table, semantics not format
The relational world model (GM-R5..R10) is built and proven
(GENMURK-EPIC1-04; design of record: `app/docs/world-model.md`). The calls
made, including where GM-R5..R10 were silent:

- **One `objects` table with a type discriminator**, not four — objects are
  homogeneous (one dbref space, one attribute mechanism, one ownership rule,
  one lock mechanism; movement treats things and players identically).
  Type-specific shape is enforced by CHECK constraints keyed on `type`.
- **`#dbref` identity is allocated once and never reused**, even across
  soft-destruction/recovery (the reference recycled freed dbrefs; the studio
  numbers-are-not-reused law wins). Limbo `#0`, God `#1`.
- **Attributes are a typed table**, not a JSON blob (individually addressable,
  with a per-attribute `visual` read gate and a `no_inherit` flag). Names are
  case-insensitive, canonical uppercase.
- **Locks are stored as data**; the world-API evaluates a bounded boolean
  grammar (`#dbref` keys, `ATTR:glob`, `!`/`&`/`|`/parens, `true`/`false`);
  malformed locks fail closed. Lock *gating* is a world-API responsibility
  (the engine evaluates locks); the DB `world_move` holds the structural and
  capability invariants.
- **Inheritance** resolves own-attribute-wins, then the nearest ancestor that
  has it; a `no_inherit` ancestor attribute does not pass down.
- **All mutation is via audited `SECURITY DEFINER` RPCs**; no table carries a
  write policy below the service role. RLS is deny-by-default and a denied
  read is zero rows, never an error — proven by the isolation suite (every
  tier, exact counts).
- **Attribute reads are gated**: a non-visual attribute is invisible to a
  co-located non-owner (owner + wizard/god only).
- **The engine's synchronous `WorldAPI` is served over a loaded snapshot**;
  writes buffer as `RunOutcome.mutations` and commit through the RPCs after
  the run — this is what lets a Postgres-backed world satisfy the synchronous
  capability seam.

### Workers-class compute for PROD
The application runs on a **Workers-class runtime** (Cloudflare Workers) — the
studio's provider family for hosted apps — **not** on GitHub Pages. Pages hosts
*this documentation site only*. Real-time presence and push delivery (GM-R1 /
GM-R4) ride the settled presence transport (next entry): room = channel,
movement = channel switch.

### The presence transport: WebSocket, one writer per room
Real-time presence and speech (GM-R1..R4) ride **WebSocket with a
single-writer-per-room coordinator** — in PROD a Durable-Object-class
instance on the Workers-class runtime; in dev the identical coordinator class
in-process under a localhost-only Node harness. This settles the one
transport choice left open above (UAT risk R7), decided on four criteria:

- **Ordering (GM-R4):** every room-scoped event — speech, presence,
  broadcast, softcode output — passes through one synchronous fan-out choke
  point that assigns the room's monotonic sequence and delivers in the same
  pass; per-connection delivery is FIFO. All observers of a room see the
  identical order **by construction, not reconciliation** — proven by an
  automated test racing concurrent speakers on separate sockets, 50 rounds
  per CI run, plus movement interleaved with speech (one ordering domain).
  Order *across* rooms is deliberately undefined; that per-room domain is
  what lets one-coordinator-per-room sharding scale PROD later without
  changing the guarantee.
- **Lifecycle:** Durable-Object-class actors are the sanctioned home for
  long-lived WebSocket state on the chosen runtime; their single-threaded
  execution model is exactly the property the ordering guarantee rests on.
- **Cost:** dev-tier cost is zero (localhost harness, nothing hosted — the
  GM-R14 gate stands); the PROD implication (Durable Objects need the
  Workers paid plan; coordinator region pinning) is registered as an EPIC5
  provisioning note, not built here.
- **The sandbox boundary (GM-R14):** the transport must not become a second
  capability surface for softcode. Server-owned WebSocket means clients hold
  no publish primitive, and softcode's only door is `WorldAPI.emit` —
  buffered during the run, routed room-scoped by the server after it. The
  engine never holds a socket or channel; escape is absent, not denied, and
  a boundary test asserts it.

**Rejected: Supabase Realtime** — no cross-publisher total order per channel
(GM-R4 would live in a reconciliation layer, i.e. in hope); its channels are
a client-addressable publish primitive (a second capability surface); and
the idiomatic client-direct shape takes the server plane out of the delivery
path. **Rejected: hybrid** (Realtime fan-out reconciled against the durable
event log) — two delivery paths that can disagree are a split brain, and the
reconciliation logic *is* a coordinator; build the coordinator, skip the
second path. The `world_events` table stays the **durable** presence record
(the audited movement RPC writes it; wizard-auditable, replay-capable);
live delivery does not tail it, and ephemeral speech is not persisted in v1
(privacy- and cost-conservative — directed messages especially). Engineering
record: `app/docs/presence-transport.md`. *(GENMURK-EPIC1-05.)*

### An apex PROD domain on its own DNS zone
The running app claims its own registered apex, **`genmurk.com`**, separate from
this build log at `genmurk.bussetech.com`. That apex is a **second DNS zone**
under the studio's DNS steward — a project may own its apex PROD domain. The
apex standup and the multi-zone steward are platform EPIC5 work. *(Studio
decision of record: ADR-0049.)*

### Two surfaces, never conflated
This Pages site is **documentation, not PROD.** The build log and the running
app are different provider-family configurations and even different domains; the
app is never deployed to these Pages, and this site never carries runtime
secrets — it is secrets-free by construction.

### We build our own softcode engine
The user-programmable softcode runtime (GM-R11 / GM-R14) will be **the studio's
own purpose-built interpreter** — not a wrapper around an off-the-shelf VM.
Company direction (STEERCO): building the engine ourselves flexes the studio's
own engineering muscle where it matters most, and keeps the sandbox — the hard
requirement — enforced *natively* rather than inherited from someone else's
runtime. The sandbox (GM-R14) is unchanged and non-negotiable: hard
CPU/step/recursion/queue budgets, no host/network/filesystem access, all
softcode treated as untrusted input, proven against an adversarial fixture pack
before anything hosted ships. This is the highest-risk, highest-value piece of
the build, so it leads the [backlog](/backlog/).

**Why it matters beyond v1.** A softcode engine we own is a foundation we can
grow into. One day the studio's own **gnomes may live in-MURK** — present in the
world, building things inside it through the softcode the same way a player
would. Owning the engine end to end is what makes that possible; a borrowed VM
would not.

### How we build it: a metered AST-walker, sandboxed by construction
The engine (GM-R11 / GM-R14) is a **tree-walking interpreter in TypeScript**,
running inside the same Workers-class isolate as the server — not a bytecode VM
(for v1), and (per the decision above) not a wrapper around any off-the-shelf
VM. On Workers-class compute there is no OS-level isolation to lean on, so the
sandbox lives in the interpreter's own structure: a single `evaluate()` choke
point charges a **fuel** budget before doing any work, which makes *no
unmetered work* an auditable property of one function. The budgets are
**first-class values** — per-invocation steps (fuel), recursion depth, queue
enqueue/depth ceilings with fair per-owner scheduling, an allocation
byte-account, and a wall-clock backstop — each enforced by mechanism, not
intention. Escape is *absent, not denied*: the interpreter's world holds only
string values and the world-model API handle it is given; no host, network,
filesystem, or import capability exists to reach for. The engine seam
(`app/src/engine/types.ts`) is kept so a faster implementation can replace the
walker post-v1 behind the same interface and the same proof. Design of record:
**`app/docs/engine-design.md`**; the v1 function-library contract:
**`app/docs/function-library-v1.md`**. *(GENMURK-EPIC1-02 engine spike.)*

### The sandbox is proven by an adversarial harness, wired as the CI gate
GM-R14 is enforced by an **adversarial fixture pack** — hostile programs as
data (infinite loops, fork bombs, allocation bombs, recursion, injection,
escape attempts, budget-boundary probes) — run by a **proof harness** that
executes each fixture against any engine build in an isolated worker with an
external wall-clock watchdog, and emits a pass/fail table. The harness is wired
into the app CI job and runs on every engine change. As of GENMURK-EPIC1-03
the **real engine** (`src/engine/`, a metered AST-walker per the design
record) carries status **`candidate`**, so the job runs in **hard-gate mode
— and the table is GREEN** (21 fixtures, 8 attack classes, incl. two found
while building: a parser-nesting bomb and a match-backtracking bomb). That
green table is the recorded GM-R14 evidence this gate exists to produce.
The gate is standing, not historical: the pack only grows, every engine
change re-proves it, and nothing about GenMURK is hosted, exposed, or demoed
beyond localhost on the strength of a green table alone — hosted exposure
additionally needs its own authorization (EPIC5/STEERCO). The stub remains
for the harness's plumbing self-test. *(GENMURK-EPIC1-02 spike;
GENMURK-EPIC1-03 engine core.)*

### The app lives in this repo, under `app/`
The GenMURK application code is built **in this repo**, under `app/` — the
studio's standard SaaS-stratum app layout (`wrangler.toml`, `supabase/`,
`src/`, `test/`; ADR-0048) — with CI split into separate **site** and **app** jobs
and the Jekyll build excluding `app/` entirely. One repo keeps one occupancy
and provenance surface for the parallel-track build; the two-surfaces law is
about *deploy targets*, and it is unchanged — the app never deploys to these
Pages. The named alternative, a second repo via the studio factory, was argued
and declined for now: it is a founding act (registry, DNS, protection) that
buys nothing while the app is pre-PROD, and it remains available later as a
move, not a rewrite. *(Sysop ruling: platform#317, ruled 2026-07-12.)*

### End-user command-set compatibility (STEERCO minimum bar)
GenMURK supports **at minimum the same end-user command set** — player-facing
verb names and invocation syntax — as the TinyMUSE/MicroMUSE reference, so that
**historic users onboard with minimal relearning** (GM-R22). Company direction
(STEERCO): the returning-user experience is a first-class goal, not an
afterthought. What is preserved is the *surface* a player types; the
implementations are GenMURK's own clean-room code and the interpreter/security
model are modernized (GM-R11 / GM-R14). The **canonical command list is a
preservation task** — drawn from the behavioral reference and historic-user
knowledge, currently **airgapped** and tracked as its own issue; it is not
enumerated in this repo yet. Where a reference command would conflict with the
sandbox requirement (GM-R14), the safe behavior wins and the divergence is
documented for the returning user.

### Command dispatch: built-ins are budget-free, softcode is the metered path
The command dispatcher (`app/src/server/dispatch.ts`) routes a typed line to
one of two worlds. **Built-in verbs** — dig/open/create/set/name/describe/lock,
go/enter/leave/look, say/emote/page/whisper/announce — are **ordinary code and
carry no fuel budget**: they are fixed verbs the server implements, not
untrusted input. **Only softcode is fuel-metered** (GM-R14): a `$`-command
(prompt 07) matches in the same dispatcher and hands its program to the
sandboxed engine, whose output reaches the transport only through the
world-API-mediated door. The dispatcher never imports the engine and never
holds fuel — the metered/unmetered split is visible in the module graph.
Building/movement verbs reach the world of record ONLY through the audited
`world_*` RPCs, called as the actor, so RLS + role checks stay the final wall.
*(GENMURK-EPIC1-06; design of record `app/docs/command-dispatch.md`.)*

### Name matching is neighborhood-scoped (GM-R12)
A typed target resolves against the actor's loaded snapshot — self, room,
room contents, inventory, and **everything the actor owns** — using 04's
`resolveName` (`me`/`here`/`#dbref`/exact-beats-substring). You can therefore
name your freshly-dug rooms from anywhere (you own them), but a room you
neither occupy nor own is not name-resolvable; linking to arbitrary distant
rooms by dbref is a documented later step. **Where the requirement was silent:**
partial match is substring (not prefix), an exit's `use` lock gates its
traversal, and building-verb targets use full `resolveName` while movement uses
prefix matching over the room's exits. *(GENMURK-EPIC1-06.)*

### Building permission: exits are wired by whoever controls the source room
`world_open` requires **control of the source room** (GM-R15). So a plain
builder builds in rooms they dig and own; **wiring an exit from a shared room
they do not own is a wizard act** in v1 (the seed itself has God build Town and
Cave). The reference's room build-permission flags (`JUMP_OK`/`LINK_OK`/`ABODE`
class) that let a room owner delegate building are a documented later step, not
invented from model memory. GM-R7's `name` (rename) gained its audited RPC here
(`world_rename`), the one building verb 04 had not shipped.
*(GENMURK-EPIC1-06.)*

### GM-R22 compatibility is data-driven, and provisional until the capture lands
Command-set compatibility is measured by a **conformance harness**
(`app/gm-r22/`): the player-facing surface is DATA (`command-surface.yml`), a
runner drives each entry's syntax through the real parser and asserts its
behavior class, and coverage/gaps/divergences are reported with the airgapped
**capture (genmurk#9) status shown loudly**. Until the capture lands every
entry is provisional and its provenance MUST be a GM-Rn requirement of record —
the runner rejects any name traceable to neither the capture nor a requirement
(the clean-room line, enforced in CI). Divergences where the sandbox forces a
difference (GM-R14 wins) are recorded on the entry and rendered for returning
users at `/compatibility/`. *(GENMURK-EPIC1-06; harness README
`app/gm-r22/README.md`.)*

### $-command precedence: built-ins always win, softcode never shadows a fixed verb
Attribute-attached `$`-commands (an attribute valued `$<pattern>:<program>` —
the `$` sigil is requirement-of-record vocabulary, the `:` separator
provisional pending the capture) participate in dispatch **only for lines no
built-in claims**. Player softcode can therefore never intercept `go`, `lock`,
`quit`, … — an object in a room shadowing another player's fixed verbs is the
spoofing class, and the safe behavior wins (GM-R22's own rule); if the capture
shows the reference allowed shadowing, that becomes a recorded divergence.
**Where the requirements were silent, decided and tested:** the scan covers the
typist's neighborhood (room, co-located things, inventory things — players and
exits carry no `$`-commands in v1), visits candidates and attribute names in
deterministic order, fires **exactly one** first match, and the match work
itself is fuel-metered under a per-object allowance so one hostile pattern set
cannot deny `$`-commands to the rest of the room. *(GENMURK-EPIC1-07; design
of record `app/docs/softcode-world.md`.)*

### Softcode attribution: runs AS the object, billed to the object's OWNER
A matched `$`-command or event-trigger program executes with the OBJECT as its
acting principal (its permissions are the object's; an object additionally
controls itself, so attached code can keep state on its own object) and with
the object's OWNER as its budget principal: queue depth, drain quota, and
scheduler fairness all key on the owner (`RunRequest.owner`, engine design
§10.9). Consequences, both tested: an owner's fleet of objects multiplies
nothing, and cross-owner budget theft is structurally impossible — the enactor
who trips a hostile trigger is never billed and never punished, while a typist
IS shown the typed refusal of a `$`-command they invoked. Softcode emits land
in the **nearest enclosing room**. On the real stack a run's mutations apply
through the OWNER's JWT (RLS + RPC checks stay the final wall); an unbound
owner's mutations are skipped and counted — the offline-owner execution
principal is prompt 08's. *(GENMURK-EPIC1-07.)*

### Event triggers: ON_ARRIVE and ON_USE, through the queue, in v1
World events evaluate attached softcode through the engine's fair scheduler:
**arrival** into a room runs the room's and its co-located things' `ON_ARRIVE`
(after the presence event, so every observer orders the arrival before its
consequences), and **entering a thing** runs its `ON_USE`. The enactor is
bound as `%0` (name) / `%1` (id). Trigger refusals die quietly by design (the
enactor did not write the code). **Drop-class triggers are documented, not
built** — they arrive with the get/drop verb surface, which is capture-gated
(GM-R22) and outside 06's shipped verb set. Attribute names are
GenMURK-internal per the library naming law. *(GENMURK-EPIC1-07.)*

### Styled output (GM-R13): markup tokens on the wire, ANSI only at the client's fixed table
Style travels as inert tokens (`[[spec]]text[[/]]`, produced by `out.style`);
**every outbound frame is control-stripped at the single send door**, so no
path — softcode emit, typed line, RPC-written attribute — can carry a raw
escape byte into another player's client; the client renders tokens to SGR
from a fixed vocabulary (bold, dim, underline, the classic 8 colors), dropping
unknown or over-nested tokens and always resetting at line end. Proven on raw
wire bytes over real sockets. This is the transcript-sanitizer discipline
applied to player-generated output; growing the vocabulary is a data change,
never a pass-through. *(GENMURK-EPIC1-07; `app/src/server/style.ts`.)*

### Authentication: a verified Supabase Auth JWT, not a password on the wire
A player authenticates against **Supabase Auth** — the studio's sanctioned
identity service, whose password KDF is argon2/bcrypt-class (ADR-0048), a
modern replacement for the reference's era-normal fixed-salt DES hashing
(GM-R18; framed as the state of the art advancing, not the reference being
wrong). The connection layer's HELLO token is the resulting **access-token
JWT**: the server VERIFIES it and binds the session to the player object the
principal is linked to (`objects.auth_user_id`, the RLS bridge). The server
never handles a password, and the loudly-labelled 05 stub — the
un-credentialed `stub:<name>` binding — is deleted. A forged, expired, or
unbound token yields no session. *(GENMURK-EPIC1-08; GM-R18.)*

### No default credentials; first boot provisions god from the provider store
Nothing ships a god or wizard credential — not in the repo, seeds, fixtures, or
docs (grep-proven in CI by a credential leak-check). A freshly reset world
starts with God #1 present but UNBOUND; **first-boot provisioning** mints the
god auth account with a **rotated secret sourced from the provider store**
(`GENMURK_GOD_SECRET`; if absent it is generated and emitted once for the
operator to store, never persisted) and binds it — idempotently, and proven by
an automated fresh-stack login gate. Every credential lives in the provider
store, read at runtime (GM-R19). *(GENMURK-EPIC1-08; GM-R18/R19.)*

### Signup posture: open registration, gated by an optional instance passphrase
Registration has **three operator-chosen modes** (`app_settings.registration_mode`,
set by the god-only `world_set_registration`): **closed** (god-provisioned
only), **open** (anyone self-registers), and **passphrase** (anyone who presents
the one instance-wide passphrase). The passphrase is lightweight anti-spam
gatekeeping — a single shared secret per instance, stored **bcrypt-hashed**
(pgcrypto, the GM-R18 KDF class), never plaintext, never in the repo, checked
server-side **before any account is minted** (a wrong passphrase creates
nothing). A self-registered player is always **base tier** in Limbo #0 — one
player per account, no duplicate names — so registration never confers power.
A freshly provisioned instance **defaults to `passphrase` mode**: first-boot
sets it and emits the instance passphrase once (from
`GENMURK_REGISTRATION_PASSPHRASE` or generated), alongside the god secret — so
an instance comes up gated, neither wide open nor accidentally closed, and the
operator flips to `open`/`closed` with one `set-registration` command. (The
bare, un-provisioned DB row still reads `closed`; passphrase mode only means
something once a passphrase exists, which first-boot establishes.) Heavier abuse
controls (email verification, rate limiting, captcha) remain an ops-tail concern
for hosted exposure (dependency register); the passphrase is the v1 gate.
*(GENMURK-EPIC1-08.)*

### Softcode capability attribution: the object and its owner, never the enactor
Resolving the offline-owner question 07 left to 08: a world-attached program's
**acting authority is the object** it runs on (objects carry only the base
tier, so a program can touch only its own object and what its owner controls)
and its writes **commit under the object's OWNER's authority** — the JWT-scoped
RPC wall (`snapshot.applyMutations`). The player who trips a trigger (the
ENACTOR) contributes **data** — `%0` name, `%1` id — and **never authority**,
so a builder-owned object cannot wield wizard power even when a wizard sets it
off; the escalation is refused at the engine wall and again at the RPC wall
(both tested). An owner with **no live session** has that run's mutations
**skipped and counted** — never applied with elevated or service rights;
dropping a write loudly beats forging authority for it. A durable offline-owner
execution principal is deferred (dependency register). *(GENMURK-EPIC1-08;
GM-R15.)*

### Lock expressions: full ruled scope, bounded by construction (GM-R8)
The lock grammar reaches its full ruled scope with an **ownership predicate**
alongside the attribute one: `owner(#N)` passes when the actor *owns* object #N
— a relationship a `#N` key (you *are* or *carry* it) cannot state. The grammar
stays a **deliberately-bounded safe subset** (booleans, `#N`, `owner(#N)`,
`ATTR:glob`), and evaluation itself is now bounded three ways — source length,
nesting depth, and a per-evaluation step budget — so a hostile stored lock
terminates fast and **fails closed**; the glob compiler is backtrack-free.
Locks gate **use, enter, and pickup**, each per action. This satisfies GM-R8's
"attribute/ownership predicates" without giving softcode the engine's fuel
meter — a transport-plane evaluation that is safe by its own construction,
proven against a hostile-expression fixture pack. *(GENMURK-EPIC1-09;
`app/src/world/lock.ts`.)*

### Take & drop: the pickup lock's action, app-gated like exit locks (GM-R6/R8)
Picking a thing up (`get`) and setting it down (`drop`) are the actions the
pickup lock exists to gate. The pickup lock is evaluated on the **world-API
before the move** — the same discipline 06 set for exit `use` locks — and the
audited `world_get`/`world_drop` RPCs hold the **structural wall**: you may take
only a live thing co-located in your own room into your own hands, and drop only
what you hold into the room you stand in. An **unlocked** thing is takeable by
anyone co-located (the reference default-open). Defense-in-depth DB-side lock
re-evaluation stays a documented later step (dependency register), exactly as
for exit locks. *(GENMURK-EPIC1-09.)*

### Recoverable destruction UX: honest window, recover by number (GM-R9)
`destroy` soft-destroys a controlled object and **states the recovery window**
("recoverable with `undestroy #N` for N days"), so the user always knows how
long they have. `undestroy` takes a **`#dbref`, not a name**: a destroyed
object has left the actor's snapshot (RLS hides the recovery bin from
non-wizards), so naming a thing you can no longer see would be a fiction — the
number the destroy confirmation printed is the honest handle. The window and
the god/limbo guards live in the 04 RPCs, unchanged. *(GENMURK-EPIC1-09.)*

### In-world mail: durable, quota-bounded, moderation-visible (GM-R17)
Player-to-player mail is **durable until the recipient deletes it** (a soft
delete; no auto-expiry in v1 — a privacy/retention call recorded here, revisit
for hosted exposure). It is **quota-aware** — a recipient's live inbox is
capped (`app_settings.mail_inbox_max`), and sending to a full inbox refuses —
and **moderation-visible**: the mail RLS policy lets a wizard/god read any
message (the sender and recipient otherwise), while the **body is never
journaled** (the audit records only who mailed whom, and the subject).
Addressing is **global** by player name or `#dbref` (mail crosses rooms, unlike
neighborhood-scoped building targets). A **silenced** player cannot send mail.
v1 mail is **body-only from the command line**; the reference's subject-line
syntax is a capture question (the RPC carries a subject for later).
*(GENMURK-EPIC1-09.)*

### Moderation: audited, tier-gated, and it only reaches down (GM-R16)
Wizard+ moderation is **warn / boot / silence / unsilence**, and every act is
**journaled to `object_audit`** (who, what, when, why) — the same audit trail
the world mutations use, asserted by the v1 slice. Three guards make the tooling
un-abusable: **God #1 is never a target**, a wizard **may not moderate an
equal-or-higher tier** (only a god reaches a wizard), and the gate is the one
capability seam (`_world_require_power`). **Silence** is DB-durable
(`objects.silenced_until`) *and* applied to live sessions immediately, and gates
**speech and mail**; **boot** is a transport disconnect — the RPC records the
act durably, the coordinator performs the drop (firing departure presence).
*(GENMURK-EPIC1-09; the safe-behavior-wins divergences are on `/compatibility/`.)*

### The v1 playable vertical slice is the epic's integration acceptance
The whole epic is proven by **one scripted multi-client scenario** on the full
local stack — register/login → walk & talk → build & lock → a `$`-command
another player triggers → page & mail → a wizard moderates → destroy/undestroy —
green end to end through Postgres, with the **moderation audit trail asserted**.
It runs as the **`v1-slice` CI job** (Supabase stood up on the runner, the same
`setup-cli` discipline as the isolation gate), and localhost-only: the stack
lives and dies on the runner, nothing is hosted. The adversarial and property
suites, the isolation/building/escalation/first-boot/registration gates, and the
conformance harness all stay green alongside it — the gates never came off.
*(GENMURK-EPIC1-09; `app/test/world/slice.test.ts`.)*

### GM-R22 compatibility: full verb surface swept, capture still the hard gate
The conformance harness now covers the **entire player-facing verb surface**
(25/25 entries, every one provisional and traced to a GM-Rn requirement), with
the capture-pending banner loud and five recorded divergences (all GM-R14
safe-behavior-wins). **The canonical TinyMUSE/MicroMUSE capture (genmurk#9) has
still not landed**, so real reference coverage cannot be measured and **v1
cannot claim the STEERCO minimum bar**; #9 is escalated to `needs-human`, and
the epic close (10) must state this plainly. *(GENMURK-EPIC1-09.)*

### GM-R22 capture landed: real coverage against the player-facing bar
The canonical capture (genmurk#9) — the reference parser's **140 built-in
commands** — has been reviewed and dropped in as data (`command-surface.yml`).
Coverage is now REAL, not provisional. **The bar is the player-facing set**:
the 53 entries (`tier: player` everyday verbs + `tier: builder` construction/
operator verbs), 50 traced to a reference command (`reference_tag:
capture:<handler>`) + 3 GenMURK moderation-model verbs (GM-R16). The remaining
**90 reference commands are out of the bar** — the wizard/god
server-and-database administration set (`excluded_admin` 85, e.g. @nuke/
@shutdown/@dbck), channels (`excluded_channels` 3), economy (`excluded_economy`
2) — accounted, **not reproduced as in-world verbs** (server control is
dev-tier ops GM-R19 / the Studio Portal). The runner ASSERTS traced + excluded
= 140, so the denominator can't be quietly gamed. Round-1 coverage: **32/53
(60.4%)** — player 18/34, builder 14/19 — up from **12/53 (22.6%)** measured
with the EPIC1 parser (the lift is mostly the faithful-form reconciliation
below). **The minimum bar is NOT met**; round-2 gap list ranked in the handoff.
*(GENMURK-EPIC2-02; harness `app/gm-r22/`.)*

### Command-surface reconciliations: faithful prefixed forms, bare kept convenient
The capture forced three surface reconciliations, decided and recorded on the
entries + `/compatibility/`:
- **`@`-prefix on building/admin verbs** (`@dig`, `@open`, `@lock`, `@destroy`,
  `@announce`, `@boot`, …): GenMURK **accepts the faithful `@` form** (the
  parser strips a leading `@` for any verb it implements) **and keeps the bare
  form as a documented convenience**. An unimplemented prefixed verb (`@nuke`)
  falls through to `unknown` — an honest gap, never a silent alias.
- **`+mail`**: the faithful mail form is accepted; bare `mail` kept convenient.
- **Speech**: the faithful verb is **`pose`** with the single-char tokens `"` →
  say, `:`/`;` → pose; `emote` is kept as a convenience alias (one speech path).
  The `;` no-space possessive nuance renders with standard pose spacing — a
  recorded minor divergence, correct attribution preserved.
Argument separator: the reference's `=` for building verbs, kept.
*(GENMURK-EPIC2-02.)*

### Gap fill round 1: the inspection triad + who + pose (budget-free built-ins)
Round-1 gap fill added the highest-frequency everyday verbs the capture names
and EPIC1 lacked: **`look <target>` / `examine` / `inventory`** (observing a
thing and your own carry — read-only over the actor's snapshot; `examine`'s
attribute/lock visibility reuses the world-API's one `controls`/`canSee`
authority, so a non-controller sees only the public face), **`who`** (the
coordinator's connected-session roster, name + room + count), and **`pose`**
plus the speech tokens. All are **fixed built-ins — budget-free** (the fuel
meter is only for softcode, GM-R14), wired through **both gateways** (the
in-memory fixture + Supabase, the read methods mirroring `look()`), and covered
by stack-free dispatch tests. No new migration or RPC — these are snapshot
reads and presence, so the sandbox gate and the v1-slice job are untouched.
*(GENMURK-EPIC2-02.)*

### The dev-tier ops substrate (GM-R19): the standard contract, carried early
The dev server answers `GET /healthz` with status + build id — the studio's
standard health contract (the same shape its hosted apps use) — proven
stack-free in CI; every other HTTP path stays a 404 on a WebSocket-only
surface. Structured logging is JSON-lines with a **test-enforced privacy
rule: identifiers and outcomes only** — typed command lines never reach a log
(a typed line can carry a password mid-registration). Backup expectations are
**documented against the provisioning act that will create the hosted
database** (daily minimum, PITR preferred, a restore drill at standup), and
the runbook draws the line explicitly: in-world `undestroy` is a player
feature; a backup restore is instance-level and rolls everyone back — never
conflate them. Secrets stay provider-native (GM-R19); the repo holds none,
grep-proven in CI. *(GENMURK-EPIC1-10; `app/docs/ops.md`.)*

## Open

### Themed creative direction
The **setting, theme, and name-in-fiction** — what the world is *about* — is a
company-level decision with options on the table, not invented here and not
decided yet. The engine is theme-agnostic, so this doesn't block the build; it's
tracked as a decision issue.
