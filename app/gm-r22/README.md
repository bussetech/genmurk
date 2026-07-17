# GM-R22 — end-user command-set compatibility harness

GM-R22 (the STEERCO minimum bar) says GenMURK supports **at minimum the same
player-facing command set** — verb names and invocation syntax — as the
TinyMUSE/MicroMUSE reference, so historic users onboard with minimal
relearning. This directory makes that bar **testable as data**.

## The pieces

- **`command-surface.yml`** — the command surface AS DATA. Each entry is one
  player-facing command: `verb`, `syntax`, an `example`, its `behavior` class,
  a `reference_tag`, and `provisional` / `implemented` / optional `divergence`
  flags. The **airgapped canonical capture (genmurk#9)** drops in here: when it
  lands, each reference command becomes an entry, `capture.landed` flips to
  `true`, and coverage becomes real.
- **`surface.ts`** — a strict, dependency-free loader for the file's minimal
  YAML subset, plus `provenanceViolations()` — the clean-room gate.
- **`conformance.ts`** — the runner. For each entry it drives the `example`
  through the REAL parser (`src/server/verbs.ts`) and asserts the verb resolves
  to the declared behavior class. It prints coverage %, gaps, divergences, and
  a LOUD capture-pending banner. `npm run conformance` (wired into `npm test`).

## The state today: CAPTURE LANDED — coverage is REAL (GENMURK-EPIC2-02)

The canonical capture (`genmurk#9`) has been **reviewed and dropped in**. Each
entry now traces to a reference command (`reference_tag: capture:<handler>`) or
to a GM-Rn requirement of record (GenMURK's own moderation model). The runner
REJECTS any entry whose name traces to neither the capture nor a GM-Rn — the
clean-room/provenance line, enforced in CI (negative control test).

**The referent and the bar.** The reference parser recognizes **140** built-in
commands. GM-R22's bar is the PLAYER-FACING subset — the `commands:` entries
here, split by `tier` (`player` = everyday verbs; `builder` = construction +
privileged operator verbs). The reference's wizard/god server-and-database
administration set, its channels, and its economy are **out of the bar** and
are accounted for as counts on the `capture:` block (`excluded_admin` /
`excluded_channels` / `excluded_economy`) — the runner asserts that the traced
entries + those counts equal `reference_total`, so nothing is silently dropped.
Coverage is measured against the player-facing bar and is **partial**: the
minimum bar is not yet met, and the gap list is the standing work order.

## The drop-in procedure (executed here; the shape for future capture revisions)

1. `commands:` holds the canonical entries (name + syntax + behavior + `tier` +
   `reference_tag: capture:<handler>`), and `capture.landed: true`.
2. Entries GenMURK implements are `implemented: true`; the rest
   `implemented: false` — they report as honest **coverage gaps**, never passes.
3. The `capture:` block carries `reference_total` and the `excluded_*` counts.
4. `npm run conformance`: real coverage % (overall + per tier), the gap list,
   the divergence ledger, and the out-of-bar accounting.

## Divergences (GM-R14 wins, documented for the returning user)

Where a reference command would conflict with the sandbox requirement
(GM-R14), the **safe behavior wins and the divergence is recorded** on the
entry. The doc site's returning-user page (`/compatibility/`) renders the
ledger. The runner prints the full set; the load-bearing ones are `@lock`
(bounded key grammar, fails closed), `get` (pickup lock evaluated app-side),
`examine` (attribute visibility gated by control), `@undestroy` (recover by
`#dbref`, not name), and moderation (only reaches down, audited).

**Reconciliations resolved by the capture (GENMURK-EPIC2-02).** The reference
`@`-prefixes its building/admin verbs (`@dig`) and `+`-prefixes mail (`+mail`),
and its speech verb is `pose` with the `"`/`:`/`;` tokens. GenMURK accepts all
of those faithful forms (examples above exercise them through the real parser)
and **keeps the bare forms as documented conveniences** — an unimplemented
prefixed verb (e.g. `@nuke`) falls through to `unknown`, an honest gap, never a
silent alias. Argument separator: the reference's `=` for building verbs, kept.
