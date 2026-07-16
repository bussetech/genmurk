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
look), **handling things** (get, drop — over a thing's pickup lock),
**building** (dig, open, create, set, name, describe, lock), **taking a
destruction back** (destroy, undestroy within a recovery window),
**in-world mail** (mail — send, list, read, delete), **moderation** for
wizards (warn, boot, silence, unsilence, all audited), and — the thing that
makes a MUSE a MUSE — **programming the world**: attaching `$`-commands to
objects (an attribute valued `$<pattern>:<program>`, wildcard captures and
all), event triggers that run when someone arrives or uses a thing, a
fairly-scheduled command queue, and softcode-driven styled output. The `$`
sigil is preserved from the domain; the exact separator punctuation is one of
the details the canonical capture will settle.

A scripted **v1 playable slice** ties the whole thing together — register and
log in, walk and talk across rooms, build and lock, attach a `$`-command
another player triggers, page and mail, a wizard moderates, and a destroy is
taken back — running green end to end on the local stack every build.

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
  key language: boolean operators, `#N` keys (you *are* or *carry* the
  object), `owner(#N)` (you *own* the object), and `ATTR:glob` attribute
  predicates. Where the reference key form is richer, GenMURK rejects it
  outright rather than approximating it — and evaluation is itself bounded in
  length, nesting depth, and steps, so a hostile lock terminates fast and
  *fails closed*. A lock must never *accidentally* open. The lock verbs and
  the three lock kinds (enter, use, pickup) are preserved.
- **Picking things up honours the pickup lock.** `get` checks a thing's
  pickup lock before it moves; an unlocked thing left in a room is takeable by
  anyone present (the reference default), a locked one only by whoever passes
  its key.
- **Undestroy is by number, not by name.** A destroyed object leaves your
  view (only wizards see the recovery bin), so you take it back with
  `undestroy #<number>` — the number the destroy confirmation prints, along
  with how long you have. Naming a thing you can no longer see would be a
  fiction; the number is honest.
- **Moderation only reaches down.** A wizard can warn, boot, or silence
  players *below* their tier; no one can moderate an equal-or-higher tier, and
  the root god is never a target. Every moderation act is written to an audit
  trail (who, what, when, why). Mail is quota-bounded (a capped inbox) and
  readable by wizards for moderation; its subject-line syntax is one more
  detail the canonical capture will settle (v1 mail is body-only from the
  command line).

Two surface details are still open pending the canonical capture, and are noted
so nothing here overclaims: whether the reference used a prefix (such as `@`) or
a `/switch` convention on building verbs, and the exact argument punctuation.
The provisional surface uses bare verb names and `=` to separate a target from
its payload; the capture will settle both.

*The machine-checked source of this page is the compatibility harness in the
application repository (`app/gm-r22/`), which runs on every change; this page is
its returning-user narrative.*
