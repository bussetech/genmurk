> **Update (2026-07-10, EPIC4-08).** The `genmurk` repo is now **founded** (`bussetech/genmurk`, via console) and this build-in-public docs site is seeded here. The registry entry is live (`archetype: saas`, entered brownfield; PROD apex `genmurk.com` recorded in ADR-0049). References below to content being "staged in platform" or founding being "sysop-gated" describe the pre-founding state and are superseded by this repo. The knoll is still wired at first-gnome (EPIC5); PROD stands up EPIC5.

# GenMURK — founding record

> **Status:** founding record of EPIC4-08 (2026-07-10). The clean-room rebuild of
> **TinyMUSE**. This document is the control-plane record; **the `genmurk` repo,
> its DNS/Pages, its knoll wiring, and any live gnome run are sysop/FACTORY_TOKEN
> acts** (ADR-0008/0013, GD-0019) — proposed here, executed by the sysop. See
> §"What is sysop-gated" and the EPIC4-08 handoff.

## What GenMURK is

GenMURK is the studio's **c-archetype build 2** — the decompose-and-rebuild of a
living system that cannot run on modern architecture. It is a **clean-room
rebuild on modern architecture**, worked from decomposed requirements
(`requirements.md`), **not** an adoption or line-by-line port of the original
**TinyMUSE** engine. TinyMUSE (© 1989–1995) and the mid-90s MIT **MicroMUSE**
instance are the **historical behavioral reference** being studied — named as
lineage on the museum/history pages, **never** as the product's identity. The
name honors the MUD/MUSE family (MURK — the earthy sibling of mud/muck/mush).

STEERCO ruling of record: `docs/steerco/2026-07-10-brownfield-decompose-rebuild.md`.
Survey inputs (consumed, not re-audited): `docs/intake/surveys/busse-tinymuse.md`
+ `.intake.yml` (both blockers #243/#244 **closed** by the ruling).

## Naming & identity

- **Product / repo / knoll / registry slug:** `genmurk`.
- **Lineage (reference only, recorded in the registry description):** a
  clean-room rebuild inspired by **TinyMUSE** and the mid-90s MIT **MicroMUSE**
  instance (historical reference and history-page material) — **not** an adoption
  of either.
- TinyMUSE / MicroMUSE appear as lineage on the museum and history pages, never
  as the product name.

## Two surfaces, two homes (do not conflate)

| Surface | Home | Host | Stands up |
| --- | --- | --- | --- |
| **Build-in-public living-docs site** | `genmurk.bussetech.com` (normal studio subdomain) | GitHub Pages / Jekyll (secrets-free, `docs/build-in-public.md`, ADR-0047) | **EPIC4-08** founds; instance 1 of the pattern |
| **PROD MURK app** | `genmurk.com` (registered apex, sysop-owned) | Workers-class + Supabase (ADR-0048); apex = second DNS zone (**ADR-0049**) | **EPIC5** |

08 **reserves and records** `genmurk.com`; the apex standup and the multi-zone
DNS steward are EPIC5 (ADR-0049 fixes the shape; the build is an EPIC5 issue).

## Registry entry (proposed — activates on the founding merge)

Proposed `platform.yml → repos:` entry. It is **not committed live this session**
because registering a repo *is* the act of creation (DNS + portal follow) and the
repo does not exist yet; it lands with the sysop's founding act.

```yaml
  - name: genmurk
    subdomain: genmurk          # docs living-docs site → genmurk.bussetech.com
    status: active
    description: "GenMURK — a modern, multiplayer text world (MUD/MUSE): a clean-room rebuild on modern architecture, inspired by the TinyMUSE engine and the mid-90s MIT MicroMUSE instance (historical reference, not adopted). Build-in-public living docs here; the running app lives at genmurk.com."
    visibility: public
    listed: true
    archetype: saas             # the REBUILD is a saas app (Workers + Supabase); it ENTERED via brownfield intake
    client: false
    prod_domain: genmurk.com    # PROD apex, own DNS zone (ADR-0049); stands up EPIC5
```

**Archetype note.** GenMURK *entered* the studio as **brownfield** (intake →
decomposition) but the **rebuilt product is `saas`** (a hosted multiuser app on
the SaaS stratum, ADR-0023/0048). Archetype ≠ entry mode (EPIC4 intent). The
`prod_domain` field is new — proposed here alongside ADR-0049; if the registry
schema needs the field added, that is part of the founding PR.

## The `genmurk` knoll (designed; wiring deferred to first-gnome)

Per the reuse protocol (`docs/knolls.md`) a new project gets its own knoll named
after the repo. GenMURK's knoll is **designed here and wired when its first
project gnome is built (EPIC5)** — the knoll schema requires ≥1 real member gnome
(two-way validated by `registry-sync`), and GenMURK's project gnomes are sketched
here, not built this session. Wiring an empty `knolls/genmurk/` now would fail
`registry-sync`; so this is the design of record, ready to instantiate.

- **name:** `genmurk`
- **purpose:** "The GenMURK build: decompose the TinyMUSE reference into
  requirements and rebuild a modern multiuser text world — world model, real-time
  presence, and a sandboxed softcode runtime — on Workers + Supabase."
- **members (sketched — built EPIC5):** a world/DB gnome, a softcode-sandbox
  gnome, a real-time/presence gnome (names to be assigned at build; e.g.
  `gn_genmurk_world`, `gn_genmurk_softcode`). **Code needs sketched, not built,
  this session** (`requirements.md` §3/§5 is the sketch).
- **steward:** the world/DB gnome (tends the KB).
- **KB seeds (draft, allocate `kb-genmurk` at wiring):** (1) *softcode is
  untrusted input — sandbox by construction* (GM-R14 doctrine); (2) *cite
  decomposed requirements, never original TinyMUSE source lines* (provenance);
  (3) *the on-disk format is not a requirement; the semantics are* (GM-R10).

### GTM slice — the generalized GTM gnomes serve GenMURK (fleet-evolution proof)

GenMURK's go-to-market is served by the **generalized GTM knoll** gnomes
(`knolls/gtm/`: `gn_gtm_researcher/analyst/planner/copywriter/devrel/techwriter/
scholar`), **deployed to GenMURK as their first non-studio client** — the same
"generalize a project team into a product-type team" move as kdc→info (ADR-0045).
GTM gnomes stay in the `gtm` knoll (a gnome belongs to ≤1 knoll); they *serve*
GenMURK by deployment, they do not join the `genmurk` knoll.

**Acceptance artifact — one GenMURK GTM artifact from config alone:** produced
this session by **console-application** of `gn_gtm_copywriter`'s stance to
GenMURK's registry/founding config (no model API key in this console — same limit
as EPIC4-06's survey). See `gtm-artifact.md`. A **receipt-backed live re-run** is
filed as an issue (like #245 for the surveyor).

## Build-in-public — instance 1

GenMURK is **instance 1** of the reusable build-in-public pattern
(`docs/build-in-public.md`, v1, whose revisions ledger is seeded by this
instance). The living-docs site seed (decomposition, requirements, backlog,
architecture decisions, progress, museum/behavioral-reference) is staged at
`docs/rebuilds/genmurk/site/` and served at `genmurk.bussetech.com` once founded.
It is static, public, secrets-free, ADR-0047-clean, style-lint-clean; **Pages is
documentation, not PROD** (the app is Workers + Supabase, EPIC5).

## What EPIC5 executes (not this session)

1. Found the `genmurk` repo (project-template, `archetype: saas`), wire DNS/Pages
   for `genmurk.bussetech.com`, seed it from `site/`.
2. Build GenMURK's first project gnomes; wire the `genmurk` knoll + `kb-genmurk`.
3. The softcode-sandbox ADR + spike (GM-R14) — highest-risk decision first.
4. Stand up PROD on `genmurk.com` (apex, second DNS zone per ADR-0049; multi-zone
   steward) — Workers + Supabase.
5. STEERCO decision issue: themed creative direction (options, not invented here).

## What is sysop-gated (proposed here, executed by sysop)

- Founding the `genmurk` repo + DNS + Pages (admin/FACTORY_TOKEN, ADR-0008/0013).
- Merging this PR (GD-0019 — a background console cannot self-merge).
- The receipt-backed live GTM gnome run (needs a model API key).
- Registering/standing up the `genmurk.com` apex zone (registrar + Cloudflare
  admin; EPIC5).
