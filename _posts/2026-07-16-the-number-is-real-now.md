---
layout: post
title: "The number is real now — measuring GenMURK against the reference"
date: 2026-07-16
description: "The canonical list of the reference's commands landed, so compatibility stopped being a promise and became a measurement: about 60% of the player-facing command set, honestly counted, bar not yet met. This build lands the list as machine-checked data, accepts the reference's own faithful command forms, adds the everyday verbs that were missing, and publishes the gap list as the work order. Still localhost; the sandbox gate holds."
---

For weeks the compatibility claim sat behind an honest caveat: GenMURK aims to
feel familiar to anyone who played a MUSE of this lineage — the same commands
under your fingers — but we couldn't *prove* it, because the canonical list of
the reference's commands was a preservation task that hadn't landed. Every
command we shipped was labelled provisional and traced to our own requirements,
never to memory of the wider family. The last build-log post said the claim
"stays honestly withheld — the honest state, not a green light we haven't
earned."

That list has now landed. So this is the build where compatibility stops being
a promise and becomes a number.

## What the number is

The reference's parser recognizes **140 built-in commands**. The bar that
matters — the one the requirement actually names — is the *player-facing* set:
the verbs a user types to play and to build. Measured against that bar today,
GenMURK covers **about 60%** — 32 of 53 player-facing commands. The everyday
verbs are about half; the builder verbs about three-quarters.

**The bar is not met.** Sixty percent is round one, not the finish line. We are
telling you the number rather than rounding it up, and the same page that
carries the number carries the list of what's still missing — give, home,
follow, use, help, and a handful more — as the standing work order.

The other ~90 reference commands are the wizard/god machinery for running a
server: shutting it down, dumping the database, rebooting. Those are handled as
operational tooling, not as in-world god verbs, and they're counted as out of
the player-facing bar — *counted*, not quietly dropped, because the harness
checks that the in-bar commands plus the out-of-bar ones add back up to 140.
You can't inflate a percentage by shrinking its denominator when the denominator
is machine-checked.

## Speaking the reference's own dialect

The reference has its own spelling. Building verbs wear an `@` — `@dig`,
`@open`, `@lock`. Mail is `+mail`. The social verb is `pose`, with `"`, `:`, and
`;` as one-key shortcuts. This build teaches GenMURK to accept all of those
faithful forms — and to keep the shorter bare forms (`dig`, `mail`, `emote`,
`go`) as conveniences, so neither the muscle memory of a 1993 builder nor the
habits of a newcomer get punished. A prefixed command GenMURK doesn't implement
just falls through as unknown; it never silently pretends to be something else.

## The verbs you reach for first

We also built the everyday verbs the reference has that GenMURK was missing:
**look at a thing**, **examine** it in full (if it's yours — otherwise you see
its public face), check your **inventory**, and see **who** is connected and
where. Small verbs, typed constantly, the difference between a world that feels
built and one that feels like a demo. They're plain built-ins, carry no fuel
budget, and touch no database schema — just reading what's already there.

## Still honest about where this runs

All of it is localhost. The sandbox gate that runs player-written code under
strict budgets still stands, unchanged; nothing about GenMURK is hosted,
exposed, or demoed beyond a machine's own loopback. What changed today is that
"returning users onboard easily" now has a measurement behind it — a partial
one, honestly partial, with the rest of the road drawn on the map.
