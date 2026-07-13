// Name resolution (GM-R12): turn a token a player typed into an object id.
// Handles `me`, `here`, `#dbref`, and partial/exact names, always scoped to
// what the actor can currently see (self, the room, its contents, the
// actor's inventory). The MATCHING work is charged fuel by the engine when it
// drives this; here it is pure and bounded (a single pass over the visible
// candidate set). This is the world-model half of GM-R12; the engine owns the
// wildcard command-dispatch half (src/engine/match.ts).

import type { WorldSnapshot, SnapObject } from "./types.ts";
import { nameMatches } from "./glob.ts";

export type Resolution =
  | { status: "ok"; id: string }
  | { status: "none" }
  | { status: "ambiguous" };

export interface ResolveDeps {
  canSee(actorId: string, targetId: string): boolean;
  locationOf(id: string): string | null;
}

/** Candidates in scope for the actor: self, here, room contents, inventory. */
export function candidatesFor(
  snap: WorldSnapshot,
  deps: ResolveDeps,
  actorId: string,
): SnapObject[] {
  const out: SnapObject[] = [];
  for (const o of snap.objects.values()) {
    if (deps.canSee(actorId, o.id)) out.push(o);
  }
  return out;
}

export function resolveName(
  snap: WorldSnapshot,
  deps: ResolveDeps,
  actorId: string,
  token: string,
): Resolution {
  const t = token.trim();
  if (t.length === 0) return { status: "none" };

  if (t.toLowerCase() === "me") {
    return snap.objects.has(actorId) ? { status: "ok", id: actorId } : { status: "none" };
  }
  if (t.toLowerCase() === "here") {
    const here = deps.locationOf(actorId);
    return here && deps.canSee(actorId, here) ? { status: "ok", id: here } : { status: "none" };
  }
  if (/^#\d+$/.test(t)) {
    // absolute dbref: valid only if the actor may see it
    return snap.objects.has(t) && deps.canSee(actorId, t)
      ? { status: "ok", id: t }
      : { status: "none" };
  }

  const cands = candidatesFor(snap, deps, actorId);
  // exact (case-insensitive) beats prefix; both drawn only from what's visible
  const exact = cands.filter((o) => o.name.toLowerCase() === t.toLowerCase());
  if (exact.length === 1) return { status: "ok", id: exact[0]!.id };
  if (exact.length > 1) return { status: "ambiguous" };

  // partial matching (v1, documented): an explicit glob uses glob semantics;
  // a plain token matches any visible object whose name CONTAINS it (so
  // "lantern" resolves "a brass lantern"). Exact match above always wins.
  const hasGlob = t.includes("*") || t.includes("?");
  const partial = cands.filter((o) =>
    hasGlob ? nameMatches(t, o.name) : o.name.toLowerCase().includes(t.toLowerCase()),
  );
  if (partial.length === 1) return { status: "ok", id: partial[0]!.id };
  if (partial.length > 1) return { status: "ambiguous" };
  return { status: "none" };
}
