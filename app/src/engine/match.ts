// GM-R12 wildcard/pattern matching — the mechanics. `*` matches any run of
// characters (captured), `?` matches exactly one (captured); matching is
// case-insensitive. Every match unit charges the meter, so a backtracking
// blowup (long input vs. a many-star pattern) exhausts the step budget
// instead of hanging the host — found while building, fixture 21.
//
// The player-visible command SURFACE that consumes this arrives later as
// GM-R22 capture data; nothing here names a command.

import type { Meter } from "./meter.ts";

export interface MatchResult {
  matched: boolean;
  /** text captured by each wildcard, in pattern order */
  captures: string[];
}

const NO_MATCH: MatchResult = { matched: false, captures: [] };

interface StarState {
  patternPos: number;
  inputStart: number;
  inputLen: number;
}

/**
 * Iterative two-pointer glob match with single-star backtracking (the
 * standard linear-space algorithm). Worst case O(|input| × |pattern|) match
 * units — every unit charges 1 fuel, which is the sandbox property.
 */
export function globMatch(
  pattern: string,
  input: string,
  meter: Meter,
): MatchResult {
  const p = pattern.toLowerCase();
  const s = input.toLowerCase();
  let pi = 0;
  let si = 0;
  const stars: StarState[] = [];
  // question-mark captures keyed by pattern position (re-recorded on backtrack)
  const qCaptures = new Map<number, string>();

  const backtrack = (): boolean => {
    const last = stars[stars.length - 1];
    if (!last) return false;
    last.inputLen += 1;
    si = last.inputStart + last.inputLen;
    pi = last.patternPos + 1;
    if (si > s.length) return false;
    // a backtrack invalidates '?' captures recorded past the star
    for (const key of qCaptures.keys()) if (key > last.patternPos) qCaptures.delete(key);
    return true;
  };

  for (;;) {
    meter.charge(1);
    if (pi < p.length && p[pi] === "*") {
      // collapse runs of '*'; a star matches greedily-minimal, extended on backtrack
      while (p[pi + 1] === "*") {
        meter.charge(1); // star runs are work too — no unmetered loop
        pi++;
      }
      stars.push({ patternPos: pi, inputStart: si, inputLen: 0 });
      pi++;
      continue;
    }
    if (si < s.length && pi < p.length && (p[pi] === "?" || p[pi] === s[si])) {
      if (p[pi] === "?") qCaptures.set(pi, input[si]);
      pi++;
      si++;
      continue;
    }
    if (pi === p.length && si === s.length) {
      const captures: { at: number; text: string }[] = [];
      for (const st of stars)
        captures.push({
          at: st.patternPos,
          text: input.slice(st.inputStart, st.inputStart + st.inputLen),
        });
      for (const [at, text] of qCaptures) captures.push({ at, text });
      captures.sort((a, b) => a.at - b.at);
      return { matched: true, captures: captures.map((c) => c.text) };
    }
    if (!backtrack()) return NO_MATCH;
  }
}
