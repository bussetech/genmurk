// The async boundary between Postgres and the synchronous world-API. The
// server loads a SNAPSHOT of the actor's relevant world (its room, what
// shares the room, its inventory, what it owns, and the parent chains those
// need for inheritance) with a service-role client — the world-API then
// enforces per-actor GM-R15 gates in memory. After a run, the buffered
// mutations are applied through the audited RPCs as the ACTOR (a JWT-scoped
// client), so RLS + the RPC role checks are the final wall. This is the loop
// prompt 05's transport and prompt 08's command layer will drive; it is a
// designed seam here (no transport is wired — guardrail).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorldMutation } from "../engine/types.ts";
import type { ObjType, Power, SnapObject, SnapAttr, WorldSnapshot, LockType } from "./types.ts";
import { publicId } from "./types.ts";

interface ObjRow {
  id: string;
  dbref: number;
  type: ObjType;
  name: string;
  owner_id: string;
  location_id: string | null;
  destination_id: string | null;
  parent_id: string | null;
  power: Power;
  destroyed_at: string | null;
}

export interface LoadedSnapshot {
  snapshot: WorldSnapshot;
  /** public `#dbref` → row uuid, for translating buffered mutations back. */
  refToUuid: Map<string, string>;
}

function mustData<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data as T;
}

/**
 * Load the actor's neighborhood (service-role read). The snapshot is a
 * bounded slice — not the database — but it is loaded with elevated read so
 * lock evaluation can see locks the actor itself may not SELECT; the
 * world-API re-gates every read against the actor.
 */
export async function loadSnapshot(svc: SupabaseClient, actorDbref: number): Promise<LoadedSnapshot> {
  // global id ⇄ dbref map (dev-scale worlds; 08 can scope this)
  const idRows = mustData<{ id: string; dbref: number }[]>(
    await svc.from("objects").select("id, dbref"),
    "load id map",
  );
  const idToRef = new Map(idRows.map((r) => [r.id, r.dbref] as const));
  const refToUuid = new Map(idRows.map((r) => [publicId(r.dbref), r.id] as const));

  const actorUuid = refToUuid.get(publicId(actorDbref));
  if (!actorUuid) throw new Error(`no object #${actorDbref}`);

  const all = mustData<ObjRow[]>(
    await svc.from("objects").select("*").is("destroyed_at", null),
    "load objects",
  );
  const byUuid = new Map(all.map((r) => [r.id, r] as const));
  const actor = byUuid.get(actorUuid);
  if (!actor || actor.type !== "player") throw new Error(`#${actorDbref} is not a live player`);

  // neighborhood: self, the room, room contents (co-located), inventory, owned
  const keep = new Set<string>();
  for (const r of all) {
    const inRoom = actor.location_id && r.location_id === actor.location_id;
    const inInv = r.location_id === actorUuid;
    const owned = r.owner_id === actorUuid;
    if (r.id === actorUuid || r.id === actor.location_id || inRoom || inInv || owned) {
      keep.add(r.id);
    }
  }
  keep.add(actorUuid);
  // pull in parent chains for inheritance (bounded)
  for (const seed of [...keep]) {
    let cur = byUuid.get(seed)?.parent_id ?? null;
    let hops = 0;
    while (cur && !keep.has(cur) && hops < 32) {
      keep.add(cur);
      cur = byUuid.get(cur)?.parent_id ?? null;
      hops++;
    }
  }

  const objects = new Map<string, SnapObject>();
  for (const id of keep) {
    const r = byUuid.get(id);
    if (!r) continue;
    const ref = (u: string | null): string | null =>
      u && idToRef.has(u) ? publicId(idToRef.get(u)!) : null;
    objects.set(publicId(r.dbref), {
      id: publicId(r.dbref),
      dbref: r.dbref,
      type: r.type,
      name: r.name,
      ownerId: ref(r.owner_id) ?? publicId(r.dbref),
      locationId: ref(r.location_id),
      destinationId: ref(r.destination_id),
      parentId: ref(r.parent_id),
      power: r.power,
    });
  }

  const keepUuids = [...keep];
  const attrRows = mustData<
    { object_id: string; name: string; value: string; visual: boolean; no_inherit: boolean }[]
  >(
    await svc.from("object_attributes").select("*").in("object_id", keepUuids),
    "load attrs",
  );
  const attrs = new Map<string, Map<string, SnapAttr>>();
  for (const a of attrRows) {
    const ref = publicId(idToRef.get(a.object_id)!);
    if (!attrs.has(ref)) attrs.set(ref, new Map());
    attrs.get(ref)!.set(a.name, { value: a.value, visual: a.visual, noInherit: a.no_inherit });
  }

  const lockRows = mustData<{ object_id: string; lock_type: LockType; expr: string }[]>(
    await svc.from("object_locks").select("*").in("object_id", keepUuids),
    "load locks",
  );
  const locks = new Map<string, Map<LockType, string>>();
  for (const l of lockRows) {
    const ref = publicId(idToRef.get(l.object_id)!);
    if (!locks.has(ref)) locks.set(ref, new Map());
    locks.get(ref)!.set(l.lock_type, l.expr);
  }

  return { snapshot: { objects, attrs, locks }, refToUuid };
}

/**
 * Apply a run's buffered mutations through the audited RPCs, AS THE ACTOR
 * (the passed client carries the actor's JWT), so RLS and the RPC role checks
 * are the final wall. setAttr and move are wired here; create/destroy arrive
 * with the softcode building verbs (prompt 08).
 */
export async function applyMutations(
  db: SupabaseClient,
  refToUuid: Map<string, string>,
  mutations: WorldMutation[],
): Promise<void> {
  const uuid = (ref: string): string => {
    const u = refToUuid.get(ref);
    if (!u) throw new Error(`unknown object ${ref} in mutation`);
    return u;
  };
  for (const m of mutations) {
    if (m.op === "setAttr") {
      const eq = m.detail.indexOf("=");
      const name = m.detail.slice(0, eq);
      const value = m.detail.slice(eq + 1);
      const { error } = await db.rpc("world_set_attr", {
        p_target: uuid(m.target),
        p_name: name,
        p_value: value,
      });
      if (error) throw new Error(`apply setAttr ${m.target}: ${error.message}`);
    } else if (m.op === "move") {
      const dest = m.detail.split("->").pop()!;
      const { error } = await db.rpc("world_move", {
        p_what: uuid(m.target),
        p_dest: uuid(dest),
      });
      if (error) throw new Error(`apply move ${m.target}: ${error.message}`);
    }
    // create/destroy: buffered but not auto-applied in v1 (prompt 08)
  }
}
