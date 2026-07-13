// The world model's in-memory shape. The softcode engine's WorldAPI
// (src/engine/types.ts) is SYNCHRONOUS — it cannot await a database round
// trip inside the fuel-metered evaluate loop. So a run works against a
// SNAPSHOT: the actor's visible slice of the world, loaded once (async,
// src/world/snapshot.ts) before the run, read/written synchronously during
// it, and its buffered mutations applied transactionally through the RPCs
// after it. RunOutcome.mutations is exactly that buffer. This is what lets a
// Postgres-backed world satisfy the engine's synchronous capability seam.

export type ObjType = "room" | "exit" | "thing" | "player";
export type Power = "player" | "builder" | "wizard" | "god";
export type LockType = "pickup" | "enter" | "use";

/** Object ids at the world-API boundary are the public `#<dbref>` string. */
export interface SnapObject {
  id: string;
  dbref: number;
  type: ObjType;
  name: string;
  ownerId: string;
  locationId: string | null;
  destinationId: string | null;
  parentId: string | null;
  power: Power;
}

export interface SnapAttr {
  value: string;
  visual: boolean;
  noInherit: boolean;
}

export interface WorldSnapshot {
  /** objects the loader deemed relevant (visible to the actor + their owned). */
  objects: Map<string, SnapObject>;
  /** objId -> canonical ATTR name -> attribute. */
  attrs: Map<string, Map<string, SnapAttr>>;
  /** objId -> lock kind -> boolean lock expression (data; evaluated here). */
  locks: Map<string, Map<LockType, string>>;
}

export function powerRank(p: Power): number {
  switch (p) {
    case "player":
      return 1;
    case "builder":
      return 2;
    case "wizard":
      return 3;
    case "god":
      return 4;
  }
}

/** The public id for a dbref, the reference's `#N`. */
export function publicId(dbref: number): string {
  return `#${dbref}`;
}
