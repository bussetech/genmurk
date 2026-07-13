# GenMURK application

The GenMURK world server and its softcode engine. This directory is the app
plane of the `bussetech/genmurk` repo (app-home ruling, platform#317): built
here, **never deployed to the docs Pages site** (`app/` is excluded from the
Jekyll build). Pre-PROD — hosting is platform EPIC5 work.

## What exists today (GENMURK-EPIC1-02, the engine spike)

This is the **design + proof-harness spike**, not the engine. It establishes
the sandbox contract (GM-R14) and the standing gate that any real engine must
pass, before a line of interpreter logic is written.

```
app/
├─ docs/
│  ├─ engine-design.md          # design of record: model, budgets, why-it-can't-escape
│  └─ function-library-v1.md    # v1 function-library behavioral contract
├─ src/engine/
│  ├─ types.ts                  # the engine seam (Budget, RunOutcome, WorldAPI, SoftcodeEngine)
│  ├─ stub.ts                   # honest stub — refuses everything (ENGINE_NOT_IMPLEMENTED)
│  └─ hang-stub.ts              # deliberately hangs; for the watchdog self-test only
├─ test/
│  ├─ softcode-adversarial/     # hostile programs AS DATA — the fixture pack + its README
│  └─ harness/                  # the proof runner (isolated worker + external watchdog)
└─ engine-status.json           # "stub" | "candidate" | "proven" — drives the harness mode
```

Not yet scaffolded (later prompts): `wrangler.toml`, `supabase/`, the world
model, the transport — the SaaS-stratum shape (ADR-0048) lands with the
subsystems that need it.

## Run the proof

```sh
cd app
npm ci
npm test          # typecheck + the adversarial proof harness
```

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
