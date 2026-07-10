---
layout: post
title: "GenMURK is building in public"
date: 2026-07-10
description: "The GenMURK build-in-public site is live: the decomposition is done and the rebuild plan is set. PROD is EPIC5."
---

**GenMURK** — a modern multiplayer text world (MUD/MUSE), a clean-room rebuild on
modern architecture — is now building in public. This living-documentation site
is the build log, and it starts with real ground already covered:

- **Decomposition is done.** The reference behavior is decomposed into four
  subsystems and twenty behavioral requirements
  ([GM-R1..R20](/decomposition/)).
- **The rebuild backlog is set,** ranked highest-risk-first — the sandboxed
  softcode runtime leads ([backlog](/backlog/)).
- **Architecture direction is recorded,** with one call honestly still open
  ([decisions](/decisions/)).
- **The artifact we studied is on the record** — TinyMUSE and the mid-90s MIT
  MicroMUSE instance, as lineage and reference only, never GenMURK's identity
  ([museum](/museum/)).

This site is **documentation, not PROD.** The running GenMURK app lives
separately at `genmurk.com` (a Workers-class runtime with a Supabase database)
and stands up in **EPIC5**. This is the first feed item — the studio portal
aggregates `/feed.json` from every project site, so publishing here is how
GenMURK's build surfaces on the studio homepage.

GenMURK is **instance 1** of the studio's build-in-public pattern.
