---
layout: post
title: "Who may do what: real authentication and the graded capability model"
date: 2026-07-15
description: "The loudly-labelled auth stub is gone. GenMURK now authenticates with a modern password KDF, provisions its god account on first boot from a secret store with nothing shipped in the repo, enforces the owner→builder→wizard→god ladder server-side on every privileged verb (proven with an escalation matrix), and opens registration behind an optional instance passphrase — all on localhost, end to end. Nothing is hosted or exposed."
---

Every text world since the early 90s has had the same quiet question sitting
under it: *who may do what?* Who can build a room, who can force another player
across the map, who can speak to everyone at once — and who decided. The
reference we studied answered it with a graded ladder of powers and a god
account at the top, and that shape was right; it is the shape we kept. What it
answered with *underneath* — a fixed-salt password hash and a god account that
shipped with a known default credential — was normal for its era, and today the
security bar is simply higher. This is where GenMURK brings the model up to
that bar.

## The stub is gone

For the last few builds our connection layer accepted a placeholder token that
said, in effect, "trust me, I'm Alice." It was labelled loudly as *not
authentication* precisely so no one would mistake it for the real thing. It's
now deleted. A player authenticates against a modern password KDF
(argon2/bcrypt-class) and presents a **verified token**; the server checks the
token's signature and binds the session to exactly the player that principal
owns. A forged or expired token gets you nothing. The server never even sees a
password.

## No shipped keys — the god account is born on first boot

The single most important rule here: **no default credential exists anywhere in
this repository.** Not in the code, not in a seed file, not in a fixture, not in
the docs. A build check greps for exactly that and fails if a credential ever
sneaks in.

So where does the first god come from? A freshly created world contains God #1,
but with *no way to log in as it.* The first-boot procedure mints the god
account with a **rotated secret drawn from the secret store** and binds it —
once, idempotently. If you don't supply a secret, it generates one and prints it
a single time for you to store; it is never written to disk. A fresh world, a
provisioned god, a working login — all automated and checked.

## The ladder, enforced — and an escalation matrix to prove it

Owner → builder → wizard → god. Building requires a builder. Re-grading a
player's tier requires a god — and *only* a god, not even a wizard. Forcing
another player to move, destroying someone else's object for moderation,
broadcasting to every room: each privileged verb checks the tier through one
authorization seam, on the server, never the client.

The sharp case is softcode. A program attached to an object runs **as that
object**, under **its owner's** authority — and the player who trips it lends it
*nothing.* So a builder's gadget cannot borrow a wizard's power just because a
wizard walked past and set it off. We prove this with an **escalation matrix**:
for each tier against each privileged verb, an allowed case and a denied case,
including a builder-owned trigger reaching for power it must not have and being
refused — twice, once inside the sandboxed engine and again at the database
wall. All green.

## Coming in the front door

Once you can tell who may do what, you can decide who gets *in.* GenMURK ships
with three registration modes, and which one is live is the operator's call:
**closed** (only a god hands out accounts), **open** (anyone may make
themselves a character), and **passphrase** — open registration behind a single
shared phrase for the whole instance, the lightweight bouncer a small community
usually wants. The passphrase is a credential, so it's stored the same way
passwords are — hashed, never in the clear, never in the repo — and it's
checked *before* any account is created, so a wrong phrase makes nothing. A
freshly created player always arrives at the bottom of the ladder, in Limbo,
owning only itself; registering can never hand you power. The safe default is
closed, and opening the door is one deliberate command.

## Still on localhost, still honest

This is real authentication and real server-side authorization, exercised end to
end against a live local stack — and it is still **localhost only**. Nothing is
hosted, exposed, tunnelled, or demoed beyond this machine; the sandbox gate
stays the line everything waits behind. Hosted exposure, an apex domain, the
recurring ops tail — those remain later, authorized work, on the dependency
register. The player-facing command surface continues to follow the
compatibility discipline: the canonical historic command set is captured out of
band, never invented here, and where a reference command would fight the
sandbox, the safe behavior wins and the difference is written down
([/compatibility/](/compatibility/)).

Next on the ranked backlog: moderation and in-world mail — the tools a running
community actually needs — built on the capability model that now, finally, has
teeth.
