---
layout: post
title: "Softcode meets the world: $-commands, triggers, and styled output"
date: 2026-07-15
description: "The thing that makes a MUSE a MUSE is now running on localhost: players attach code to objects and the world runs it — $-commands with wildcard captures, triggers that fire when someone arrives, a fairly-scheduled queue, and styled output — every line of it treated as untrusted input inside the sandbox, and proven hostile-first before anything is ever hosted."
---

A MUD where only the developers can add behavior is a chat room with
scenery. The defining feature of the MUSE lineage — the thing our behavioral
study of the early-90s reference kept circling back to — is that **players
program the world from inside it**: attach code to an object, and the server
runs it when someone types a matching command or walks into the room. As of
this session, GenMURK does that, on localhost, end to end.

Type `set gong = RING:$ring *:out.emit(...)` and the brass gong in your room
now answers anyone who types `ring three` — the wildcard capture lands in
the program as `%0`, the output enters the room's ordered stream like any
speech, and every occupant sees the gong (not you, not the server) speak.
Set `ON_ARRIVE` on a room and it greets whoever walks in. The command queue
schedules it all fairly across owners.

## Untrusted input, all the way down

The reference exposed its user-programmable interpreter to the network
without resource isolation — normal for its era; today the state of the art
asks more of us, and adopting it is the single most important requirement of
this rebuild. So everything above runs inside the sandbox the engine
sessions built, and this session extended the adversarial discipline to the
*world-integrated* attack surface:

- **A hostile object cannot hijack your verbs.** Built-ins always win: a
  `$say` pattern on an object in your room never intercepts your `say` —
  softcode only sees lines no fixed command claims.
- **A hostile object pays its own bills.** Attached code runs *as the
  object* but is budgeted *to the object's owner* — trip a booby-trapped
  room trigger and the refusal is the trap-setter's problem, never yours. A
  fleet of objects buys its owner no extra scheduler share.
- **Trigger loops die by arithmetic.** Object A triggers B triggers A — the
  chain terminates at the owner's execution quota, the world stays
  consistent, and the player next to you never notices. We proved it with a
  loop rigged to run forever.
- **Styled output cannot touch your terminal.** Softcode styles text through
  a fixed vocabulary of markup tokens; raw escape bytes are stripped at the
  server boundary no matter how they arrive, and the client renders style
  from a fixed table. We assert this on the actual wire bytes, over real
  sockets.

The adversarial pack grew to 24 fixtures across 8 attack classes — trigger
chains, cross-owner budget theft, styled-output smuggling — and stays green
in CI. The sandbox gate holds: nothing is hosted, exposed, or demoed beyond
localhost, and that remains true until the recorded proof and an explicit
go-ahead say otherwise.

## Honoring the domain

None of this invents a command surface. The `$` sigil and the trigger model
come from our own requirements of record, read from the reference's observed
behavior; the exact punctuation conventions historic users remember are
questions for the canonical command-set capture, which is still an open
preservation task. Where safety and fidelity pull apart — verb shadowing,
raw escape codes — the safe behavior wins and the difference is documented
for returning users on the [compatibility page](/compatibility/). The
reference taught the domain; the rebuild's job is to preserve what it got
right and to bring the security model up to today's standard.

Next on the ranked backlog: the real capability model — modern
authentication, graded powers, and the end of the loudly-labeled auth stub.
