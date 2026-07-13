// Build the REAL world-API (src/world) from a fixture's toy WorldSeed, so the
// adversarial pack can run against the production world model — the "engine
// test double swaps for the real world-API and the pack stays green"
// acceptance (GENMURK-EPIC1-04, task 5 / AC4). Every seeded object is placed
// co-located in one room (#0) and self/seed-owned, so the world-API's
// visibility gate admits exactly what the toy world did (owned reads/writes
// succeed; foreign, non-visual attrs are PERMISSION_DENIED either way).
// The point is that budgets and refusals hold when world I/O runs through the
// production permission/inheritance machinery instead of the toy Maps.

import { DEFAULT_SEED, type WorldSeed } from "./world.ts";
import { createWorldModel, type WorldModel } from "../../src/world/world-api.ts";
import type { SnapObject, SnapAttr, WorldSnapshot, LockType } from "../../src/world/types.ts";

const ROOM = "#0";

export function createSeedWorld(seed?: WorldSeed): WorldModel {
  const objects = new Map<string, SnapObject>();
  const attrs = new Map<string, Map<string, SnapAttr>>();
  const locks = new Map<string, Map<LockType, string>>();

  // the shared room every seeded object sits in
  objects.set(ROOM, {
    id: ROOM,
    dbref: 0,
    type: "room",
    name: "Test Room",
    ownerId: ROOM,
    locationId: null,
    destinationId: null,
    parentId: null,
    power: "god",
  });

  const merged: WorldSeed = {
    objects: { ...(DEFAULT_SEED.objects ?? {}), ...(seed?.objects ?? {}) },
  };

  for (const [id, obj] of Object.entries(merged.objects ?? {})) {
    const bag = new Map<string, SnapAttr>();
    let displayName = id;
    for (const [k, v] of Object.entries(obj.attrs ?? {})) {
      if (k.toUpperCase() === "NAME") displayName = v;
      bag.set(k.toUpperCase(), { value: v, visual: false, noInherit: false });
    }
    objects.set(id, {
      id,
      dbref: Number(id.replace(/^#/, "")) || 0,
      type: "thing",
      name: displayName,
      ownerId: obj.owner,
      locationId: ROOM,
      destinationId: null,
      parentId: null,
      power: "player",
    });
    if (bag.size) attrs.set(id, bag);
  }

  const snapshot: WorldSnapshot = { objects, attrs, locks };
  return createWorldModel(snapshot);
}
