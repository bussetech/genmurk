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

## The state today: PROVISIONAL (capture pending)

The canonical capture **has not landed** (`genmurk#9`). So every entry is
`provisional: true` and its `reference_tag` is a **GM-Rn requirement of
record** — never a command remembered from the wider MUSH family. The runner
REJECTS any entry whose name traces to neither the capture nor a GM-Rn: that
is the clean-room/provenance line, enforced in CI.

Because of that, the coverage number is **not** a real GM-R22 measurement yet —
it is "we implement everything we could honestly derive from the requirements."
Real coverage against the reference set is impossible to state until the
capture lands. The banner says exactly this.

## When the capture lands (the drop-in procedure)

1. Replace/extend `commands:` with the canonical entries (name + syntax +
   behavior + `reference_tag: capture:<id>`), and set `capture.landed: true`.
2. Mark entries GenMURK already implements `implemented: true`; the rest
   `implemented: false` — they report as honest **coverage gaps**, never passes.
3. Run `npm run conformance`: real coverage %, the gap list (what's left to
   build), and the divergence ledger.

## Divergences (GM-R14 wins, documented for the returning user)

Where a reference command would conflict with the sandbox requirement
(GM-R14), the **safe behavior wins and the divergence is recorded** on the
entry. The doc site's returning-user page (`/compatibility/`) renders the
ledger. Current divergences:

- **lock** — the lock EXPRESSION grammar is a bounded safe subset; richer
  reference key forms are rejected outright, never approximated.

Two surface-level reconciliations are also pending the capture (tracked as
notes, not asserted): whether the reference used an `@`-prefix / `/switch`
convention on building verbs, and the exact argument punctuation. The
placeholder surface uses bare verbs and `=` separators; the capture decides.
