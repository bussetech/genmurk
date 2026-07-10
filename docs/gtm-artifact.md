# GenMURK — GTM artifact (config-derived)

> **Provenance.** A **console-executed** application of the `gn_gtm_copywriter`
> stance (generalized GTM knoll, `knolls/gtm/`) to GenMURK's **config alone**
> (its `platform.yml` registry proposal + `founding.md` + `requirements.md`) —
> not a receipt-backed live gnome run (no model API key in this console, same
> limit as EPIC4-06's survey). A **receipt-backed live re-run is filed as an
> issue.** This is the acceptance artifact: *the generalized GTM gnomes produced
> one GenMURK artifact from config alone* — GenMURK is the GTM fleet's **first
> non-studio client** (the fleet-evolution proof, ADR-0045).
>
> **Doctrine applied:** GTM knoll KB-0001 (curation over creation — shape the
> studio's real work into a channel story, invent nothing), and GD-0007 (strategy
> §9 hard rules: solo-operator honesty — one human + a governed gnome workforce;
> no claims without receipts). Nothing below claims a shipped app: PROD is EPIC5,
> and the copy says so.

## Artifact: build-in-public launch blurb (docs-site + feed)

**Headline:** *GenMURK — building a modern text world, in public.*

**Standfirst:** We took a beloved 1990s multiplayer text engine — TinyMUSE, in
the MUD/MUSE lineage — decomposed what made it work, and are rebuilding it clean
on modern architecture. You can watch the whole thing: the decomposition, the
requirements, the backlog, every decision.

**Body (≈100 words):**
Text worlds are one of computing's oldest social ideas: a shared place you move
through, where what you say reaches the room, and where players *program the world
itself*. The engines that ran them are hard to compile and older than the
modern web. So we're not resurrecting old code — we studied it as a behavioral
reference, wrote down what it actually needs to do, and are building a fresh one:
real-time presence, a persistent world of rooms and objects, and a **sandboxed**
version of the thing that made these worlds magic — player-written softcode. The
running world lands later; for now, the build log is open. Follow along.

**What this build is honest about (per GD-0007):**
- One operator, a governed gnome workforce — not a team we don't have.
- The **app is not live yet** — this is the build story; PROD is a later cycle.
- We **did not** adopt or ship the original engine (it's non-commercial-licensed);
  it's a reference, and we say so on the museum page.

**Call to action:** Read the decomposition → `genmurk.bussetech.com`.

---

*Config fields this was derived from:* `name: genmurk`, the registry
`description`, `archetype: saas` (entered brownfield), the two-surfaces split
(docs `genmurk.bussetech.com` / PROD `genmurk.com`, EPIC5), and requirements
GM-R1/R11/R14 (presence, softcode, the sandbox). No fact here is absent from that
config; nothing was invented.
