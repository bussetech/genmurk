// A fluent in-memory world builder for the world-model unit tests — the same
// snapshot shape src/world/snapshot.ts loads from Postgres, so a test can
// exercise the world-API and lock/inherit/resolve logic without a database.

import { createWorldModel, type WorldModel } from "../../src/world/world-api.ts";
import type {
  ObjType,
  Power,
  LockType,
  SnapObject,
  SnapAttr,
  WorldSnapshot,
} from "../../src/world/types.ts";

type AttrSpec = string | { value: string; visual?: boolean; noInherit?: boolean };

export interface ObjSpec {
  type?: ObjType;
  name?: string;
  owner?: string;
  location?: string | null;
  destination?: string | null;
  parent?: string | null;
  power?: Power;
  attrs?: Record<string, AttrSpec>;
  locks?: Partial<Record<LockType, string>>;
}

export function buildSnapshot(spec: Record<string, ObjSpec>): WorldSnapshot {
  const objects = new Map<string, SnapObject>();
  const attrs = new Map<string, Map<string, SnapAttr>>();
  const locks = new Map<string, Map<LockType, string>>();

  for (const [id, s] of Object.entries(spec)) {
    objects.set(id, {
      id,
      dbref: Number(id.replace(/^#/, "")) || 0,
      type: s.type ?? "thing",
      name: s.name ?? id,
      ownerId: s.owner ?? id,
      locationId: s.location ?? null,
      destinationId: s.destination ?? null,
      parentId: s.parent ?? null,
      power: s.power ?? "player",
    });
    if (s.attrs) {
      const bag = new Map<string, SnapAttr>();
      for (const [k, v] of Object.entries(s.attrs)) {
        const a = typeof v === "string" ? { value: v } : v;
        bag.set(k.toUpperCase(), {
          value: a.value,
          visual: a.visual ?? false,
          noInherit: a.noInherit ?? false,
        });
      }
      attrs.set(id, bag);
    }
    if (s.locks) {
      const bag = new Map<LockType, string>();
      for (const [k, v] of Object.entries(s.locks)) bag.set(k as LockType, v as string);
      locks.set(id, bag);
    }
  }
  return { objects, attrs, locks };
}

export function buildWorld(spec: Record<string, ObjSpec>): WorldModel {
  return createWorldModel(buildSnapshot(spec));
}
