---
layout: page
title: Command compatibility
eyebrow: For returning users
description: "GenMURK preserves the player-facing command surface of the TinyMUSE/MicroMUSE reference (GM-R22). The canonical command list has now been reviewed and measured: here is the real coverage number, what still needs building, and the honest list of where GenMURK diverges — and why."
permalink: /compatibility/
---

If you played a MUSE of this lineage in the early 90s, GenMURK is meant to feel
familiar under your fingers. **GM-R22** — the command-set compatibility
requirement — says GenMURK supports *at minimum the same player-facing command
set* (verb names and invocation syntax) as the reference, so you can pick up
where you left off. The implementations are GenMURK's own clean-room code and
the security model is modernized; what is preserved is the **surface you type**.

## The honest state: the list has landed, and coverage is now a real number

The canonical reference command list — a preservation task, drawn from the
behavioral reference and historic-user knowledge and tracked separately — has
now been **reviewed and dropped in** as the machine-checked data behind this
page. So this is no longer a provisional surface described against our own
requirements: it is measured against the reference itself.

The reference's parser recognizes **140 built-in commands**. GM-R22's bar is
the **player-facing** subset — the verbs a user types to play and to build.
Measured against that bar today:

- **Player-facing coverage: about 60%** (32 of the 53 player-facing commands).
  The everyday-player verbs are about half covered; the builder/construction
  verbs about three-quarters.
- **The minimum bar is not yet met.** There are real gaps (below); this is
  round one of the compatibility work, not the finish line. We would rather
  tell you the number than round it up.

The other ~90 reference commands are **out of the player-facing bar** and are
not reproduced as in-world commands: the large wizard/god
server-and-database administration set (shutting the server down, dumping the
database, rebooting) is handled as operational tooling, not as in-world god
verbs; the channels system and the economy are out of this chapter's scope.
None of that is hidden — it is counted, and the count is checked in CI so the
percentage can't be quietly inflated by dropping commands from the denominator.

## What works today, end to end

**Speaking** (say, pose — and the `"` / `:` / `;` tokens), **reaching people
elsewhere** (page, whisper, @announce), **getting around** (goto/move, enter,
leave), **looking** (look, look &lt;thing&gt;, examine, inventory), **seeing
who's on** (who), **handling things** (get/take, drop/throw — over a thing's
pickup lock), **building** (@dig, @open, @create, @set, @name, @describe,
@lock), **taking a destruction back** (@destroy, @undestroy within a recovery
window), **in-world mail** (+mail), **moderation** for wizards (@boot, warn,
silence, unsilence, all audited), and — the thing that makes a MUSE a MUSE —
**programming the world**: attaching `$`-commands to objects, event triggers,
a fairly-scheduled command queue, and softcode-driven styled output.

**Faithful forms, kept conveniences.** The reference prefixes its building and
admin verbs with `@` (`@dig`) and its mail command with `+` (`+mail`), and its
social verb is `pose`. GenMURK accepts all of those faithful forms — and *also*
keeps the shorter bare forms (`dig`, `mail`, `emote`, `go`) as documented
conveniences, so neither muscle memory is punished.

## What still needs building (the gap list)

These reference commands are player-facing and **not yet built** — this is the
work order for the next rounds, roughly in the order returning users will miss
them:

- **Everyday:** give, home, follow, use, help, news, join, summon, to, gripe.
- **Status/session:** +away, +haven, +idle, +laston, +uptime, +version.
- **Builder:** @link, @unlink, @unlock, @clone, @trigger.

## Where GenMURK diverges — and why

Compatibility has one hard limit: **the sandbox always wins**. GenMURK runs
player-written softcode as untrusted input under strict resource budgets
(GM-R14). Where a reference command would conflict with that, GenMURK keeps the
*safe* behavior and records the difference here.

- **User softcode never shadows a built-in command.** A `$`-command only
  matches a line no fixed verb claims, so an object can never intercept another
  player's `go`, `@lock`, or `quit`.
- **Styled output is a fixed vocabulary, never raw escape codes.** Raw terminal
  control bytes are stripped at the server boundary, whatever path they arrive
  by.
- **Locks — bounded expression grammar.** A lock's boolean *key* accepts a
  deliberately-bounded safe subset (boolean operators, `#N` keys, `owner(#N)`,
  `ATTR:glob`); richer reference key forms are rejected outright rather than
  approximated, and evaluation is bounded in length, depth, and steps, and
  *fails closed*.
- **Picking things up honours the pickup lock.** `get` checks a thing's pickup
  lock before it moves; an unlocked thing is takeable by anyone present (the
  reference default).
- **`examine` respects who you are.** You see a thing's full attributes and
  locks only when you control it (you own it, or you're a wizard); otherwise you
  see its public face — name, owner, description. One visibility rule decides
  it, the same one the rest of the world uses.
- **`who` lists who is connected**, with the room they're in and a count; the
  reference's idle/on-since columns are a later detail.
- **Undestroy is by number, not by name.** A destroyed object leaves your view,
  so you take it back with `@undestroy #<number>` — the number the destroy
  confirmation prints.
- **Moderation only reaches down.** A wizard can warn, boot, or silence players
  *below* their tier; no one can moderate an equal-or-higher tier, and the root
  god is never a target. Every act is audited. Mail is quota-bounded and
  wizard-readable for moderation; v1 mail is body-only from the command line.
- **`pose` and its tokens** carry the faithful names; the `;` no-space
  possessive form currently renders with standard pose spacing (a minor
  cosmetic detail, correct attribution preserved).

*The machine-checked source of this page is the compatibility harness in the
application repository (`app/gm-r22/`), which runs on every change; this page is
its returning-user narrative.*
