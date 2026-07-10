---
layout: page
title: Architecture decisions
eyebrow: The build
description: "GenMURK's architecture decision log, in public — the settled calls (Supabase, Workers-class compute, an apex PROD domain, and building our own softcode engine) and the one still open: the themed creative direction."
permalink: /decisions/
---

The build's architecture decisions, recorded in public as they're made. Most are
settled; the themed creative direction is still open. This is direction of
record, not a final blueprint — where a call hasn't been made, this page says
so. The source is public: read it at
[github.com/bussetech/genmurk](https://github.com/bussetech/genmurk).

## Settled

### Supabase is the default database
The running GenMURK world is stored in **Supabase (Postgres)** — the studio's
default for hosted apps of this kind. The four object types and their
attributes, locks, containment, and ownership (GM-R5..R10) are modeled
relationally, with row-level security aligned to the capability model (GM-R15).
The reference's bespoke flat-file format is not preserved; its *semantics* are.
*(Studio decision of record: ADR-0048.)*

### Workers-class compute for PROD
The application runs on a **Workers-class runtime** (Cloudflare Workers) — the
studio's provider family for hosted apps — **not** on GitHub Pages. Pages hosts
*this documentation site only*. Real-time presence and push delivery (GM-R1 /
GM-R4) ride a sanctioned real-time transport (WebSocket / Supabase Realtime /
Durable-Object-class coordination): room = channel, movement = channel switch.

### An apex PROD domain on its own DNS zone
The running app claims its own registered apex, **`genmurk.com`**, separate from
this build log at `genmurk.bussetech.com`. That apex is a **second DNS zone**
under the studio's DNS steward — a project may own its apex PROD domain. The
apex standup and the multi-zone steward are EPIC5 work. *(Studio decision of
record: ADR-0049.)*

### Two surfaces, never conflated
This Pages site is **documentation, not PROD.** The build log and the running
app are different provider-family configurations and even different domains; the
app is never deployed to these Pages, and this site never carries runtime
secrets — it is secrets-free by construction.

### We build our own softcode engine
The user-programmable softcode runtime (GM-R11 / GM-R14) will be **the studio's
own purpose-built interpreter** — not a wrapper around an off-the-shelf VM.
Company direction (STEERCO): building the engine ourselves flexes the studio's
own engineering muscle where it matters most, and keeps the sandbox — the hard
requirement — enforced *natively* rather than inherited from someone else's
runtime. The sandbox (GM-R14) is unchanged and non-negotiable: hard
CPU/step/recursion/queue budgets, no host/network/filesystem access, all
softcode treated as untrusted input, proven against an adversarial fixture pack
before anything hosted ships. This is the highest-risk, highest-value piece of
the build, so it leads the [backlog](/backlog/).

**Why it matters beyond v1.** A softcode engine we own is a foundation we can
grow into. One day the studio's own **gnomes may live in-MURK** — present in the
world, building things inside it through the softcode the same way a player
would. Owning the engine end to end is what makes that possible; a borrowed VM
would not.

## Open

### Themed creative direction
The **setting, theme, and name-in-fiction** — what the world is *about* — is a
company-level decision with options on the table, not invented here and not
decided yet. The engine is theme-agnostic, so this doesn't block the build; it's
tracked as a decision issue.
