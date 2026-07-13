# GenMURK application

The GenMURK world server and its softcode engine. This directory is the app
plane of the `bussetech/genmurk` repo (app-home ruling, platform#317): built
here, **never deployed to the docs Pages site** (`app/` is excluded from the
Jekyll build). Pre-PROD — hosting is platform EPIC5 work.

## What exists today (GENMURK-EPIC1-03: engine core v0, sandbox GREEN)

The softcode engine is real: a metered AST-walker implementing the design
record, with the full v1 function library, the queue + fair scheduler, and
**the adversarial pack green in gate mode** — the GM-R14 evidence. Still
localhost + CI only; nothing is hosted (the gate governs exposure, and PROD
is EPIC5/STEERCO territory).

```
app/
├─ docs/
│  ├─ engine-design.md          # design of record (+ §9 implementation deltas)
│  └─ function-library-v1.md    # v1 function-library behavioral contract
├─ src/engine/
│  ├─ types.ts                  # the engine seam (Budget, RunOutcome, WorldAPI, SoftcodeEngine)
│  ├─ engine.ts                 # createEngine — the real engine (status: candidate)
│  ├─ interpreter.ts            # the metered walker + the frozen function library
│  ├─ scheduler.ts              # command queue: round-robin fairness, transactional enqueues
│  ├─ parse.ts / match.ts       # bounded parser; fuel-charged GM-R12 wildcard matcher
│  ├─ meter.ts / refusal.ts     # budgets as values; refusals as values
│  ├─ stub.ts                   # honest stub — kept for the harness plumbing self-test
│  └─ hang-stub.ts              # deliberately hangs; for the watchdog self-test only
├─ test/
│  ├─ softcode-adversarial/     # hostile programs AS DATA — the fixture pack + its README
│  ├─ harness/                  # the proof runner (isolated worker + external watchdog)
│  ├─ unit/                     # per-function library + parser + budget + isolation tests
│  ├─ property/                 # seeded generative invariants (see fuzz mode below)
│  ├─ tripwire.ts               # CI grep: no host-capability token in src/engine/
│  └─ bench.ts                  # performance envelope probe (manual: npm run bench)
└─ engine-status.json           # "stub" | "candidate" | "proven" — drives the harness mode
```

Not yet scaffolded (later prompts): `wrangler.toml`, `supabase/`, the world
model, the transport — the SaaS-stratum shape (ADR-0048) lands with the
subsystems that need it.

## Run the proof

```sh
cd app
npm ci
npm test          # typecheck + tripwire + unit/property tests + the adversarial proof
```

Property tests run a fixed seed corpus in CI (deterministic). Local fuzz
mode widens the search:

```sh
FUZZ_SEED=99 FUZZ_RUNS=2000 npm run unit   # any seed/volume you like
```

A failing seed becomes a regression entry in the corpus, and when the
failure is an attack shape it becomes a pack fixture — the pack only grows.

The harness discovers every fixture in `test/softcode-adversarial/fixtures/`,
runs it against the engine named in `engine-status.json` inside an isolated
worker thread with an **external wall-clock watchdog**, and prints a pass/fail
table. It always runs a watchdog self-test first (the hanging engine must be
caught from outside).

- While `engine-status.json` says **`"stub"`**: the harness proves its own
  plumbing (every program refuses with `ENGINE_NOT_IMPLEMENTED`) and prints
  **SANDBOX NOT PROVEN**. Exit 0 — the harness can land before the engine.
- When a real engine flips it to **`"candidate"`**: the same job becomes the
  **hard gate** — every fixture must meet its declared outcome, or the run is
  RED and hosted exposure is blocked (GM-R14; the epic's spine).

Requires Node 24+ (native TypeScript type-stripping; no build step).

## The one rule that governs everything here

Softcode is **untrusted input**, always — the same doctrine the studio's
survey gnomes apply to an injected README. The sandbox is by construction,
not by hope: read `docs/engine-design.md` §4 for the mechanisms, and grow the
fixture pack whenever you think of a new way to attack them.
