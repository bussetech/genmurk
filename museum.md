---
layout: page
title: Museum — the artifact we studied
eyebrow: Provenance
description: "The behavioral-reference exhibit: TinyMUSE (a ~31k-line 1990s C MUD/MUSH server) and the mid-90s MIT MicroMUSE instance — what they taught GenMURK, their licensing posture, and why they are lineage and reference, never GenMURK's identity."
permalink: /museum/
---

Honest provenance: **this is the artifact GenMURK studied.** It is a museum
exhibit, not GenMURK's code. Nothing here is adopted, nothing here is wired into
GenMURK's CI or its running product, and nothing here is the product's identity.

## What we studied

**TinyMUSE** — a ~**31,000-line 1990s C** MUD/MUSH server, a TinyMUSH 1.5
derivative in the **TinyMUD → TinyMUSH** lineage. It is a single-process,
event-loop text server for a shared multiplayer online world: raw-socket
networking, a custom flat-file object database, a command-dispatch layer, and an
embedded user-programmable **softcode** interpreter (~3.4k lines on its own).
Minimally modernized to a v2.0 that compiles and runs again — explicitly to
restore compilability, not to add features (its own README calls the older code
"difficult to compile, much less run").

**The mid-90s MIT MicroMUSE instance** — the historical community running on this
family of software, part of the MicroMuse / MuseNET / BridgeMUSE / OceanaMUSE
academic milieu. It is history and context, named as lineage.

## The MUD / MUSE / MURK name lineage

The genre began with **MUD** (multi-user dungeon) and branched through a family
whose members are named for muddy earth: **MUD → MUCK → MUSH → MUSE**. GenMURK's
name honors that family — **MURK**, the earthy sibling of mud/muck/mush. The
older names appear here as lineage; **GenMURK** is the product name.

## What it taught GenMURK

Reading the reference's *behavior* (never assuming its code) surfaced the shape
of the whole domain:

- **The four subsystems** — real-time presence & communication, a navigable
  world of typed objects, the user-programmable softcode interpreter, and
  administration/powers/moderation. These became GenMURK's
  [decomposition](/decomposition/).
- **The softcode idea** — that players extend the world at runtime by writing
  code the server runs. This is what makes a MUSE a MUSE, and it is GenMURK's
  hardest and most valuable requirement (GM-R11 / GM-R14).
- **What the era got wrong** — a network daemon running a user-programmable
  interpreter with no resource isolation, fixed-salt DES passwords, and default
  admin credentials shipped in the open. GenMURK fixes all three by intent: a
  sandbox by construction, a modern KDF, and no default credentials.

## Licensing posture — clean rebuild only

The original engine's licensing is **three-layered and non-OSI**: an upstream
TinyMUD / TinyMUSH copyright (1989–1990) with redistribution restrictions; a
MuseNET academic-courtesy notice framing use as **non-commercial / educational**;
and a prose-only MIT claim for the v2.0 code with **no license file** in the
tree. The original engine is treated as **non-commercial-educational-only**, and
**nothing commercial is claimed for it.**

That posture is exactly why GenMURK is a **clean-room rebuild** and not an
adoption. The value extracted from the reference is its **behavior and
requirements**, rebuilt clean on modern architecture. GenMURK's
[requirements](/decomposition/) are written from **observed behavior**; the
rebuild cites **those requirements**, never original engine source lines.

## Explicitly *not*

- **Not adopted** — GenMURK ships no original engine code.
- **Not ported line-by-line** — the requirements are behavioral, not a code map.
- **Not in CI or PROD** — the studied tree, if preserved at all, is a read-only
  exhibit; it is never built in CI and never part of the running product.
- **Not the product's identity** — TinyMUSE and MicroMUSE are lineage and
  history here, never GenMURK's name or brand.
