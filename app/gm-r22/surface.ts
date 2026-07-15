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

export interface CommandEntry {
  verb: string;
  syntax: string;
  example: string;
  behavior: BehaviorClass;
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
  "reference_tag",
  "provisional",
  "implemented",
  "divergence",
  "landed",
  "issue",
  "note",
]);

function parseScalar(raw: string): string | boolean {
  const v = raw.trim();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
  return v;
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
  return {
    verb: str("verb"),
    syntax: str("syntax"),
    example: str("example"),
    behavior: str("behavior") as BehaviorClass,
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
