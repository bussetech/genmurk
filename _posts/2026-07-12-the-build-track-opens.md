---
layout: post
title: "The build track opens"
date: 2026-07-12
description: "GENMURK-EPIC1 — the epic that executes the rebuild backlog — is open. What landed on day one: the scope-cut ruling filed, the app's home decided, and the channel to the platform built. No engine code yet, and we say so."
---

The rebuild has its execution track: **GENMURK-EPIC1** is open. It is the
studio's first *project-track* epic — it runs alongside the studio's platform
work, and proving the two don't collide is part of its job.

Honesty first: **no engine code was written today.** Day one of an epic here
is founding work — the records the track stands on, the one ruling everything
downstream depends on, and the channel through which this build talks to the
platform. That is what landed:

- **The scope question is on the table.** Which requirements ship in v1 is now
  a filed ruling with a recommendation and a deadline: v1 covers the core and
  faithful behavior ([GM-R1..R18](/decomposition/)) with command-set
  compatibility (GM-R22) as the acceptance layer. Explicitly out: the
  gnomes-in-MURK vision (post-v1), the themed creative direction (its own
  decision), and PROD hosting.
- **The app has a home.** GenMURK's application code will live in this same
  repo under `app/`, next to this build log — separate CI, separate deploy
  target, same story in one place. This site stays documentation; the app
  never deploys to these Pages.
- **The build's needs on the platform are a register, not a wishlist.** PROD
  hosting on `genmurk.com`, provider provisioning, budgets, and the eventual
  ops surface are recorded as dependencies the platform track picks up — never
  built from here.

The backlog is unchanged and still ranked highest-risk-first: the
**sandboxed softcode runtime** leads, and nothing is hosted or demoed beyond
localhost before its adversarial proof is green. That gate is the spine of
this epic.

Follow the [backlog](/backlog/) and [decisions](/decisions/) pages as the
build moves — this log tells the story as it actually happens.
