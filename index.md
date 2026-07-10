---
layout: home
title: GenMURK
description: "GenMURK — a modern, multiplayer text world (MUD/MUSE): a clean-room rebuild on modern architecture, inspired by the TinyMUSE engine and the mid-90s MIT MicroMUSE instance. Build-in-public living docs; the running app lives at genmurk.com."
---

**GenMURK** is a modern **multiplayer text world** — a MUD/MUSE: many people
share one live, navigable place made of rooms, exits, and things, talk in real
time, build the world out, and extend it by writing in-world code. It is a
**clean-room rebuild on modern architecture**, worked from decomposed
requirements — not an adoption or line-by-line port of any older engine.

**Lineage (reference only).** GenMURK studies **TinyMUSE** (a ~31k-line 1990s C
MUD/MUSH server in the TinyMUD → TinyMUSH family) and the mid-90s MIT
**MicroMUSE** instance as *historical behavioral reference*. They are named as
lineage on the [museum page](/museum/) — never adopted, never ported
line-by-line, never GenMURK's own code or identity. The name honors the
MUD/MUSE family (MURK — the earthy sibling of mud/muck/mush).

If you remember these worlds — if you ever wrote softcode on a MUSH or a MUSE —
there's [a note for you on the museum page](/museum/).

## Build in public — the story so far

This is the build log, published as it happens. Where things stand today:

- **Decomposition is done.** The reference behavior is decomposed into four
  subsystems and twenty behavioral requirements (GM-R1..R20).
- **The rebuild backlog is set,** ranked highest-risk-first — the sandboxed
  softcode runtime leads.
- **Architecture direction is recorded,** with one decision honestly still
  open (how the softcode sandbox is built).
- **PROD is EPIC5.** No application ships from here.

Read on:

- **[Decomposition & requirements](/decomposition/)** — the four subsystems and
  the behavioral spec (GM-R1..R20) extracted from the reference.
- **[Rebuild backlog](/backlog/)** — what's next, ranked; the softcode-sandbox
  spike first.
- **[Decisions](/decisions/)** — the architecture decision log in public,
  including the one that's still open.
- **[Museum](/museum/)** — the artifact we studied, honestly labelled.

## Two surfaces, two homes (do not conflate)

This site is **documentation, not PROD.** It is the *story* of the build.

- **This site — the build log** — lives at `genmurk.bussetech.com`, a normal
  studio subdomain: static, public, and **secrets-free by construction**.
  There is no runtime, no login, no data here to leak.
- **The running GenMURK app** lives separately at **`genmurk.com`** — a
  Workers-class runtime with a Supabase database, standing up in **EPIC5**.
  The app is never deployed to these Pages.

GenMURK is built by a one-person software studio: one human plus a governed
workforce of small, single-task agents ("gnomes"), every change arriving as a
reviewed pull request. This log tells the honest story of that work.

This is a [Bussetech Software Studio](https://bussetech.com) project —
`bussetech | software studio`. It is **instance 1** of the studio's
[build-in-public pattern](https://bussetech.com). The whole build is in the
open: **[github.com/bussetech/genmurk](https://github.com/bussetech/genmurk)**.
