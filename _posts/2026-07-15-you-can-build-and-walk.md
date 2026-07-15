---
layout: post
title: "You can build and walk: verbs, movement, and the compatibility harness"
date: 2026-07-15
description: "GenMURK's world is now something you shape with your hands: dig a room, open exits both ways, create and lock a thing, and watch another player fail that lock — all driven by typed commands through the real world of record, on localhost. And the GM-R22 command-compatibility harness now exists, so the day the canonical reference command list lands, coverage becomes a number instead of a promise."
---

Last time GenMURK became a *place* — two terminals, one room, presence and
speech. This session gave players **hands**. A typed line now becomes a change
in the world of record: `dig The Vault`, `open vault = The Vault`,
`create a silver chalice`, `lock use vault = #4`. Standing in a room you
control, you build; you `go` through an exit and everyone in the room you left
sees you depart, live. It is the ordinary, tactile core of a MUD/MUSE — and it
runs end to end through the same audited, row-secured world model the engine
uses, on localhost, and nowhere else.

## What landed

- **A command dispatch pipeline.** Typed input → parse → dispatch → either the
  ordering domain (speech, presence) or the world of record (building,
  movement). Built-in verbs are ordinary code and carry no fuel budget; only
  softcode is metered — that boundary is now a visible line in the code, and
  the `$`-command path (a later session) slots in beside it as the one metered
  branch.
- **Building verbs (GM-R7).** dig, open, create, set, name, describe, lock —
  each respecting ownership and the capability tiers, each an audited write to
  the world of record. Opening an exit requires controlling the room you open
  it in; a plain builder builds in rooms they dug, and wiring exits from shared
  rooms is a wizard's job — the same shape the reference had, without inventing
  its room-flag machinery yet.
- **Movement and name matching (GM-R6 / GM-R12).** go/enter/leave, and the
  resolution that turns `me`, `here`, a `#dbref`, or a partial name into an
  object — scoped to what you can actually see. An exit's lock gates who may
  pass; another player failing that lock is now a real, tested refusal.
- **The proof.** A scripted session — dig two rooms, open exits both ways,
  create and lock a thing, have a second player fail the lock, move so presence
  fires — runs green through the real Postgres-backed stack, with the durable
  arrive/depart record checked. Nothing is hosted; the acceptance run is a
  local gate, exactly like the sandbox proof.

## The compatibility harness (GM-R22)

A returning user from the early-90s reference should onboard with minimal
relearning — that is the STEERCO minimum bar. This session built the **harness
that makes it testable**: the player-facing command surface is now *data*, and
a conformance runner drives each command's syntax through the real parser and
checks it lands in the right behavior class.

Here is the honest part. The **canonical reference command list is still a
preservation task** — captured separately, not yet finished. So every command
in the harness today traces to one of GenMURK's own requirements of record, not
to anyone's memory of the wider MUSH family; the runner rejects any name that
can't be traced that way. Coverage reads 100% of a *provisional* set, and the
harness says so loudly. The day the canonical list lands, it drops straight in
as data and coverage becomes a real number — with the gaps named, not hidden.
Where the sandbox forces a difference from the reference (it always wins), the
divergence is recorded and rendered for returning users on the new
[compatibility page](/compatibility/).

Still localhost, still nothing hosted — the running world lives behind the
sandbox gate, and hosted exposure is a later, separately-authorized step. What
changed is that GenMURK is now a world you can *build in*, and a compatibility
promise that has teeth.
