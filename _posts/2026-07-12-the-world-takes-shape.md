---
layout: post
title: "The world takes shape: rooms, objects, and a provable wall"
date: 2026-07-12
description: "GenMURK now has a world model on Postgres — four object types with attributes, locks, ownership, containment, and recoverable destruction — and its authorization is provable: an isolation suite signs in at every capability tier and asserts, to the exact row, that a player sees the room they are in and not the database. Localhost only; nothing is hosted."
---

The engine can run untrusted programs safely. This session gave those programs
a **world** to run in: rooms, exits, things, and players, on Postgres, with the
semantics the reference taught the domain — a free-form attribute map on every
object, boolean locks, ownership and quotas, attribute inheritance, and
destruction you can undo. The reference stored all this in a bespoke flat file;
the state of the art is a transactional database, so that is where GenMURK's
world lives. What we kept is the *meaning*, not the file format (GM-R10).

## One kind of object, four shapes

Rooms, exits, things, and players share one table and one `#dbref` number
space, because in this domain they are the same kind of thing wearing different
hats: they all have a stable identity, an owner, and an attribute map; movement
treats a player and a thing identically. The differences — a room has no
location, an exit points somewhere — are enforced by the database itself, not
by hopeful application code. Identity numbers are minted once and never reused,
even after you destroy and recover an object.

## The wall you can prove

The most important property of a multiplayer world is that **a player sees the
room they are in, not the database.** It is easy to claim and easy to get
wrong, so we made it provable. Authorization lives in the database as
row-level security, deny-by-default, and a read you're not entitled to comes
back as *zero rows* — never an error that would leak the fact that something is
there.

The proof is a test suite that signs in as players at every capability tier —
an ordinary player, a builder, a wizard, a god — against a real local database
and asserts, to the exact count, what each one sees. A builder in the Town
Square sees the square, whoever is standing in it, the exits, and what she
owns — and nothing of the Dark Cave or the player in it. A visitor standing
next to a lantern can read its public description but not the secret written
inside it. A wizard sees the whole world, including the recovery bin and the
audit trail. Anonymous sees nothing anywhere. Thirty-odd assertions, all green.

## Locks, inheritance, and a careful seam

Locks are stored as data and evaluated by a small, bounded boolean language
(`is the actor this object, or carrying it? does their rank attribute match?`),
and a malformed lock fails *closed* — a corrupt lock never accidentally opens.
Attributes inherit from parent objects with a documented, tested resolution
order. Every change to the world goes through an audited, permission-checked
database routine; there is no raw write path for a player or a builder.

One real piece of engineering deserves a note: the engine is synchronous — it
cannot wait on a database mid-thought — so a run works against a **snapshot** of
the player's corner of the world, loaded before the run and committed after it.
That is what lets a database-backed world satisfy the engine's safety seam
unchanged. We proved it by swapping the real world model in behind the
adversarial pack: all 21 hostile fixtures still pass, budgets intact, across
real world I/O.

As always: this runs on localhost and in CI only. There is no transport, no
accounts, nothing hosted — those are later, and gated. What exists today is a
world with a wall around it, and a receipt that the wall holds.
