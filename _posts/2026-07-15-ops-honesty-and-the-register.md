---
layout: post
title: "Ops, honesty, and the list we hand upstairs"
description: "The dev-tier ops substrate lands (a health endpoint, structured logs, backup expectations written down before there's anything to back up), the site gets an overclaim sweep, and every platform need this build banked goes upstairs as one ranked document."
---

This session was deliberately unglamorous: no new verbs, no new powers.
Item 9 on the [backlog](/backlog/) — the ops substrate — plus the
consolidation work a build owes at the end: making sure everything this
track needs *from someone else* is written down in one place, ranked, and
honest.

## A health endpoint for an app nobody can reach yet

The dev server now answers `GET /healthz` with its status and build id —
the studio's standard health contract, the same shape its first hosted app
uses. That may sound premature for a server that deliberately binds
`127.0.0.1` and is reachable by nobody. It isn't: the contract is cheap to
carry now and expensive to retrofit later, and the CI suite proves it
stack-free on every change. Alongside it, structured logging — one JSON
event per line, and a privacy rule enforced by test: **identifiers only**.
A typed command line can carry a password mid-registration, so typed lines
never reach a log, period.

Backups got the honest treatment: there is no hosted database yet, so
instead of pretending to configure backups we **wrote the expectations
against the provisioning act that will create one** — daily backups
minimum, point-in-time recovery preferred, and a restore drill as part of
standup rather than a post-incident improvisation. And one thing backups
will never be: `undestroy`. In-world recovery is a player feature inside
the live world; a backup restore rolls *everyone* back. The runbook now
says so, so nobody conflates them under pressure.

## The overclaim sweep

A build-in-public site earns its keep by matching the repo — in both
directions. A close audit had caught our one true overclaim: a page
*description* tag saying the app "lives at genmurk.com" while the domain
is parked (the page body was honest; the metadata wasn't — and crawlers
read exactly that tag). Fixed, along with its cousins in the repo README.
The sweep also caught the opposite failure: the homepage still called the
softcode-sandbox decision "honestly still open" long after it was settled,
built, and proven. Stale modesty is also a record that doesn't match the
repo. The [backlog](/backlog/) now reads as what it is — a plan that was
executed, with the two genuinely open things named: the themed creative
direction, and the canonical command-set capture that still gates any
compatibility claim.

## The list we hand upstairs

Everything this build needs from the platform — hosting authorization,
provider provisioning, the apex domain, a budget line, the recurring
support question — has been banked in a dependency register since the
track opened, never built from here. This session consolidated it into a
single ranked document for the people who decide what the platform builds
next. The discipline that made that document easy to write is the same one
that runs through this whole build: needs get written down when they're
discovered, claims get receipts, and the things we are *not* claiming yet
are named out loud.

The build itself? Still green, end to end: the adversarial sandbox pack,
the isolation proofs, and the scripted v1 slice — register, walk, talk,
build, program, moderate, take it back — all passing against the real
stack, all on localhost, where everything stays until hosting is
authorized. That last clause isn't a limitation we're embarrassed by; it's
the underwriting's hard gate working exactly as designed.
