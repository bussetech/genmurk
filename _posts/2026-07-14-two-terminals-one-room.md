---
layout: post
title: "Two terminals, one room: presence and speech go live (on localhost)"
date: 2026-07-14
description: "GenMURK is now a place you can be in together: players connect, see each other arrive and leave in real time, and talk — room-scoped, push-delivered, with message order proven consistent for every observer. The transport decision is settled and recorded. Two terminal clients on one laptop, nothing hosted — exactly that, and no more."
---

Until this session, GenMURK had an engine that runs untrusted programs safely
and a world model with provable authorization — but every interaction with it
was a test asserting on a return value. This session made it a *place*: two
terminal windows on one laptop, each a connected player; one types `go south`
and the other's window prints the arrival, live; both talk, and the room hears
them. That is what a MUD/MUSE of this lineage *is* — a chat domain with spatial
scoping — and it now exists, on localhost, and nowhere else.

## The one open architecture call, settled

The [decisions page](/decisions/) had left exactly one transport question
open: what carries presence and speech in real time (GM-R1..R4)? It's now
settled — **WebSocket, with a single-writer-per-room coordinator** — and the
reasoning is recorded in public, rejected options and all. The short version:
the requirement that decides it is *ordering*. GM-R4 demands that everyone in
a room sees messages in the same order, and the honest way to get that is by
construction: one single-threaded writer per room assigns each event's
sequence number and delivers it in the same breath. The alternatives put that
guarantee in a reconciliation layer — which is to say, in hope.

## Order is proven, not promised

The ordering guarantee has an automated proof: simulated clients on separate
sockets race concurrent speech into one room — fifty rounds per CI run, with
movement interleaved into the stream — and every observer's transcript must
be identical, byte for byte, or the build fails. Room scoping is proven the
same way: a client in another room receives **zero events** — not events its
client filters out; zero arrive at its socket at all.

The same discipline guards the softcode sandbox. The transport must never
become a second capability surface for player programs, so the boundary is
asserted by test from four directions — the engine's module graph cannot
reach the server code, the capability handle a program receives has no
transport-shaped surface, hostile programs that reach for one are refused,
and the single sanctioned door (world-API-mediated speech) lands room-scoped
and nowhere else. Escape stays what it has been since the engine spike:
absent, not denied.

## Honest edges

What runs today is a development harness. The session-to-player binding is a
loud placeholder — real authentication is its own upcoming piece of work
(GM-R15/GM-R18), and nothing will be exposed beyond localhost before it and
the standing sandbox gate say so. The command words you'd type (`say`,
`page`, `go`) are working placeholders too: GenMURK's real player-facing
command set is the reference's, and that list arrives from the preservation
capture as data — it is deliberately not being invented from memory here.
The mechanics beneath the words — room fan-out, directed cross-room
messages, the privileged broadcast, movement as a channel switch — are built
and tested, and they survive whatever the words turn out to be.

Nothing is hosted. Nothing is exposed. Two terminals on one laptop heard each
other in real time, in the right order, and that is exactly as much as is
true today.
