---
layout: page
title: Architecture decisions
eyebrow: The build
description: "GenMURK's architecture decision log, in public — the settled calls (Supabase, Workers-class compute, an apex PROD domain) and the one that is honestly still open: how the softcode sandbox is built."
permalink: /decisions/
---

The build's architecture decisions, recorded in public as they're made. Some are
settled; one is honestly **still open**. This is direction of record, not a
final blueprint — where a call hasn't been made, this page says so.

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

## Open

### How the softcode sandbox is built — UNDECIDED
The one hard requirement (GM-R14) is fixed: the softcode runtime is a **sandbox
by construction** — hard CPU/step/recursion/queue budgets, no host/network/
filesystem access, all softcode treated as untrusted input. The **mechanism is
not yet chosen.** The two candidates:

- a **purpose-built interpreter** with the budgets enforced natively, or
- an **existing embeddable, sandboxable VM** (e.g. a WASM-isolated interpreter).

This is the highest-risk, highest-value decision in the build, so it is settled
**first** — via a dedicated ADR plus a spike that proves the budgets against an
adversarial softcode fixture pack — before anything hosted ships. The decision
is deferred to an **EPIC5 ADR** and is honestly recorded here as open. It leads
the [backlog](/backlog/).

## Also to come

- **Themed creative direction** (setting, theme, name-in-fiction) is a
  company-level decision issue with options — not invented here, and not
  decided yet.
