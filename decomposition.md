---
layout: page
title: Decomposition & requirements
eyebrow: The build
description: "The four subsystems of a MUD/MUSE and the twenty behavioral requirements (GM-R1..R20) GenMURK's clean-room rebuild must satisfy — a behavioral spec extracted from the reference, not code to port."
permalink: /decomposition/
---

These are **behavioral requirements** — *what* GenMURK must do — read from the
observed behavior of the reference system. They are not code to port and not a
line-by-line map of any original source. The rebuild cites **these
requirements**, never original engine source lines. (Provenance and licensing:
see the [museum](/museum/).)

## The domain, decomposed

Stripped to behavior, a MUD/MUSE of this lineage is a single shared, real-time
text world made of four coupled subsystems. GenMURK's requirements are organized
by them.

### D1 — Real-time multi-user presence & communication
Many players connected at once, each situated in a "room" (a location), seeing
each other's presence and utterances in real time. It is a **chat domain with
spatial scoping**: you hear what is said in your room; paging crosses rooms;
announce/broadcast is a privileged act.

### D2 — A navigable world of objects
A graph of typed objects — **rooms, exits, things, players** — with attributes,
ownership, containment, and boolean lock expressions. Behavior to preserve:
object creation, attribute get/set, locks over boolean expressions, ownership and
inheritance, containment and movement, and name resolution.

### D3 — The user-programmable softcode interpreter
The defining feature and the defining risk. Players attach code to objects that
the server evaluates in response to commands and events — substitutions, a
function library, `$`-commands, a command queue, wildcard matching, styled
output. This is a **sandboxed, per-object, event-triggered scripting language** —
the thing that makes a MUSE a MUSE rather than a chat room.

### D4 — Administration, powers & moderation
A graded capability model (owner → builder → wizard → god equivalent), admin
commands, player warnings, in-world mail, and recoverable object destruction.
Behaviorally this is **RBAC over the world model plus moderation tooling**.

## Requirements of record (GM-R1..R20)

Each is tagged **[core]** (must exist for GenMURK to be recognizably the same
kind of thing), **[faithful]** (behavior worth preserving from the reference), or
**[modernize]** (a place where industry standards, security practice, or
platform patterns have advanced since the reference was written — the rebuild
adopts the current pattern). These are *what*, not *how*.

### Presence & communication (from D1)
- **GM-R1 [core]** — concurrent players share one live world; presence (who is
  here, who arrived/left) is observable in real time.
- **GM-R2 [core]** — room-scoped speech: say/emote reach exactly the occupants of
  the speaker's current room.
- **GM-R3 [faithful]** — cross-room directed messages (page/whisper) and a
  privileged broadcast (`@announce`).
- **GM-R4 [modernize]** — delivery is **push** (server → client, no client poll),
  over a modern real-time transport; message order within a room is consistent
  for all observers.

### World model (from D2)
- **GM-R5 [core]** — four object types (room, exit, thing, player), each with
  stable identity, an owner, and a free-form attribute map.
- **GM-R6 [core]** — a spatial graph: rooms linked by exits; players and things
  have a location; containers hold things; movement updates location and fires
  presence events.
- **GM-R7 [faithful]** — building verbs: dig a room, open an exit, create a
  thing, set attributes, name and describe.
- **GM-R8 [faithful]** — boolean locks: attribute/ownership predicates gate use,
  entry, and pickup, evaluated per action.
- **GM-R9 [faithful]** — ownership, quotas, and attribute inheritance from parent
  objects; destruction is recoverable within a window.
- **GM-R10 [modernize]** — the bespoke flat-file database is replaced by a
  transactional store (Postgres/Supabase). The **on-disk format is not a
  requirement**; the object/attribute/lock *semantics* are. Durability,
  concurrent writers, and backup become table stakes.

### Softcode (from D3)
- **GM-R11 [core]** — a user-programmable, per-object scripting capability:
  players attach code to attributes that the server evaluates in response to
  commands/events, with substitutions, a function library, and a fairly scheduled
  command queue.
- **GM-R12 [core]** — wildcard/pattern matching for command dispatch, plus name
  matching (`me`, `here`, partial names, `#dbref`).
- **GM-R13 [faithful]** — styled (ANSI/markup) output, driven by softcode.
- **GM-R14 [modernize — HARD REQUIREMENT]** — the interpreter is a **sandbox by
  construction, not by hope.** It MUST enforce CPU/step/recursion/queue budgets,
  deny host/network/filesystem access, and treat all softcode as untrusted input.
  Running a user-programmable interpreter as a network daemon without resource
  isolation reflected the deployment norms of the reference's era; current
  security standards call for sandbox-by-construction, and adopting that pattern
  is the single most important requirement of the rebuild — it gates any hosted
  exposure.

### Admin, powers & moderation (from D4)
- **GM-R15 [core]** — a graded capability model (owner → builder → wizard → god
  equivalent), enforced server-side on every privileged verb.
- **GM-R16 [faithful]** — moderation: player warnings, boots/silences, object
  destruction with audit.
- **GM-R17 [faithful]** — in-world mail between players.
- **GM-R18 [modernize]** — modern authentication: a salted KDF (argon2/bcrypt
  class) is today's standard in place of the era's fixed-salt DES password
  hashing; **no default god/wizard
  credentials ship** — first boot provisions the god account with a rotated
  secret.

### Cross-cutting non-functional
- **GM-R19** — secrets live in the provider-native store, never in git, never in
  an agent, never in the schema; a health endpoint for the running app.
- **GM-R20** — **preservation honesty:** a [museum / behavioral-reference
  page](/museum/) documents "this is the artifact we studied," with the MUD/MUSE
  lineage and MicroMUSE history — never presented as GenMURK's own code or
  identity, never wired into CI or the running product.
- **GM-R22 [faithful — onboarding]** — **end-user command-set compatibility
  (STEERCO minimum bar):** GenMURK supports at minimum the same player-facing
  command set — verb names and invocation syntax — as the TinyMUSE/MicroMUSE
  reference, so **historic users onboard with minimal relearning.** The surface
  is preserved; the implementations are GenMURK's own and the security model is
  modernized (GM-R14). The canonical command list is a preservation task (drawn
  from the behavioral reference and historic-user knowledge, tracked separately);
  where a reference command conflicts with the sandbox requirement, the safe
  behavior wins and the divergence is documented.

## Where these go next

The requirements above feed the ranked [rebuild backlog](/backlog/); the
architecture direction and the still-open questions are on the
[decisions](/decisions/) page. PROD is EPIC5 work.
