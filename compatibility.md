---
layout: page
title: Command compatibility
eyebrow: For returning users
description: "GenMURK preserves the player-facing command surface of the TinyMUSE/MicroMUSE reference (GM-R22) so historic users onboard with minimal relearning — here is the compatibility state and the honest list of where GenMURK diverges, and why."
permalink: /compatibility/
---

If you played a MUSE of this lineage in the early 90s, GenMURK is meant to feel
familiar under your fingers. **GM-R22** — the command-set compatibility
requirement — says GenMURK supports *at minimum the same player-facing command
set* (verb names and invocation syntax) as the reference, so you can pick up
where you left off. The implementations are GenMURK's own clean-room code and
the security model is modernized; what is preserved is the **surface you type**.

## The honest state: compatibility is being built to a preserved list

The canonical reference command list is a **preservation task** — captured
from the behavioral reference and historic-user knowledge, tracked separately
and not yet finished. Until it lands, the commands GenMURK ships are drawn
**only from its own requirements of record**, not from anyone's memory of the
wider MUSH family — that is a deliberate provenance discipline, not a shortcut.
So this page describes a surface that is **provisional**: verb names and
argument punctuation may be reconciled when the canonical list arrives.

What works today, end to end: **speaking** (say, emote), **reaching people
elsewhere** (page, whisper, announce), **getting around** (go, enter, leave,
look), **building** (dig, open, create, set, name, describe, lock), and —
the thing that makes a MUSE a MUSE — **programming the world**: attaching
`$`-commands to objects (an attribute valued `$<pattern>:<program>`, wildcard
captures and all), event triggers that run when someone arrives or uses a
thing, a fairly-scheduled command queue, and softcode-driven styled output.
The `$` sigil is preserved from the domain; the exact separator punctuation
is one of the details the canonical capture will settle.

## Where GenMURK diverges — and why

Compatibility has one hard limit: **the sandbox always wins**. GenMURK runs
player-written softcode as untrusted input under strict resource budgets
(GM-R14), because running a programmable interpreter open to the network
without isolation reflected the norms of the reference's era, and current
security practice calls for sandbox-by-construction. Where a reference command
would conflict with that, GenMURK keeps the *safe* behavior and records the
difference here. This is the state of the art advancing — the reference is
honoured as what taught the domain.

- **User softcode never shadows a built-in command.** A `$`-command only
  matches a line no fixed verb claims, so an object in a room can never
  intercept another player's `go`, `lock`, or `quit` — that would be a
  spoofing vector, and modern security practice keeps fixed verbs fixed. If
  the canonical capture shows the reference resolved this differently, the
  difference will be recorded here; the safe behavior stays.
- **Styled output is a fixed vocabulary, never raw escape codes.** Softcode
  styles text through markup that the client renders from a fixed table
  (emphasis and the classic colors). Raw terminal control bytes are stripped
  at the server boundary, whatever path they arrive by — styling can
  decorate your transcript, never rewrite someone else's terminal.
- **Locks — bounded expression grammar.** A lock's boolean *expression*
  (the "key") accepts a deliberately-bounded, safe subset of the reference's
  key language. Where the reference key form is richer, GenMURK rejects it
  outright rather than approximating it — a lock must never *accidentally*
  open. The lock verbs and the three lock kinds (enter, use, pickup) are
  preserved; only the expression grammar is narrowed.

Two surface details are still open pending the canonical capture, and are noted
so nothing here overclaims: whether the reference used a prefix (such as `@`) or
a `/switch` convention on building verbs, and the exact argument punctuation.
The provisional surface uses bare verb names and `=` to separate a target from
its payload; the capture will settle both.

*The machine-checked source of this page is the compatibility harness in the
application repository (`app/gm-r22/`), which runs on every change; this page is
its returning-user narrative.*
