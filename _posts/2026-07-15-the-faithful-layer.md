---
layout: post
title: "The faithful layer — and a whole world you can actually play"
date: 2026-07-15
description: "Locks you can own as well as carry, in-world mail, moderation with an audit trail, and destruction you can take back — the behaviors that make GenMURK recognizably the reference's descendant. Then all of it, plus everything built before, tied together in one scripted playthrough that runs green end to end on the local stack. Nothing is hosted; the sandbox gate holds."
---

A text world of this lineage is more than rooms and speech. It is the small,
human machinery that made people stay: a chest only you can open, a note left
for someone who is offline, a wizard who can quiet a troublemaker and undo it
after, a room you deleted by mistake and got back. None of it is flashy. All of
it is what made a MUSE feel *lived in*. This build adds that faithful layer —
and then does something the project has been building toward for weeks: it plays
the whole thing through, start to finish, in one automated scripted session.

## Locks you can own, not just carry

A lock in GenMURK is a boolean expression stored as data — "you may pass if you
are #5, or carry #5, or your RANK is gold." This build completes it with the
predicate the requirements always named and we had not yet built:
**`owner(#N)`** — pass if you *own* the object. A guild door can now open for
whoever the guild charter belongs to, a thing a key alone can't express.

Locks are untrusted input, so their evaluation is bounded three ways — how long
the expression can be, how deeply it can nest, and how many steps it may take —
and anything hostile or malformed **fails closed**: a lock never *accidentally*
opens. We threw nesting bombs and catastrophic patterns at it; it shrugs them
off in bounded time. And with the pickup lock finally having an action to gate,
you can now **take** a thing from a room and **drop** it back — over that lock,
exactly as a returning player would expect.

## Mail, moderation, and taking a deletion back

**Mail** is player-to-player, durable until you delete it, quota-bounded so no
one can flood your inbox, and readable by wizards for moderation — while the
body is never written to any audit log. It reaches people in other rooms, and
even people who are offline.

**Moderation** is the wizard's toolkit — warn, boot, silence, unsilence — and
every act is written to an audit trail: who did what, to whom, when, and why.
The tooling only reaches *down*: no one can moderate an equal-or-higher tier,
and the root god is never a target. A silence gags speech and mail at once, and
lifts cleanly.

**Destruction you can take back:** `destroy` tells you plainly how long you have
and the number to recover with, and `undestroy #N` brings it back within the
window. You recover by number, not name, because a destroyed thing has left your
view — and we would rather be honest about that than pretend you can still see
it.

## The whole world, played through

Here is the part that matters most. Every feature above, and everything built
before it, is now tied together in a single scripted playthrough that runs on
every build:

> A new player **registers and logs in**. Two others **walk and talk** across
> rooms. A wizard **builds a locked room** and a locked object; another player
> is refused by both. The wizard **attaches a `$`-command** to the room, and a
> second player **triggers it** — styled text answers, and the world records
> it. They **page and mail** each other. The wizard **moderates** — silences,
> warns, boots — and the audit trail is checked. Finally the wizard **destroys**
> a thing and **takes it back**.

That scenario is green, end to end, through the real database, on every change —
a new CI job stands the stack up on the runner and plays it. It is the clearest
answer yet to "is this actually a world you can play?" It is. On localhost only:
the sandbox gate still stands, and nothing about GenMURK is hosted, exposed, or
demoed beyond a machine's own loopback.

## Honest about the one thing still open

GenMURK aims to feel familiar to anyone who played a MUSE of this lineage — the
same commands under your fingers. We can't yet *prove* that bar is met: the
canonical list of the reference's commands is a preservation task that hasn't
landed, so every command we ship is still labelled provisional and traced to our
own requirements, never to memory of the wider family. The compatibility harness
now covers the full verb surface and says exactly this, loudly. Until that
capture arrives, the "returning users onboard easily" claim stays honestly
withheld — the honest state, not a green light we haven't earned.
