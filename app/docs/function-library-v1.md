# GenMURK softcode function library — v1 contract (GENMURK-EPIC1-02)

**Status:** the behavioral contract for the v1 library. It is a *spec*, not
an implementation; the engine build session implements against it and the
adversarial pack. Every class below is required by the ruled v1 scope
(GM-R1..R18 + R19/R20, GM-R22 as acceptance layer) via GM-R11/R12/R13.

**Naming law (provenance):** the names below are **GenMURK-internal** — our
own, chosen for clarity, and deliberately *not* asserted to match any
reference system. Where a function is player-visible, its canonical
player-facing name and syntax arrive later as data from the airgapped GM-R22
capture (genmurk#9) through the dispatch mapping table; this document never
pre-empts that list, and no name here is drawn from model memory of
MUSH-family systems.

**Implementation status (GENMURK-EPIC1-03):** implemented in
`src/engine/interpreter.ts`, unit-tested per function, and live behind the
adversarial gate. Clarifications settled while building are folded in below
and cross-referenced from the design record §9.

**Universal budget rule:** every function charges ≥1 fuel on entry; functions
that construct strings/lists charge the allocation account for the size of
what they build; functions that create evaluation frames charge recursion
depth; functions that enqueue charge the queue budgets. There are no
exceptions — a function that could do work without charging would break the
GM-R14 proof, so the harness treats "free work" as a failed fixture.

## Value model

All softcode values are strings. Lists are delimiter-joined strings (space
by default, delimiter overridable per call) — the GM-R11 behavioral model.
Numbers are strings that parse numerically; boolean results are `"1"`/`"0"`.

## Classes

### 1. String (GM-R11)

| internal name | behavior |
| --- | --- |
| `str.concat(a, b, …)` | concatenation; charges allocation for the result size |
| `str.length(s)` | character count |
| `str.slice(s, start, len?)` | substring (0-based start); out-of-range clamps, never errors |
| `str.replace(s, find, repl)` | literal find/replace, all occurrences |
| `str.upper(s)` / `str.lower(s)` | case mapping |
| `str.trim(s)` | strip surrounding whitespace |
| `str.repeat(s, n)` | repetition; allocation-charged on result size (a classic allocation-bomb site — the pack probes it) |

### 2. List (GM-R11)

| internal name | behavior |
| --- | --- |
| `list.item(l, i, d?)` | i-th element (1-based) of `l` split on delimiter `d` |
| `list.count(l, d?)` | element count |
| `list.append(l, x, d?)` | append element; allocation-charged |
| `list.map(l, fnAttr, d?)` | evaluate an attribute-held function (`fnAttr` on the caller's own object) per element — **creates a frame per element** (recursion-charged), binds the element as `%0`, and each element evaluation draws on the same fuel meter |
| `list.filter(l, fnAttr, d?)` | same charging model as `map`; keeps elements whose result is truthy |

### 3. Arithmetic & logic (GM-R11)

| internal name | behavior |
| --- | --- |
| `num.add/sub/mul/div/mod(a, b)` | integer/decimal arithmetic on numeric strings; `div`/`mod` by zero is a typed refusal (`INVALID_PROGRAM` class), never a crash |
| `num.cmp(a, b)` | `-1/0/1` comparison |
| `bool.and/or/not(…)` | on `"1"`/`"0"`; non-boolean input coerces by numeric truthiness |

### 4. Object & attribute access (GM-R11 · GM-R12 · GM-R15)

Every function in this class is a thin, metered shim over the **`WorldAPI`
capability handle** — the library has no world access of its own, and the
WorldAPI re-checks the acting player's permissions (GM-R15) on every call.

| internal name | behavior |
| --- | --- |
| `obj.getAttr(target, attr)` | read an attribute; permission-refused reads are a typed refusal, world untouched |
| `obj.setAttr(target, attr, value)` | write an attribute (a journaled world mutation); size-capped at the world boundary |
| `obj.name(target)` / `obj.location(target)` | resolved via WorldAPI |
| `obj.resolve(name)` | name matching per GM-R12: `me`, `here`, `#dbref`, then case-insensitive exact/prefix match over world-visible candidates — match work charges fuel per candidate; no match is the empty string, a value |
| `obj.callAttr(target, attr, args…)` | evaluate an attribute as a user function — **the** recursion-frame site; depth-charged, and the evaluated body draws on the caller's fuel meter |

### 5. Control (GM-R11)

| internal name | behavior |
| --- | --- |
| `ctl.if(cond, then, else?)` | lazy branches (unevaluated branch charges nothing) |
| `ctl.switch(v, pat1, res1, …, default)` | wildcard patterns per GM-R12; match units charge fuel |
| `ctl.iter(l, body, d?)` | bounded iteration over a list; `body` is softcode **text** (evaluated per element with the element bound as `%0`), per-element frame + fuel charges — unbounded iteration is impossible by construction because iteration count ≤ list element count and every element charges |
| `ctl.eval(s)` | **the only deliberate re-evaluation path** (substitution output is never re-scanned implicitly); creates a frame, fuel-charged |

### 6. Output & styling (GM-R13)

| internal name | behavior |
| --- | --- |
| `out.emit(text)` | say-to-context output via WorldAPI; rate/size governed by the allocation account |
| `out.style(text, spec)` | wrap text in GenMURK's markup tokens — `[[spec]]text[[/]]`, `spec` validated against `[a-z][a-z0-9:,-]*` (bold/color classes per GM-R13); the *renderer* maps tokens to ANSI/markup at the transport — softcode never emits raw escape bytes, so styled output cannot smuggle terminal control sequences. The rendered vocabulary is `src/server/style.ts` (GENMURK-EPIC1-07): bold, dim, underline, `color:<the classic 8>`; unknown specs are dropped tokens at the renderer, and the wire boundary control-strips every outbound frame |

### 7. Queue (GM-R11)

| internal name | behavior |
| --- | --- |
| `queue.enqueue(target, attr, args…)` | schedule an attribute evaluation as a new queue entry — charged against the per-run enqueue ceiling and the owner's queue-depth cap (`QUEUE_BUDGET_EXCEEDED` at the enqueue site when exceeded); the entry runs later under its own fresh per-invocation budget on its owner's scheduler turn. "Owner" is the run's budget-attribution principal (GENMURK-EPIC1-07): object-attached softcode runs AS its object but bills the object's OWNER, and follow-ons inherit both (engine design §10.9) |

### 8. Test instrumentation (harness only — never in production)

Registered only when the engine is constructed with
`{ instrumentation: true }`, which only the proof harness does. Exists so
budget-boundary fixtures are deterministic.

| internal name | behavior |
| --- | --- |
| `t.burn(n)` | consume exactly `n` fuel, do nothing else |
| `t.noop()` | consume exactly 1 fuel |
| `t.alloc(n)` | charge exactly `n` allocation bytes |

## What is deliberately absent

No host, network, filesystem, timer, random-beyond-world, import, or
reflection capability appears in any class — not as a denied entry, but as
**no entry** (deny-by-construction, GM-R14; design record §4). A call to any
name outside the registered table is `UNKNOWN_FUNCTION`, world untouched —
the escape-class fixtures pin this.
