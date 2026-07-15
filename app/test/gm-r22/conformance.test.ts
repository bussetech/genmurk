// GM-R22 harness tests: the conformance runner is honest about coverage,
// enforces the clean-room provenance line, and stays green in its
// capture-pending state. Stack-free — wired into `npm run unit`.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadSurface, parseSurface, provenanceViolations } from "../../gm-r22/surface.ts";
import { runConformance } from "../../gm-r22/conformance.ts";

const SURFACE = resolve(dirname(fileURLToPath(import.meta.url)), "../../gm-r22/command-surface.yml");

test("the shipped surface loads and every implemented command routes to its class", () => {
  const surface = loadSurface(SURFACE);
  const report = runConformance(surface);
  assert.ok(report.total >= 16, "surface should carry the provisional command set");
  // no regression: everything we CLAIM to implement parses + routes correctly
  assert.deepEqual(report.regressions, [], "a claimed-implemented command failed to route");
  // pre-capture, implemented === covered, so coverage is 100% of the set
  assert.equal(report.covered, report.total);
  assert.equal(report.coveragePct, 100);
});

test("provenance is clean — no name invented from MUSH-family memory", () => {
  const surface = loadSurface(SURFACE);
  assert.deepEqual(provenanceViolations(surface), [], "every surface name must trace to a GM-Rn or the capture");
  // and every provisional tag is a GM-Rn requirement of record
  for (const c of surface.commands) {
    assert.match(c.reference_tag, /^GM-R\d+$/, `${c.verb} must cite a GM-Rn while the capture is pending`);
  }
});

test("the capture-pending state is present and LOUD", () => {
  const surface = loadSurface(SURFACE);
  assert.equal(surface.capture.landed, false, "capture genmurk#9 has not landed");
  assert.match(surface.capture.issue, /genmurk#9/);
  assert.ok(surface.commands.every((c) => c.provisional), "all entries are provisional pre-capture");
});

test("the divergence ledger records the GM-R14 lock-grammar subset", () => {
  const surface = loadSurface(SURFACE);
  const report = runConformance(surface);
  assert.ok(report.divergences.length >= 1, "at least one honest divergence is recorded");
  assert.ok(report.divergences.some((d) => d.verb === "lock" && /GM-R14/.test(d.divergence ?? "")));
});

test("provenance validation CATCHES an invented name (negative control)", () => {
  // an entry citing neither a GM-Rn nor the capture is a provenance violation
  const bad = parseSurface(
    [
      "capture:",
      "  landed: false",
      "  issue: genmurk#9",
      '  note: "x"',
      "commands:",
      "  - verb: teleport",
      '    syntax: "teleport <player>"',
      '    example: "teleport Bob"',
      "    behavior: movement",
      "    reference_tag: mush-memory",
      "    provisional: true",
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
      "    reference_tag: GM-R2",
      "    provisional: false",
      "    implemented: true",
      "  - verb: mail", // a canonical command GM-R17 names but 06 has not built
      '    syntax: "mail <player> = <text>"',
      '    example: "mail Bob = hi"',
      "    behavior: directed",
      "    reference_tag: GM-R17",
      "    provisional: false",
      "    implemented: false",
    ].join("\n"),
  );
  const report = runConformance(surface);
  const mail = report.results.find((r) => r.entry.verb === "mail")!;
  assert.equal(mail.covered, false, "an unbuilt command is never covered");
  assert.equal(report.regressions.length, 0, "an unbuilt command is a gap, not a regression");
  assert.ok(report.gaps.some((g) => g.entry.verb === "mail"));
});
