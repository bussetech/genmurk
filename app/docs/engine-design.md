# GenMURK softcode engine — design of record (GENMURK-EPIC1-02 spike)

**Status:** design of record for the v1 engine — **implemented as of
GENMURK-EPIC1-03** (`src/engine/`, status `candidate`, adversarial pack
green). Deviations made while building are recorded in **§9** with reasons;
the mechanisms in §1–§8 are otherwise as designed and now enforced by code,
the pack, and the unit/property test layers.

**Requirements served:** GM-R11 (per-object user programmability), GM-R12
(wildcard dispatch + name matching), GM-R13 (styled output), and above all
**GM-R14: sandbox by construction, not by hope** — the hard requirement that
gates any hosted exposure. Clean-room: this design cites GM-Rn behavioral
requirements only; no original engine source was consulted (see
"Clean-room statement" at the end).

---

## 1. Language and execution model

**Decision: a TypeScript tree-walking AST interpreter ("AST-walker"), strict
mode, running inside the same Workers-class isolate as the server. Not a
bytecode VM (for v1), and — per company direction — not a wrapper around any
off-the-shelf VM.**

The engine must run on Workers-class compute (settled on the decisions page):
no subprocesses, no native modules, no OS-level isolation primitives
available. Whatever we build is pure code in the server's own isolate, which
means **the sandbox must live in the interpreter's own structure** — there is
no outer wall to lean on. That constraint drove the choice:

- **Fuel counting needs one choke point.** In an AST-walker, every unit of
  work passes through a single `evaluate(node, meter)` entry. Charging the
  step budget there — before descending — makes "no unmetered work" an
  auditable property of one function, not a discipline spread across a
  compiler and a dispatch loop. A bytecode VM has an equally good choke point
  (the dispatch loop) but adds a second representation (the compiler and its
  bytecode) that must also be proven allocation- and step-safe.
- **Softcode workloads don't reward bytecode at v1.** Programs are short,
  event-triggered, and budget-capped: the step budget — not raw throughput —
  bounds worst-case cost by design. Bytecode's wins (dispatch speed, cached
  compiled form) are optimizations we can't need until real load data exists.
- **Auditability is the product.** The single most important requirement
  (GM-R14) is proven by reading the evaluator and running the adversarial
  pack. A walker is the smallest thing that can be read whole.

**The seam is kept:** everything outside the engine sees only the
`SoftcodeEngine` interface (`app/src/engine/types.ts`). A bytecode VM (or a
compile-to-closures pass) can replace the walker post-v1 behind the same
interface and must pass the same proof harness. That is a performance
decision for later, made on measurements, behind an interface that already
exists.

Values in the softcode world are **strings, all the way down** (the
MUSH-family model, per GM-R11's behavioral spec): function results, attribute
contents, and substitution registers are strings. No host object, function
reference, or promise is ever a softcode value — which closes an entire class
of capability-leak bugs before it can open.

## 2. The evaluation pipeline

```
raw input line
   │
   ▼
[1] substitution pass        %0..%9, %N and friends — one metered pass;
   │                         expansions charge fuel and allocation
   ▼
[2] parse → AST              recursive-descent; input length is capped,
   │                         parser work is bounded by input size and
   │                         charged against the same meter
   ▼
[3] dispatch                 built-in verb table first, then $-command
   │                         wildcard match over in-scope objects (GM-R12);
   │                         match units charge fuel
   ▼
[4] queue                    matched actions become queue entries; the
                             scheduler drains them under fairness rules (§4)
```

Two properties of the pipeline matter more than its stages:

- **Every stage is metered.** Substitution expansion, parsing, wildcard
  matching, and evaluation all charge the same per-invocation meter. There is
  no pre-budget phase where a hostile input can do unbounded work "before the
  sandbox starts."
- **Substitution is a single pass, not a fixpoint.** (Implementation note:
  the pass lives at the token/AST level — see §9.1.) The result of expanding
  a register is *text*, and it is not re-scanned for further substitutions
  (data echoed into output stays data — the injection fixtures probe exactly
  this). Deliberate re-evaluation exists only as an explicit library function,
  which charges fuel and counts a recursion frame like any other call.

## 3. The budget model — first-class constructs

The budget is a value, not a convention (`Budget` in
`app/src/engine/types.ts`), threaded through every invocation:

| budget | mechanism of enforcement |
| --- | --- |
| **step budget** (fuel) | A `Meter` object is passed into the single `evaluate()` entry point, which **charges ≥1 fuel before recursing into any node** — as do substitution expansion and wildcard-match units. Fuel exhausted ⇒ typed refusal `STEP_BUDGET_EXCEEDED`. Fuel counting is at interpreter steps, not wall-clock hope: a program with fuel F performs at most F units of work, provably, on any hardware. |
| **recursion depth** | A depth counter incremented on every user-function / attribute-evaluation frame; exceeding the cap ⇒ `RECURSION_LIMIT_EXCEEDED`. Depth is charged where the *frame* is created, so mutual recursion and self-triggering chains hit the same wall as direct self-calls. |
| **queue budgets** | Two ceilings: a **per-run enqueue ceiling** (one execution may enqueue at most N follow-on entries — a fork bomb is refused at the enqueue site with `QUEUE_BUDGET_EXCEEDED`, before the queue grows) and a **per-owner queue depth cap** (an owner's pending entries are bounded regardless of how they got there). |
| **queue quantum + fair scheduling** | The scheduler drains the queue **round-robin across owners**, each turn bounded by a quantum; every queued entry runs under its **own fresh per-invocation budget** drawn from its owner's allowance. A hostile owner's total CPU share is capped by scheduler policy — other players' entries are served on their own turns regardless of what the hostile owner's programs do. |
| **allocation ceiling** | All strings and lists the interpreter constructs go through **metered constructors** that charge a byte account (concatenation charges the size of the result, not 1). Ceiling exceeded ⇒ `ALLOCATION_BUDGET_EXCEEDED`. Attribute values and input lines carry their own size caps at the world-model boundary. |
| **wall-clock ceiling** | A backstop, **not the primary mechanism**: checked at fuel charge points (cheap monotonic read every N charges). Fuel bounds the work; the wall-clock cap defends against the residual class "individually cheap steps that are pathologically slow in the host" ⇒ `WALL_CLOCK_EXCEEDED`. |

**Refusals are values, never crashes.** Every budget violation produces a
typed `RunOutcome { status: "refused", refusalCode }` — deterministic,
loggable, and reportable to the player. No budget violation throws a host
exception across the engine boundary, and none may hang: the acceptance
vocabulary of the adversarial pack is exactly `terminated-with-refusal`,
never a hang, never a crash.

**Boundary semantics are exact:** work that finishes *at* the limit
completes; the first unit *beyond* the limit refuses. The fixture pack pins
this with exactly-at-limit / limit-plus-one probes so budget drift is caught
by CI, not by players.

## 4. Why a hostile program cannot escape, hang the server, or starve other players

The acceptance question, answered with mechanisms:

**It cannot escape because the capability to escape does not exist in its
world (deny-by-construction):**
- The grammar has **no import/require/FFI syntax** — escape is unparseable
  before it is refusable.
- Name resolution searches exactly two spaces: the **frozen function-library
  table** (built at engine construction, `Object.freeze`d) and the
  substitution registers. An unknown name is a typed `UNKNOWN_FUNCTION`
  refusal. The evaluator never consults `globalThis`, never calls `eval`,
  `Function`, or dynamic `import` — an invariant enforced by review and by a
  source-level tripwire (a CI grep over `src/engine/` for the forbidden
  tokens; wired when the real engine lands).
- The **only I/O capability is the `WorldAPI` handle** the engine is given
  per invocation. There is no host, network, filesystem, or timer object in
  scope — not "denied," *absent*. The WorldAPI itself is the second wall: it
  performs its own permission checks (GM-R15) on every call, so even an
  engine bug that misroutes a call cannot exceed the acting player's world
  permissions.
- Player-controlled attribute names/values live in **`Map`s, never as object
  properties** — `__proto__`/`constructor`-shaped payloads are inert data
  (the prototype-pollution fixtures probe this), and softcode values being
  strings means no host reference can leak through a return value.

**It cannot hang the server because no unmetered loop exists:**
- Every loop in the evaluator iterates over fuel-charged units; `evaluate()`
  charges before descending; substitution, parsing, and matching are bounded
  by capped input sizes and charge the same meter. A program with fuel F does
  ≤ F units of work — termination is arithmetic, not intent.
- The wall-clock backstop (checked at charge points) covers the residual
  slow-host class, and the proof harness additionally runs every fixture
  under an **external watchdog** that treats any hang as a failed proof — so
  "no hang" is tested from outside the engine, not asserted by it.

**It cannot starve other players because scheduling is per-owner, not
per-request:**
- Fork bombs die at the enqueue site (per-run enqueue ceiling) and at the
  owner's queue-depth cap — the queue cannot be flooded into unfairness.
- The round-robin/quantum scheduler gives each owner a bounded share per
  cycle; a victim's single queued command is served on the victim's turn with
  its own fresh budget, whatever the attacker submits. Starvation would
  require the scheduler to be wrong, and the starvation fixture holds a
  victim-completes assertion over exactly that.

## 5. The proof harness is part of the engine

`app/test/harness/` + `app/test/softcode-adversarial/` (this session's other
deliverable) is the standing gate:

- Hostile programs are **data** (JSON fixtures: program, budget config,
  required outcome — see the pack README). The harness runs any engine build
  against the pack in an isolated worker with an external wall-clock
  watchdog, and emits a pass/fail table.
- CI runs it on every PR. While `app/engine-status.json` says `"stub"`, the
  harness proves the *plumbing* (the stub must refuse everything with
  `ENGINE_NOT_IMPLEMENTED`, and the watchdog must catch a deliberately
  hanging engine) and prints **SANDBOX NOT PROVEN** loudly. When the first
  real engine flips the status to `"candidate"`, the same job becomes the
  hard gate: every fixture must meet its required outcome, and the gate's
  green run is the recorded evidence the underwriting requires **before any
  hosted exposure** (the epic's spine).

## 6. Function library and the command surface

The v1 library contract — which function classes exist and their specified
behavior — is `app/docs/function-library-v1.md`. Two provenance rules from
the requirements govern it:

- **Internal names are GenMURK's own.** The library is specced as behavior
  against GM-R11/R12, never as a reference implementation.
- **Player-visible verb names and syntax arrive as data** (GM-R22): the
  canonical reference command list is an airgapped preservation capture
  (tracked as genmurk#9), and the dispatch layer is built so that list drops
  in as a mapping table — reference surface → GenMURK behavior. Nothing in
  the engine hardcodes a player-visible name, and no command is invented
  from model memory of MUSH-family systems. Where a captured command
  conflicts with the sandbox, the safe behavior wins and the divergence is
  documented for the returning user.

## 7. Extension seams (GM-R21 — noted, not designed)

GM-R21 (the studio's gnomes one day living in-MURK) is post-v1 and
contributes **zero requirements** to this design. The seams it will use exist
for v1's own reasons and are simply noted:

- **`WorldAPI` is a capability handle per principal** — a future non-human
  principal is just another actor handed the same handle under the same
  budgets and permissions.
- **The function-library table is data** — a registration point, not a
  hardcoded surface.

Nothing further is designed here.

## 8. Clean-room statement

This design was produced from the GM-Rn behavioral requirements
(`decomposition.md`, `docs/requirements.md`), the settled entries on the
decisions page, and the studio's untrusted-input doctrine. No TinyMUSE,
TinyMUD, or TinyMUSH source was opened, read, or fetched in its production.
Behavioral questions the requirements do not answer are routed to the
preservation track as issues — never resolved by consulting reference
source.

## 9. Implementation deltas (GENMURK-EPIC1-03)

The engine was built to §1–§8. Where building it proved a mechanism wrong or
incomplete, the change is recorded here with its reason — the doc stays true.

1. **Substitution is token-level, not a pre-parse text splice.** `%N` lexes
   to a register token and parses to an AST leaf; evaluation returns the
   register's string **value**. A textual splice into source cannot be inert
   — the expanded text would re-enter the parser as code, which is exactly
   the injection the design forbids (fixture 19 pins the required behavior).
   The design's "one metered pass" survives: each expansion charges fuel and
   allocation at evaluation.

2. **Fuel-charge granularity is work-unit, not AST-node.** Charges land at
   call entry, iteration/match units, register expansion, and instrumentation
   burns; literals are free at evaluation. Parsing charges **1 fuel per 64
   input characters** plus the allocation account for the held source, and is
   absolutely bounded by the input cap (`PROGRAM_MAX_CHARS` 64 KiB). Reason:
   the boundary fixtures (07/08) demand `t.burn(n)`-total exactness — a
   charge-per-node model would make identical work cost different fuel per
   program shape without adding any safety; every loop remains metered.

3. **The host stack is an attack surface; two ceilings bound it.** A
   recursive-descent parser fed 600-deep nesting is a host crash, not a
   softcode error (found while building; fixture 20). Syntactic nesting is
   capped (`PARSE_DEPTH_MAX` 32, a typed `INVALID_PROGRAM`), and the engine
   clamps effective recursion depth at `ENGINE_RECURSION_CEILING` 64
   regardless of configured budget, so nesting × frames can never approach
   the host stack (property test pins the worst legal shape). Defense in
   depth: an unexpected host exception at the run boundary becomes a typed
   refusal with an `internal:` detail — never a crash across the seam — and
   the fuzz layer fails on any `internal:` sighting so defects still surface.

4. **Queue termination needed two mechanisms the spike design lacked.** The
   pending-depth cap alone cannot terminate a self-replicating chain: each
   completed entry can replace itself at the cap and oscillate forever.
   (a) **Enqueues are transactional** — follow-on entries commit only when
   the run that enqueued them **completes**; a refused run schedules nothing.
   (b) A **per-owner drain quota** (`queueDepthPerOwner × 4` executions per
   drain cycle) bounds how much execution one owner's chain can buy; entries
   beyond it are typed `QUEUE_BUDGET_EXCEEDED` refusals. Termination is again
   arithmetic: per owner, ≤ quota executions × ≤ ceiling enqueues each.

5. **The seam grew three world calls and one outcome field.** `WorldAPI` adds
   `name`, `location`, `visibleObjects` — `obj.name`/`obj.location`/GM-R12
   partial-name resolution are world questions, and the split keeps the
   *matching work* in-engine (fuel-charged per candidate) while the world
   supplies only visibility. `RunOutcome` adds optional `detail` for
   diagnostics. No new capability: all three return strings/ids under the
   world's own permission model.

6. **The frozen table is enforced, not asserted.** `Object.freeze` on a `Map`
   does not disable `.set`; the library table's mutators are replaced with
   throwing stubs before the freeze.

7. **Iteration binding:** `ctl.iter`, `list.map`, `list.filter` bind the
   current element as `%0` inside the per-element frame (library contract
   updated). `ctl.switch` results are lazy like `ctl.if` branches; patterns
   evaluate in order until one matches.

8. **GM-R12 dispatch status:** the wildcard matcher (captures,
   case-insensitive, every match unit fuel-charged — fixture 21) and name
   resolution (`me`/`here`/`#dbref`/partial) are built and library-exposed
   (`ctl.switch`, `obj.resolve`). The `$`-command scan over in-scope objects
   arrives with the world model (04), which owns attribute enumeration; the
   player-visible surface stays GM-R22 capture data as designed.

## 10. Implementation deltas (GENMURK-EPIC1-07 — softcode meets the world)

9. **Runs carry a budget-attribution principal separate from the actor.**
   `RunRequest.owner` (default: the actor) is the key the scheduler's
   round-robin queues, drain quotas, and `queue.enqueue`'s depth cap use;
   `PendingEntry` records both (`actor` = who the follow-on runs as, `owner`
   = who it bills). Reason: object-attached softcode (`$`-commands, event
   triggers — `src/server/softcode.ts`) runs AS the object but must bill the
   object's OWNER, or an owner's fleet of objects multiplies its scheduler
   share and a hostile object bills the enactor who tripped it (the
   cross-owner budget-theft class; fixture 22 and the triggers tests pin
   both directions). §3's per-owner language was always the intent — this
   makes "owner" a first-class field instead of a synonym for "actor". The
   `$`-command MATCH scan itself is fuel-charged through the engine's own
   `Meter` under a per-object allowance at the dispatch layer, so pipeline
   stage 3 (§2) is metered as designed even though it runs before any
   program is chosen.
