// GM-R22 harness tests: with the capture LANDED (GENMURK-EPIC2-02) the runner
// reports REAL coverage against the reference, enforces the clean-room
// provenance line, and asserts the out-of-bar accounting sums to the reference
// total (nothing silently dropped). Stack-free — wired into `npm run unit`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadSurface, parseSurface, provenanceViolations } from "../../gm-r22/surface.ts";
import { runConformance } from "../../gm-r22/conformance.ts";
import { parseCommand } from "../../src/server/verbs.ts";

const SURFACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../gm-r22/command-surface.yml");

test("the shipped surface loads; every implemented command routes to its class, no regressions", () => {
  const surface = loadSurface(SURFACE);
  const report = runConformance(surface);
  assert.ok(report.total >= 50, "the landed capture carries the full player-facing surface");
  // no regression: everything we CLAIM to implement parses + routes correctly
  assert.deepEqual(report.regressions, [], "a claimed-implemented command failed to route");
  // real coverage is a partial number now — the bar is NOT yet met, honestly
  assert.ok(report.covered < report.total, "gaps remain — the minimum bar is not yet met");
  assert.ok(report.coveragePct > 0 && report.coveragePct < 100, "coverage is a real partial number");
});

test("the capture has LANDED and coverage is real", () => {
  const surface = loadSurface(SURFACE);
  assert.equal(surface.capture.landed, true, "capture genmurk#9 has landed");
  assert.match(surface.capture.issue, /genmurk#9/);
  assert.ok(surface.capture.source.length > 0, "the landed capture records its provenance");
  assert.ok(surface.capture.referenceTotal > 0, "the reference total is the honest denominator");
  // post-capture, nothing is provisional
  assert.ok(surface.commands.every((c) => !c.provisional), "no entry is provisional once the capture has landed");
});

test("out-of-bar accounting SUMS to the reference total — nothing is silently dropped", () => {
  const surface = loadSurface(SURFACE);
  const report = runConformance(surface);
  const cap = surface.capture;
  assert.equal(
    report.captureTraced + cap.excludedAdmin + cap.excludedChannels + cap.excludedEconomy,
    cap.referenceTotal,
    "traced entries + excluded classes must equal the reference total",
  );
  assert.ok(report.accountingOk, "the runner agrees the accounting sums");
});

test("every entry declares a tier, and per-tier coverage is reported", () => {
  const surface = loadSurface(SURFACE);
  const report = runConformance(surface);
  assert.ok(surface.commands.every((c) => c.tier === "player" || c.tier === "builder"));
  const player = report.byTier.find((t) => t.tier === "player")!;
  const builder = report.byTier.find((t) => t.tier === "builder")!;
  assert.ok(player.total > 0 && builder.total > 0, "both tiers carry entries");
  assert.equal(player.total + builder.total, report.total, "tiers partition the surface");
});

test("provenance is clean — every name traces to the capture or a GM-Rn", () => {
  const surface = loadSurface(SURFACE);
  assert.deepEqual(provenanceViolations(surface), [], "every surface name must trace to a GM-Rn or the capture");
  for (const c of surface.commands) {
    assert.match(c.reference_tag, /^(capture:|GM-R\d+$)/, `${c.verb} must trace to the capture or a GM-Rn`);
  }
});

test("the faithful reference forms parse (the reconciliation is real, not just documented)", () => {
  // @-prefixed building verbs, +mail, and the speech tokens/aliases the capture
  // named must actually route through the parser — the divergence ledger claims
  // GenMURK accepts them, so prove it.
  assert.equal(parseCommand("@dig The Kitchen").verb, "dig", "@-prefixed building verb");
  assert.equal(parseCommand("@destroy old sign").verb, "destroy", "@-prefixed lifecycle verb");
  assert.equal(parseCommand("@boot Bob").verb, "boot", "@-prefixed moderation verb");
  assert.equal(parseCommand("+mail Bob = hi").verb, "mail", "+mail form");
  assert.equal(parseCommand("pose waves").verb, "emote", "pose routes to the speech path");
  assert.equal(parseCommand(":waves").verb, "emote", "colon speech token");
  assert.equal(parseCommand('"hi there').verb, "say", "quote speech token");
  assert.equal(parseCommand("goto north").verb, "go", "goto alias");
  assert.equal(parseCommand("move north").verb, "go", "move alias");
  assert.equal(parseCommand("read the sign").verb, "look", "read alias of look");
  assert.equal(parseCommand("throw lantern").verb, "drop", "throw alias of drop");
  // an unimplemented reference @-verb is an honest UNKNOWN, not a silent alias
  assert.equal(parseCommand("@nuke Bob").verb, "unknown", "unreproduced admin verb falls through");
});

test("the divergence ledger records the GM-R14 lock-grammar subset", () => {
  const surface = loadSurface(SURFACE);
  const report = runConformance(surface);
  assert.ok(report.divergences.length >= 1, "at least one honest divergence is recorded");
  assert.ok(report.divergences.some((d) => d.verb === "@lock" && /GM-R14/.test(d.divergence ?? "")));
});

test("provenance validation CATCHES an invented name (negative control)", () => {
  // an entry citing neither a GM-Rn nor the capture is a provenance violation
  const bad = parseSurface(
    [
      "capture:",
      "  landed: true",
      "  issue: genmurk#9",
      '  note: "x"',
      "commands:",
      "  - verb: teleport",
      '    syntax: "teleport <player>"',
      '    example: "teleport Bob"',
      "    behavior: movement",
      "    tier: player",
      "    reference_tag: mush-memory",
      "    provisional: false",
      "    implemented: true",
    ].join("\n"),
  );
  const v = provenanceViolations(bad);
  assert.equal(v.length, 1);
  assert.equal(v[0]!.verb, "teleport");
});

test("a not-yet-built canonical command reports as a GAP, never a pass", () => {
  const surface = parseSurface(
    [
      "capture:",
      "  landed: true",
      "  issue: genmurk#9",
      '  note: "landed"',
      "commands:",
      "  - verb: say",
      '    syntax: "say <message>"',
      '    example: "say hi"',
      "    behavior: speech",
      "    tier: player",
      "    reference_tag: capture:do_say",
      "    provisional: false",
      "    implemented: true",
      "  - verb: give", // a canonical command the capture names but 02 has not built
      '    syntax: "give <player> = <thing>"',
      '    example: "give Bob = lantern"',
      "    behavior: containment",
      "    tier: player",
      "    reference_tag: capture:do_give",
      "    provisional: false",
      "    implemented: false",
    ].join("\n"),
  );
  const report = runConformance(surface);
  const give = report.results.find((r) => r.entry.verb === "give")!;
  assert.equal(give.covered, false, "an unbuilt command is never covered");
  assert.equal(report.regressions.length, 0, "an unbuilt command is a gap, not a regression");
  assert.ok(report.gaps.some((g) => g.entry.verb === "give"));
});
