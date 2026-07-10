# GenMURK — decomposition & requirements of record

> **Status:** requirements-of-record, v1 (EPIC4-08). Clean-room rebuild.
> **Lineage (reference only):** TinyMUSE (busse/tinymuse@master, © 1989–1995) and
> the mid-90s MIT **MicroMUSE** instance are the *historical behavioral
> reference* being studied — never adopted, never ported line-by-line, never the
> product's identity. Provenance rule: every requirement below is written from
> **observed behavior** (the intake survey `docs/intake/surveys/busse-tinymuse.md`
> + register `.intake.yml`), and the rebuild cites **these requirements**, never
> original TinyMUSE source lines. The original engine is licensed
> non-commercial-educational-only; nothing commercial is claimed for it.
> STEERCO ruling of record: `docs/steerco/2026-07-10-brownfield-decompose-rebuild.md`.

## 0. Why this document exists

STEERCO ruled (2026-07-10) that brownfield intake does not terminate at
"adopt / refactor-later / leave-alone." That triage is a repo-hygiene first pass;
the product question — *what should this become on modern architecture* — is
answered by **decompose → requirements → rebuild**. TinyMUSE cannot run on modern
architecture (archaic ABI flags, glibc-only `crypt.h`, no build system the README
itself calls "difficult to compile"), and its engine is non-commercial-licensed,
so the value to extract is the **behavior and requirements it encodes**, rebuilt
clean. This document is that decomposition: what GenMURK must reproduce, stated as
a behavioral spec, plus the rebuild backlog. It does not decide product/creative
direction (that is a STEERCO decision issue) and it does not port code.

## 1. The domain, decomposed

TinyMUSE is a single-process, event-loop **text server for a shared multi-user
world** in the TinyMUD → TinyMUSH lineage. Stripped to behavior, it is four
coupled subsystems. GenMURK's requirements are organized by these.

### D1 — Real-time multi-user presence & communication
The core loop: many players connected simultaneously over a persistent
connection, each situated in a "room" (a location object), seeing each other's
presence and utterances in real time. Observed surface (from `comm.*`):
`comm.speech` (say/pose/whisper/page), `comm.look` (look/examine), `comm.player`,
`comm.admin`. This is a **chat domain with spatial scoping** — you hear what is
said in your room; paging crosses rooms; announce/broadcast is privileged.

### D2 — A navigable world of objects (the on-disk world model)
A graph of typed objects — **rooms, exits, things, players** — with attributes,
ownership, containment, and boolean lock expressions (`db.boolexp.c`). Stored in a
custom flat-file format (`run/db/mdb`). Behavior to preserve: object creation
(`@dig`, `@create`, `@open`), attribute get/set (`@set`, `&attr`), locks
(`@lock`/`@unlock` over boolean expressions), ownership & inheritance
(`db.inherit.c`), containment and movement (`move.c`, `match.c` name resolution).

### D3 — The user-programmable softcode interpreter
The defining feature and the defining risk. `prog.eval.c` (~3.4k LOC) evaluates
**player-authored in-world code** ("MUSHcode"): substitutions, functions,
`$`-commands on objects, a command queue (`cque.c`), wildcard matching
(`wild.c`), ANSI output (`prog.ansi.c`). Players extend the world at runtime by
writing code the server runs. Behaviorally this is a **sandboxed, per-object,
event-triggered scripting language** — the thing that makes a MUSE a MUSE rather
than a chat room.

### D4 — Administration, powers & moderation
A capability/permission model: God, Wizard, and graded powers (`powers*.c`,
`class.c`), admin commands (`comm.admin`), player warnings (`db.warnings.c`),
in-world mail (`db.mail.c`), object destruction with recovery
(`db.destroy.c`/`@destroy`/`@undestroy`). Behaviorally this is **RBAC over the
world model plus moderation tooling**.

## 2. Requirements of record

Each requirement is `GM-Rn`, tagged **[core]** (must exist for GenMURK to be
recognizably the same kind of thing), **[faithful]** (behavior worth preserving
from the reference), or **[modernize]** (a behavior the reference got wrong or
couldn't do, that the rebuild fixes by intent). Requirements are *what*, not
*how*; architecture is §3.

### Presence & communication (from D1)
- **GM-R1 [core]** Multiple players connect concurrently and share a live world;
  presence (who is here, who just arrived/left) is observable in real time.
- **GM-R2 [core]** Room-scoped speech: `say`/`pose`(emote) reach exactly the
  occupants of the speaker's current room; **GM-R3 [faithful]** cross-room
  directed messages (`page`/`whisper`) and privileged `@announce` broadcast.
- **GM-R4 [modernize]** Delivery is push (server → client) with no client poll;
  the reference's raw-socket line protocol becomes a modern real-time transport
  (see §3). Message ordering within a room is consistent for all observers.

### World model (from D2)
- **GM-R5 [core]** Four object types — **room, exit, thing, player** — with
  stable identity, an owner, and a free-form attribute map.
- **GM-R6 [core]** Spatial graph: rooms linked by exits; players and things have
  a location; containers hold things. Movement (`go <exit>`, `enter`/`leave`)
  updates location and fires presence events (GM-R1).
- **GM-R7 [faithful]** Building verbs: `@dig` (room), `@open` (exit), `@create`
  (thing), `@set`/`&attr` (attributes), `@name`/`@describe`.
- **GM-R8 [faithful]** Boolean locks: attribute/ownership predicates gate use,
  entry, and pickup (`@lock`), evaluated per action.
- **GM-R9 [faithful]** Ownership, quotas, and attribute inheritance from parent
  objects; destruction is recoverable within a window (`@destroy`/`@undestroy`).
- **GM-R10 [modernize]** The custom flat-file DB (`run/db/mdb`) is replaced by a
  transactional store (Supabase/Postgres, per §3). The **on-disk format is not a
  requirement**; the object/attribute/lock *semantics* are. Durability,
  concurrent writers, and backup become table stakes rather than a bespoke
  dump/restore.

### Softcode (from D3)
- **GM-R11 [core]** A user-programmable, per-object scripting capability:
  players attach code to attributes that the server evaluates in response to
  commands/events (the `$`-command + attribute model), with substitutions
  (`%0…%9`, `%N`, etc.), a function library, and a command queue with fair
  scheduling.
- **GM-R12 [core]** Wildcard/pattern matching for command dispatch (`wild.c`
  behavior) and name matching (`match.c` behavior: `me`, `here`, partial names,
  `#dbref`).
- **GM-R13 [faithful]** ANSI/markup in output, driven by softcode.
- **GM-R14 [modernize — HARD REQUIREMENT]** The interpreter is a **sandbox by
  construction**, not by hope. The reference is a network daemon running a
  user-programmable interpreter with no resource isolation — a large untrusted
  surface flagged in the survey and by studio trust doctrine. GenMURK's softcode
  runtime MUST enforce CPU/step/recursion/queue budgets, deny host/network/FS
  access, and treat all softcode as untrusted input under the studio trust-tier
  framework. This is the single most important modernization and gates any hosted
  exposure. (Cross-refs the untrusted-input gnome doctrine; softcode is to
  GenMURK what an injected README is to a surveyor.)
  **Mechanism (decided, STEERCO):** GenMURK builds **its own purpose-built
  interpreter** — the budgets are enforced *natively*, not inherited from an
  off-the-shelf VM. Owning the engine end to end flexes the studio's core
  engineering muscle and is the foundation for GM-R21.
- **GM-R21 [vision — post-v1]** The engine is built to eventually host the
  studio's own workforce: one day **gnomes may live in-MURK**, present in the
  world and building inside it through the softcode the same way a player does.
  Not a v1 requirement — a design north star that argues for owning the engine
  (a borrowed VM would foreclose it).

### Admin, powers, moderation (from D4)
- **GM-R15 [core]** Graded capability model (owner → builder → wizard → god
  equivalent), enforced server-side on every privileged verb.
- **GM-R16 [faithful]** Moderation: player warnings, boots/silences, object
  destruction with audit; **GM-R17 [faithful]** in-world mail between players.
- **GM-R18 [modernize]** Authentication replaces fixed-salt DES `crypt(pw,"XX")`
  (shared 2-char salt, 8-char truncation) with a modern salted KDF (argon2/bcrypt
  class) via the platform's auth provider; **no default God/Wizard credentials
  ship** — first-boot provisioning creates the god account with a rotated secret.
  (Closes the survey's #244-class residual at rebuild time.)

### Cross-cutting non-functional
- **GM-R19** Secrets live in the provider-native store (ADR-0023 §3), never in
  git, never in a gnome, never in the DB schema. `/healthz` per §4.
- **GM-R20** Preservation honesty: a **museum / behavioral-reference** page (and
  optional read-only archive of the studied TinyMUSE tree) documents "this is the
  artifact we studied," with the MUD/MUSE lineage and MicroMUSE history — never
  presented as GenMURK's own code or identity, never wired into CI or the running
  product.

## 3. Rebuild architecture (plan of record — direction, not final)

Per STEERCO 2026-07-10 (Supabase default) and ADR-0023 (SaaS stratum), and the
EPIC4-07 SaaS-stratum patterns:

- **Compute:** Workers-class runtime (Cloudflare Workers) — the studio's
  provider family; **not** GitHub Pages (Pages is documentation only, §4).
- **Data:** **Supabase** (Postgres) as the world store — the studio default for
  `saas` builds; object/attribute/lock semantics (GM-R5..R10) modeled relationally
  with row-level security aligning to the capability model (GM-R15).
- **Real-time (GM-R1/R4):** a sanctioned real-time transport (WebSocket / Supabase
  Realtime / Durable-Object-class coordination) for room presence and push
  delivery. Room = channel; movement = channel switch.
- **Softcode runtime (GM-R11/R14/R22):** the crux. **Decided (STEERCO): build our
  own purpose-built interpreter** — budgets enforced natively, not inherited from
  an off-the-shelf VM. The first architecture ADR designs that engine and proves
  the sandbox; the requirement (sandbox-by-construction) is fixed and the
  mechanism is now settled (own it). Owning the engine is the foundation for the
  GM-R21 vision (gnomes building in-MURK).
- **Museum (GM-R20):** the original C tree may be preserved read-only as a
  behavioral-reference exhibit; it is never adopted as product nor built in CI.

The **PROD app is EPIC5 work**; 08 records the plan and reserves the surfaces.

## 4. Two surfaces, two homes (do not conflate)

- **Docs / build-in-public living-docs site → `genmurk.bussetech.com`** — a normal
  studio subdomain (Pages/Jekyll), founded and DNS-wired the standard factory way
  like kdc/menowise/backpacks. Static, public, secrets-free (`docs/build-in-public.md`,
  ADR-0047). Documentation, not PROD. Instance 1 of the build-in-public pattern.
- **PROD MURK app → `genmurk.com`** (registered apex, sysop-owned) — the running
  product on its own TLD, Workers-class + Supabase. Stands up in **EPIC5**. 08
  reserves it in the registry and flags the DNS-zone decision (a project may own
  its apex PROD domain — a second Cloudflare zone under the DNS steward; small
  ADR).

## 5. Rebuild backlog (EPIC5+, ranked)

1. **[arch] Build our own softcode engine — ADR + spike (GM-R14/R11)** — the
   highest-risk, highest-value work; nothing hosted ships before it. Mechanism is
   decided (our own purpose-built interpreter, STEERCO); the ADR designs it and
   proves step/CPU/recursion budgets against an adversarial fixture pack (softcode
   as untrusted input). Foundation for GM-R21 (gnomes in-MURK).
2. **[arch] World-model schema (GM-R5..R10)** — Supabase relational model for
   objects/attributes/locks/containment/ownership; RLS bound to capabilities.
3. **[core] Real-time presence & room speech (GM-R1..R4)** — transport choice,
   channel-per-room, push delivery, ordering.
4. **[core] Building verbs & movement (GM-R6/R7)** — `@dig/@open/@create/@set`,
   `go/enter/leave`, name matching (GM-R12).
5. **[core] Command dispatch + `$`-commands + queue (GM-R11/R12)** — softcode
   trigger model on top of item 1's runtime.
6. **[core] Auth & capability model (GM-R15/R18)** — modern KDF, no default
   creds, first-boot god provisioning; graded powers server-enforced.
7. **[faithful] Locks, mail, moderation, destroy/undestroy (GM-R8/R16/R17/R9).**
8. **[faithful] ANSI/markup output (GM-R13).**
9. **[ops] `/healthz`, secrets in provider store, backups, observability
   (GM-R19).** Apex/DNS-zone handling for `genmurk.com` (the second-zone ADR).
10. **[preservation] Museum/behavioral-reference exhibit (GM-R20)** + history &
    lineage pages on the docs site.
11. **[decision] Themed creative direction** — a STEERCO decision issue with
    options (setting/theme/name-in-fiction); not invented here.

## 6. Provenance & guardrails (standing)

- Cite **these requirements**, never TinyMUSE source lines. The rebuild is a
  clean product; the reference informs *what*, never *how*.
- Do not adopt, port, or ship the original TinyMUSE engine (non-commercial-
  educational-only). The clean rebuild is the only shippable surface.
- Softcode is untrusted input; the sandbox (GM-R14) is non-negotiable.
- The living-docs site is static, public, secrets-free; PROD is a separate
  provider-family config. Pages is documentation, not PROD.
