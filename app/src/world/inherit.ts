// Attribute inheritance (GM-R9). Resolution order, documented so it is
// testable (docs/world-model.md):
//
//   1. An object's OWN attribute always wins — including one flagged
//      no_inherit (no_inherit blocks passing DOWN, not reading on self).
//   2. Otherwise walk the parent chain (parent, grandparent, …). The FIRST
//      ancestor that HAS the attribute decides the result: if that ancestor's
//      attribute is no_inherit, the attribute is NOT inherited (resolution
//      yields "not found"); otherwise its value is inherited.
//   3. The walk is bounded (depth cap); the DB forbids parent cycles, this is
//      defense in depth.
//
// The returned `holderId` is the object the value actually came from — the
// read gate is applied by the caller against BOTH the target and the holder.

import type { WorldSnapshot, SnapAttr } from "./types.ts";

const MAX_PARENT_DEPTH = 128;

export interface ResolvedAttr extends SnapAttr {
  holderId: string;
  inherited: boolean;
}

export function resolveAttr(
  snap: WorldSnapshot,
  objId: string,
  attrName: string,
): ResolvedAttr | null {
  const name = attrName.toUpperCase();

  const own = snap.attrs.get(objId)?.get(name);
  if (own) return { ...own, holderId: objId, inherited: false };

  let cur = snap.objects.get(objId)?.parentId ?? null;
  let hops = 0;
  while (cur && hops < MAX_PARENT_DEPTH) {
    const a = snap.attrs.get(cur)?.get(name);
    if (a) {
      if (a.noInherit) return null; // present but not inheritable → not found
      return { ...a, holderId: cur, inherited: true };
    }
    cur = snap.objects.get(cur)?.parentId ?? null;
    hops++;
  }
  return null;
}
