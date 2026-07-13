---
layout: post
title: "The engine spike: designing the sandbox before building it"
date: 2026-07-12
description: "The riskiest piece of GenMURK — the user-programmable softcode engine — gets designed, and its sandbox gets a proof harness, before a line of the real interpreter is written. Hostile programs as data, an adversarial fixture pack, and a CI gate that stays RED until the engine earns green."
---

The rebuild backlog is ranked highest-risk-first, and one item sits at the
top for a reason: the **user-programmable softcode engine.** It is the thing
that makes a MUSE a MUSE — players attach code to objects and the server runs
it — and it is the largest untrusted surface in the whole system. So the first
real build session did **not** write the engine. It designed it, and it built
the machine that will *prove* the engine is safe, before the engine exists.

## Design first, and one question above all

The [design of record](https://github.com/bussetech/genmurk/blob/main/app/docs/engine-design.md)
answers a single question in writing: *why can a hostile program not escape,
not hang the server, and not starve other players?* Not "we intend to prevent
it" — the mechanisms:

- **It can't escape** because the capability to escape doesn't exist in its
  world. The interpreter's values are strings; the only thing it can touch is
  the world-model handle it's given. There is no host, no network, no
  filesystem, no `import` — not *denied*, **absent**. A reach for `require` or
  `globalThis` resolves to nothing.
- **It can't hang the server** because there is no unmetered loop. Every step
  charges *fuel* before it runs; a program with fuel *F* does at most *F* units
  of work — termination is arithmetic, not good behavior. A wall-clock backstop
  and an external watchdog cover the rest.
- **It can't starve other players** because scheduling is per-owner and fair:
  fork bombs die at the moment they try to enqueue, and a victim's command runs
  on the victim's turn no matter what an attacker submits.

The engine is our own — a metered tree-walking interpreter, not a borrowed VM
— so those budgets are enforced natively, where we can read them.

## The sandbox gets a proof, not a promise

Alongside the design, this session built the **adversarial fixture pack**: 19
hostile programs across 8 attack classes — CPU exhaustion, deep and mutual
recursion, fork bombs, allocation bombs, sandbox-escape attempts, injection,
and budget-boundary probes (exactly-at-limit must pass; limit-plus-one must
refuse). Each is *data*: the program, its budget, and the outcome it must
produce — always *terminated-with-refusal or completed-within-budget*, never a
hang, never a crash, the world untouched.

A **proof harness** runs the whole pack against any engine build inside an
isolated worker with an external watchdog, and prints a pass/fail table. It's
wired into CI and runs on every engine change.

## The gate is honest — and today it says NOT PROVEN

There is no engine yet, only an honest **stub** that refuses everything. So the
harness runs in plumbing-proof mode: it confirms its own machinery works
(including a self-test that the watchdog really does catch a deliberately
hanging engine) and then prints, in as many words:

> **SANDBOX NOT PROVEN — engine is a stub.**

That's the point. The day a real interpreter arrives, it flips one status file
to `candidate`, and the same CI job becomes a **hard gate**: every fixture must
go green, or the build is RED and nothing gets hosted. Nothing about GenMURK
runs beyond a laptop until that table is green. The gate is built now, standing
and red, so the engine has to earn its way past it — not the other way around.

Next: the first real slice of the interpreter, aimed squarely at turning that
table green.
