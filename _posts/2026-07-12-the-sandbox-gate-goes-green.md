---
layout: post
title: "Engine core v0: the sandbox gate goes green"
date: 2026-07-12
description: "The softcode interpreter exists, and the adversarial pack — now 21 hostile fixtures — passes in gate mode because the budgets are real. Fuel-counted steps, an allocation account, transactional queues, and two attack classes discovered by building. Localhost and CI only; nothing is hosted."
---

Last session designed the softcode engine and built the machine to prove it
safe. This session built the engine — to exactly one standard: **the
adversarial pack passes because the budgets are real.**

The result: `engine-status.json` now says `candidate`, which flips the proof
harness from plumbing mode into **hard-gate mode** — every hostile fixture
must meet its declared outcome or CI is red — and the table is green. All 21
fixtures, 8 attack classes, in about five seconds of pack runtime (bounded
runtime is itself part of the proof: terminations are enforced, not lucky).

## What "the budgets are real" means in code

The design record promised mechanisms, not intentions. They now exist:

- **Fuel.** Every call, iteration unit, match unit, and substitution
  expansion charges a per-invocation meter *before* the work happens. A
  program with fuel F does at most F units of work — termination is
  arithmetic. The boundary fixtures pin exactness: work that finishes *at*
  the limit completes; the first unit beyond refuses.
- **An allocation account.** String-building charges the account for the
  size of the result *before* constructing it — a 16 MB repeat against a
  1 MB account is refused, not built-then-noticed.
- **Recursion depth charged at frame creation**, so mutual recursion hits
  the same wall as a direct self-call — plus an engine-level ceiling that no
  server configuration can exceed, keeping softcode away from the host stack
  entirely.
- **A fair queue.** Round-robin across owners, every entry under its own
  fresh budget: the starvation fixture submits a step-bomb and a victim's
  one-line program together, and the victim completes, every time.
- **Refusals are values.** Every violation is a typed outcome
  (`STEP_BUDGET_EXCEEDED`, `ALLOCATION_BUDGET_EXCEEDED`, …) — never a hang,
  never a crash across the engine boundary.

## The pack grew, which is the system working

Building the engine found two attacks the spike hadn't written down, and
both are fixtures now:

1. **A parser bomb.** Six hundred nested calls would crash a naive
   recursive-descent parser's host stack before any budget saw it. The
   grammar now caps nesting as a typed refusal.
2. **A backtracking bomb.** A 20,000-character string against a many-star
   wildcard pattern is the classic match-work blowup. GenMURK's matcher
   charges every match unit as fuel, so the step budget refuses it long
   before the server feels it.

Queue termination also got sharper than the original design: a
self-replicating queue entry could have oscillated at the depth cap forever,
so follow-on work now commits **only when the run that scheduled it
completes**, and each drain cycle bounds how much execution one owner can
buy. The design record carries all of these as recorded deltas — the doc
stays true to what's built.

Beyond the pack, the engine now carries a unit layer (every library function
tested), a seeded property/fuzz layer (random programs must terminate in
budget; a victim must survive random attackers; garbage input must never
crash), an isolation proof (a recording test double shows softcode can reach
*only* the world interface — nothing else exists in its universe), and a CI
tripwire that greps the engine source for host-capability tokens.

## What this is not

Honesty clause, as always: this is a sandboxed interpreter passing a hostile
test pack **locally and in CI**. There is no world model yet, no network
transport, no persistence, and nothing hosted anywhere — the gate that just
went green is precisely the gate that *governs* any future hosted exposure,
and hosting itself is a separate authorization that hasn't happened. The
next work is the world the engine will speak to, through the one interface
it can see.
