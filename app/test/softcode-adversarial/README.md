# The adversarial fixture pack (GM-R14 proof material)

Hostile softcode programs **as data**. Each fixture is one JSON file: the
program(s), the budget configuration, and the required outcome. The proof
harness (`app/test/harness/`) runs any engine build against every fixture in
an isolated worker with an external wall-clock watchdog and emits a pass/fail
table. The acceptance vocabulary is fixed:

- **terminated-with-refusal** (a typed `RefusalCode`) or **completed within
  budget** — exactly as the fixture's `expect` says;
- **never a hang** — the watchdog kills and fails any fixture that doesn't
  return;
- **never a crash** — a thrown host exception escaping the engine fails the
  fixture;
- **world state unmodified beyond spec** — recorded mutations must equal the
  fixture's `mutations` list exactly (default: none).

This pack passing against a real engine build is the **hard gate for any
hosted exposure** (the epic's underwriting; design record §5). Growing the
pack is always in scope: a new attack idea becomes a new fixture, never a
mental note.

## Fixture format

```jsonc
{
  "name": "kebab-case-name",            // = filename stem
  "attackClass": "one of the classes below",
  "description": "what this attack tries and why the expectation is right",
  "budget": {                            // Budget from src/engine/types.ts
    "steps": 5000, "recursionDepth": 32, "enqueuePerRun": 8,
    "queueDepthPerOwner": 16, "allocationBytes": 1048576, "wallClockMs": 1000
  },
  "world": {                             // optional extra seeding (see below)
    "objects": { "#1": { "owner": "#1", "attrs": { "FN": "…softcode…" } } }
  },
  "runs": [                              // ≥1 program; >1 = scheduler path
    { "actor": "#1", "program": "…softcode…" }
  ],
  "expect": [                            // parallel to runs
    {
      "statusAnyOf": ["refused"],       // "completed", "refused", or both
      "refusalCodesAnyOf": ["STEP_BUDGET_EXCEEDED"], // when refused allowed
      "mutations": [],                   // exact; setAttr detail is "attr=value"
      "output": ["exact lines"],        // optional exact match
      "outputMustNotContain": ["secret"] // optional
    }
  ],
  "integrityProbe": true                 // optional: after the runs, the
                                         // harness executes
                                         // out.emit(num.add(1, 1)) and
                                         // requires completed + output ["2"]
}
```

Where a fixture accepts more than one refusal code (e.g. an infinite
self-evaluation chain may trip the step budget or the recursion limit first,
depending on charge ordering), both are listed — **which** budget refuses is
engine detail; *that* it refuses deterministically is the requirement.

## The harness world

Fixtures run against a recording in-memory world (never the real world
model). Seeded by default:

- `#1` — the attacker's object, owned by `#1`
- `#2` — the victim's object, owned by `#2`
- `#900` — a foreign object owned by `#902`, with attr `SECRET = "swordfish"`

Permission rule: an actor may read/write attributes only on objects it owns;
anything else returns a `PERMISSION_DENIED` world refusal (the toy version of
GM-R15 — enough to prove the engine surfaces world refusals and leaks
nothing). Every write is journaled as a `WorldMutation`.

Engines are constructed with `{ instrumentation: true }`, registering the
`t.burn(n)` / `t.noop()` / `t.alloc(n)` test functions (library contract §8)
so budget-boundary fixtures are deterministic. **Convention: `t.burn(n)`'s
`n` is the total fuel charge including its own entry charge** — boundary
fixtures depend on that exactness.

## Attack classes (v1)

| class | what it probes |
| --- | --- |
| `cpu-step-exhaustion` | unbounded work: big iterations, infinite self-evaluation chains |
| `recursion` | direct and mutual recursion through attribute evaluation |
| `budget-boundary` | exactly-at-limit completes; limit-plus-one refuses; the wall-clock backstop |
| `queue-abuse` | fork bombs and enqueue floods die at the enqueue site |
| `scheduler-starvation` | a victim's run completes whatever an attacker submits |
| `allocation` | string/list construction bombs against the byte account |
| `sandbox-escape` | host names resolve to nothing; prototype-pollution payloads are inert data; foreign objects stay locked |
| `injection` | softcode stored in attributes is data on raw read — never implicitly evaluated |

## Provenance

Programs use **GenMURK's internal library names only**
(`app/docs/function-library-v1.md`). Nothing here reproduces, or is derived
from, any reference system's command set or source — the pack attacks *our*
budgets through *our* surface. Player-visible command names arrive later as
GM-R22 capture data and get their own acceptance fixtures then.
