// A tiny, bounded glob → RegExp compiler for lock attribute predicates
// (GM-R8) and case-insensitive name matching (GM-R12). Only `*` (any run)
// and `?` (any one char) are special; every other character is matched
// literally. All regex metacharacters are escaped, so a hostile stored lock
// or name cannot inject a catastrophic-backtracking pattern — the produced
// regex has no nested quantifiers over the same input.

const META = /[.*+?^${}()|[\]\\]/g;

export function globToRegExp(glob: string): RegExp {
  let out = "^";
  for (const ch of glob) {
    if (ch === "*") out += ".*";
    else if (ch === "?") out += ".";
    else out += ch.replace(META, "\\$&");
  }
  out += "$";
  return new RegExp(out, "is"); // case-insensitive; `s` so `.` spans newlines
}

/** Case-insensitive equality or glob match of a candidate against a pattern. */
export function nameMatches(pattern: string, candidate: string): boolean {
  if (!pattern.includes("*") && !pattern.includes("?")) {
    return pattern.toLowerCase() === candidate.toLowerCase();
  }
  return globToRegExp(pattern).test(candidate);
}
