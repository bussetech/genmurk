// GM-R22 conformance runner — the harness that makes command-set
// compatibility TESTABLE the day the airgapped canonical capture (genmurk#9)
// lands, and REPORTS honest coverage until then.
//
// For each entry in command-surface.yml it drives the entry's canonical
// `example` through the REAL parser (src/server/verbs.ts parseCommand) and
// asserts the resulting verb resolves to the entry's declared behavior class.
// An entry marked `implemented: true` that fails to parse/route is a
// REGRESSION (the runner exits non-zero); an entry we have not built yet
// (`implemented: false`, which only a future capture will introduce) reports
// as an honest coverage GAP — never a silent pass. Provenance is enforced:
// any surface name tracing to neither the capture nor a GM-Rn requirement
// fails the run (the clean-room line).
//
// This is a SURFACE conformance check (name + syntax + behavior CLASS),
// stack-free, wired into `npm test`. The behavioral EFFECT of each verb is
// proven separately by the dispatch tests (test/server/dispatch.test.ts) and
// the real-stack acceptance scenario (test/world/building.test.ts).

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseCommand, behaviorClass } from "../src/server/verbs.ts";
import {
  loadSurface,
  provenanceViolations,
  type CommandEntry,
  type CommandSurface,
} from "./surface.ts";

export interface EntryResult {
  entry: CommandEntry;
  parsedVerb: string;
  covered: boolean;
  reason: string;
}

export interface TierCoverage {
  tier: string;
  total: number;
  covered: number;
  coveragePct: number;
}

export interface ConformanceReport {
  surface: CommandSurface;
  results: EntryResult[];
  total: number;
  covered: number;
  coveragePct: number;
  gaps: EntryResult[];
  regressions: EntryResult[];
  divergences: CommandEntry[];
  provisionalCount: number;
  provenance: CommandEntry[];
  /** per-tier coverage (player = everyday core; builder = construction/ops). */
  byTier: TierCoverage[];
  /** entries whose provenance is the landed capture (`capture:<id>`). */
  captureTraced: number;
  /** reference commands OUT of the player-facing bar (referenceTotal −
   *  captureTraced): wizard/god admin + channels + economy. */
  excludedTotal: number;
  /** captureTraced + excludedAdmin + excludedChannels + excludedEconomy — must
   *  equal referenceTotal, so every reference command is accounted for. */
  accountedTotal: number;
  /** false when the accounting does not sum to referenceTotal (a real defect:
   *  a reference command was silently dropped or double-counted). */
  accountingOk: boolean;
}

function pct(covered: number, total: number): number {
  return total ? Math.round((covered / total) * 1000) / 10 : 0;
}

export function runConformance(surface: CommandSurface): ConformanceReport {
  const results: EntryResult[] = surface.commands.map((entry) => {
    const parsed = parseCommand(entry.example);
    const cls = behaviorClass(parsed.verb);
    if (parsed.verb === "unknown" || parsed.verb === "empty") {
      return { entry, parsedVerb: parsed.verb, covered: false, reason: `example did not parse (${parsed.verb})` };
    }
    if (cls !== entry.behavior) {
      return {
        entry,
        parsedVerb: parsed.verb,
        covered: false,
        reason: `routed to "${cls}", expected "${entry.behavior}"`,
      };
    }
    if (!entry.implemented) {
      return { entry, parsedVerb: parsed.verb, covered: false, reason: "declared not implemented" };
    }
    return { entry, parsedVerb: parsed.verb, covered: true, reason: "ok" };
  });

  const covered = results.filter((r) => r.covered).length;
  const gaps = results.filter((r) => !r.covered);
  // a regression is a gap on something we CLAIM to implement — a real defect,
  // as opposed to a not-yet-built canonical command (an honest coverage gap).
  const regressions = gaps.filter((r) => r.entry.implemented);

  const byTier: TierCoverage[] = (["player", "builder"] as const).map((tier) => {
    const rs = results.filter((r) => r.entry.tier === tier);
    const cov = rs.filter((r) => r.covered).length;
    return { tier, total: rs.length, covered: cov, coveragePct: pct(cov, rs.length) };
  });

  const cap = surface.capture;
  const captureTraced = surface.commands.filter((c) => /^capture:/i.test(c.reference_tag.trim())).length;
  const accountedTotal = captureTraced + cap.excludedAdmin + cap.excludedChannels + cap.excludedEconomy;
  // Only meaningful once the capture (with a referenceTotal) has landed.
  const accountingOk = !cap.landed || cap.referenceTotal === 0 || accountedTotal === cap.referenceTotal;
  const excludedTotal = Math.max(0, cap.referenceTotal - captureTraced);

  return {
    surface,
    results,
    total: results.length,
    covered,
    coveragePct: pct(covered, results.length),
    gaps,
    regressions,
    divergences: surface.commands.filter((c) => c.divergence),
    provisionalCount: surface.commands.filter((c) => c.provisional).length,
    provenance: provenanceViolations(surface),
    byTier,
    captureTraced,
    excludedTotal,
    accountedTotal,
    accountingOk,
  };
}

export function renderReport(r: ConformanceReport): string {
  const cap = r.surface.capture;
  const L: string[] = [];
  L.push("═══════════════════════════════════════════════════════════════");
  L.push("  GM-R22 END-USER COMMAND-SET COMPATIBILITY — conformance report");
  L.push("═══════════════════════════════════════════════════════════════");
  L.push("");
  if (cap.landed) {
    L.push("  ┌─────────────────────────────────────────────────────────┐");
    L.push("  │  ✓  CANONICAL CAPTURE LANDED — coverage is REAL           │");
    L.push(`  │     ${cap.issue.padEnd(52)}│`);
    L.push("  │     each entry traces to a reference command (capture:…)   │");
    L.push("  │     or a GM-Rn requirement of record. Coverage is measured │");
    L.push("  │     against the reference's PLAYER-FACING command set.      │");
    L.push("  └─────────────────────────────────────────────────────────┘");
  } else {
    L.push("  ┌─────────────────────────────────────────────────────────┐");
    L.push("  │  ⚠  CANONICAL CAPTURE NOT LANDED — coverage is PROVISIONAL │");
    L.push(`  │     tracking issue: ${cap.issue.padEnd(37)}│`);
    L.push("  │     every command below traces to a GM-Rn requirement of   │");
    L.push("  │     record, NOT to the reference command list. Real GM-R22 │");
    L.push("  │     coverage cannot be measured until the capture lands.    │");
    L.push("  └─────────────────────────────────────────────────────────┘");
  }
  L.push("");
  L.push(
    `  player-facing coverage: ${r.covered}/${r.total} (${r.coveragePct}%)  ·  divergences: ${r.divergences.length}  ·  provisional: ${r.provisionalCount}/${r.total}`,
  );
  for (const t of r.byTier) {
    L.push(`    · ${t.tier.padEnd(8)} ${t.covered}/${t.total} (${t.coveragePct}%)`);
  }
  if (cap.landed && cap.referenceTotal > 0) {
    L.push("");
    L.push(
      `  reference total: ${cap.referenceTotal} commands  ·  in the player-facing bar: ${r.captureTraced} (traced) + ${r.total - r.captureTraced} requirement-derived`,
    );
    L.push(
      `  OUT of the bar: ${r.excludedTotal}  ·  wizard/god admin ${cap.excludedAdmin} · channels ${cap.excludedChannels} · economy ${cap.excludedEconomy}` +
        "  (server control is dev-tier ops GM-R19 / the Studio Portal, not in-world verbs)",
    );
  }
  L.push("");
  for (const res of r.results) {
    const mark = res.covered ? "✓" : res.entry.implemented ? "✗" : "○";
    const prov = res.entry.provisional ? " [provisional]" : "";
    L.push(
      `  ${mark} ${res.entry.verb.padEnd(10)} ${res.entry.tier.padEnd(7)} ${res.entry.reference_tag.padEnd(18)} ${res.entry.syntax}${prov}`,
    );
    if (!res.covered) L.push(`      └─ ${res.reason}`);
    if (res.entry.divergence) L.push(`      ⇄ divergence: ${res.entry.divergence}`);
  }
  L.push("");
  if (r.divergences.length) {
    L.push("  DIVERGENCE LEDGER (GM-R14 wins; documented for returning users):");
    for (const d of r.divergences) L.push(`   ⇄ ${d.verb}: ${d.divergence}`);
    L.push("");
  }
  if (r.provenance.length) {
    L.push("  ✗ PROVENANCE VIOLATION — names not traceable to capture or GM-Rn:");
    for (const p of r.provenance) L.push(`     ${p.verb} (reference_tag=${p.reference_tag})`);
    L.push("");
  }
  if (!r.accountingOk) {
    L.push(
      `  ✗ ACCOUNTING MISMATCH — traced ${r.captureTraced} + excluded ${cap.excludedAdmin}/${cap.excludedChannels}/${cap.excludedEconomy} = ${r.accountedTotal}, expected ${cap.referenceTotal} (a reference command was dropped or double-counted).`,
    );
    L.push("");
  }
  if (r.regressions.length) {
    L.push("  ✗ REGRESSIONS — commands claimed implemented that did not route:");
    for (const g of r.regressions) L.push(`     ${g.entry.verb}: ${g.reason}`);
    L.push("");
  }
  const gapsOnly = r.gaps.filter((g) => !g.entry.implemented);
  if (gapsOnly.length) {
    L.push(`  ○ COVERAGE GAPS (not yet built): ${gapsOnly.map((g) => g.entry.verb).join(", ")}`);
    L.push("");
  }
  const ok = r.provenance.length === 0 && r.regressions.length === 0 && r.accountingOk;
  L.push(ok ? "  RESULT: surface conformance GREEN." : "  RESULT: FAILED — see violations above.");
  L.push("═══════════════════════════════════════════════════════════════");
  return L.join("\n");
}

const SURFACE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "command-surface.yml");

/** Non-zero exit ONLY on a real defect: a provenance violation, a regression
 *  on a claimed-implemented command, or an accounting mismatch (a reference
 *  command silently dropped). Not-yet-built canonical commands are honest
 *  coverage gaps and stay green — the coverage number carries that state. */
export function main(): void {
  const surface = loadSurface(SURFACE_PATH);
  const report = runConformance(surface);
  console.log(renderReport(report));
  if (report.provenance.length > 0 || report.regressions.length > 0 || !report.accountingOk) process.exit(1);
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split("/").pop()!);
if (isMain) main();
