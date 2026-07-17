// GM-R22 command-surface loader + provenance validation.
//
// The surface is DATA (command-surface.yml) so the airgapped preservation
// capture (genmurk#9) drops in without code changes. Node has no built-in
// YAML and we add no dependency for a data file this small, so this is a
// deliberately-minimal loader for the exact subset the surface file uses:
// a top-level `capture:` map and a `commands:` list of flat maps whose values
// are strings or booleans. It is strict — anything outside that subset is a
// loud parse error, not a silent skip (an unparseable surface must never read
// as "no commands").

import { readFileSync } from "node:fs";
import type { BehaviorClass } from "../src/server/verbs.ts";

/** Which slice of the reference's PLAYER-FACING surface an entry belongs to.
 *  `player` = the everyday verbs any user types (the GM-R22 onboarding core);
 *  `builder` = the world-construction + privileged-operator verbs a
 *  building-enabled/wizard user types. Both are IN the GM-R22 bar. The
 *  reference's wizard/god server-and-database administration commands, its
 *  channels, and its economy are OUT of the bar and are NOT entries — they are
 *  accounted for as counts on the capture block (see CaptureStatus). */
export type Tier = "player" | "builder";

export interface CommandEntry {
  verb: string;
  syntax: string;
  example: string;
  behavior: BehaviorClass;
  tier: Tier;
  /** GM-Rn requirement of record, or `capture:<id>` once the capture lands. */
  reference_tag: string;
  provisional: boolean;
  implemented: boolean;
  /** where the sandbox / modern practice forces a difference (GM-R14 wins). */
  divergence?: string;
}

export interface CaptureStatus {
  landed: boolean;
  issue: string;
  note: string;
  /** provenance of the landed capture (features-doc + historic-user review). */
  source: string;
  /** total built-in commands the reference parser recognizes (the honest
   *  denominator for the out-of-bar accounting). 0 until the capture lands. */
  referenceTotal: number;
  /** reference commands OUT of the GM-R22 player-facing bar, by class. Their
   *  sum + the capture-traced entries must equal referenceTotal (the runner
   *  asserts it — nothing is silently dropped). */
  excludedAdmin: number;
  excludedChannels: number;
  excludedEconomy: number;
}

export interface CommandSurface {
  capture: CaptureStatus;
  commands: CommandEntry[];
}

const SCALAR_KEYS = new Set([
  "verb",
  "syntax",
  "example",
  "behavior",
  "tier",
  "reference_tag",
  "provisional",
  "implemented",
  "divergence",
  "landed",
  "issue",
  "note",
  "source",
  "reference_total",
  "excluded_admin",
  "excluded_channels",
  "excluded_economy",
]);

function parseScalar(raw: string): string | boolean {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
}

/** Coerce a capture scalar to a non-negative integer (0 when absent). */
function captureInt(m: Record<string, string | boolean>, k: string): number {
  const v = m[k];
  if (v === undefined) return 0;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`gm-r22 surface: capture.${k} must be a non-negative integer`);
  return n;
}

/** Parse the minimal YAML subset. Full-line comments and blank lines are
 *  skipped; `#` inside a value (e.g. `example: "lock use north = #1"`) is
 *  preserved because only whole-line comments are stripped. */
export function parseSurface(text: string): CommandSurface {
  const lines = text.split("\n");
  const capture: Record<string, string | boolean> = {};
  const commands: Record<string, string | boolean>[] = [];
  let section: "capture" | "commands" | null = null;
  let item: Record<string, string | boolean> | null = null;

  const kv = (s: string): [string, string] => {
    const m = /^([A-Za-z_]+):\s?(.*)$/.exec(s);
    if (!m) throw new Error(`gm-r22 surface: unparseable line: ${JSON.stringify(s)}`);
    const key = m[1]!;
    if (!SCALAR_KEYS.has(key)) throw new Error(`gm-r22 surface: unknown key "${key}"`);
    return [key, m[2]!];
  };

  for (const rawLine of lines) {
    if (rawLine.trim() === "" || /^\s*#/.test(rawLine)) continue;
    if (/^capture:\s*$/.test(rawLine)) {
      section = "capture";
      continue;
    }
    if (/^commands:\s*$/.test(rawLine)) {
      section = "commands";
      continue;
    }
    if (section === "capture" && /^ {2}\S/.test(rawLine)) {
      const [k, v] = kv(rawLine.trim());
      capture[k] = parseScalar(v);
      continue;
    }
    if (section === "commands") {
      const itemStart = /^ {2}- (.*)$/.exec(rawLine);
      if (itemStart) {
        item = {};
        commands.push(item);
        const [k, v] = kv(itemStart[1]!);
        item[k] = parseScalar(v);
        continue;
      }
      if (/^ {4}\S/.test(rawLine) && item) {
        const [k, v] = kv(rawLine.trim());
        item[k] = parseScalar(v);
        continue;
      }
    }
    throw new Error(`gm-r22 surface: unexpected line in section ${section}: ${JSON.stringify(rawLine)}`);
  }

  return {
    capture: {
      landed: capture["landed"] === true,
      issue: String(capture["issue"] ?? ""),
      note: String(capture["note"] ?? ""),
      source: String(capture["source"] ?? ""),
      referenceTotal: captureInt(capture, "reference_total"),
      excludedAdmin: captureInt(capture, "excluded_admin"),
      excludedChannels: captureInt(capture, "excluded_channels"),
      excludedEconomy: captureInt(capture, "excluded_economy"),
    },
    commands: commands.map((c, i) => coerceEntry(c, i)),
  };
}

function coerceEntry(c: Record<string, string | boolean>, i: number): CommandEntry {
  const str = (k: string): string => {
    const v = c[k];
    if (typeof v !== "string" || v === "") throw new Error(`gm-r22 surface: entry ${i} missing "${k}"`);
    return v;
  };
  const bool = (k: string): boolean => c[k] === true;
  const tier = str("tier");
  if (tier !== "player" && tier !== "builder") {
    throw new Error(`gm-r22 surface: entry ${i} tier must be "player" or "builder", got "${tier}"`);
  }
  return {
    verb: str("verb"),
    syntax: str("syntax"),
    example: str("example"),
    behavior: str("behavior") as BehaviorClass,
    tier,
    reference_tag: str("reference_tag"),
    provisional: bool("provisional"),
    implemented: bool("implemented"),
    divergence: typeof c["divergence"] === "string" ? (c["divergence"] as string) : undefined,
  };
}

export function loadSurface(path: string): CommandSurface {
  return parseSurface(readFileSync(path, "utf8"));
}

/** Provenance (GM-R22 clean-room line): every surface name must trace to the
 *  capture or to a GM-Rn requirement of record — never invented from model
 *  memory of the MUSH family. Returns the offending entries (empty = clean). */
export function provenanceViolations(surface: CommandSurface): CommandEntry[] {
  return surface.commands.filter((c) => {
    const tag = c.reference_tag.trim();
    const fromRequirement = /^GM-R\d+$/.test(tag);
    const fromCapture = /^capture:/i.test(tag) && surface.capture.landed;
    return !(fromRequirement || fromCapture);
  });
}
