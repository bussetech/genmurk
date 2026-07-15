// The world-API: the engine's ONLY capability surface (src/engine/types.ts),
// implemented over an in-memory snapshot. Reads are synchronous permission
// checks against the snapshot; writes buffer a WorldMutation (applied through
// the RPCs after the run — src/world/snapshot.ts) and update the snapshot so
// later reads in the same run see them. The permission model here is the
// SECOND wall (GM-R14): the engine sandbox is the first, RLS + the RPC role
// checks are the third. This layer re-checks GM-R15 control on every call, so
// even a mis-scoped snapshot cannot leak or write across ownership.

import type { WorldAPI, WorldMutation, WorldRefusal } from "../engine/types.ts";
import type { WorldSnapshot, LockType } from "./types.ts";
import { powerRank } from "./types.ts";
import { resolveAttr } from "./inherit.ts";
import { evalLock, type LockWorld } from "./lock.ts";
import { resolveName, type Resolution } from "./resolve.ts";

const DENIED: WorldRefusal = { refused: "PERMISSION_DENIED" };

export interface PendingEmit {
  actorId: string;
  roomId: string | null;
  text: string;
}

export class WorldModel implements WorldAPI {
  readonly mutations: WorldMutation[] = [];
  readonly emits: PendingEmit[] = [];
  private readonly snap: WorldSnapshot;

  constructor(snap: WorldSnapshot) {
    this.snap = snap;
  }

  // ------------------------------------------------------------- perms

  private canSee(actorId: string, targetId: string): boolean {
    const a = this.snap.objects.get(actorId);
    const t = this.snap.objects.get(targetId);
    if (!a || !t) return false;
    if (powerRank(a.power) >= 3) return true; // wizard/god see all in scope
    if (targetId === actorId) return true; // self
    if (t.ownerId === actorId) return true; // own objects
    if (targetId === a.locationId) return true; // the room I'm in
    if (t.locationId && t.locationId === a.locationId) return true; // co-located
    if (t.locationId === actorId) return true; // in my inventory
    return false;
  }

  private controls(actorId: string, targetId: string): boolean {
    const a = this.snap.objects.get(actorId);
    if (!a) return false;
    if (powerRank(a.power) >= 3) return true;
    // An object controls ITSELF: players already do (they own themselves),
    // and object-attached softcode running AS its object (GENMURK-EPIC1-07)
    // must be able to keep state on its own object — its own boundary, no
    // one else's. Self-control never crosses ownership.
    if (targetId === actorId) return this.snap.objects.has(targetId);
    const t = this.snap.objects.get(targetId);
    return !!t && t.ownerId === actorId;
  }

  // --------------------------------------------------------- WorldAPI

  getAttr(actor: string, target: string, attr: string): string | WorldRefusal {
    if (!this.snap.objects.has(target)) return DENIED;
    if (!this.canSee(actor, target)) return DENIED;
    const resolved = resolveAttr(this.snap, target, attr);
    if (resolved) {
      if (resolved.visual || this.controls(actor, target)) return resolved.value;
      return DENIED;
    }
    // absent: the owner reads a missing attr as empty; others cannot probe
    return this.controls(actor, target) ? "" : DENIED;
  }

  setAttr(actor: string, target: string, attr: string, value: string): true | WorldRefusal {
    if (!this.snap.objects.has(target)) return DENIED;
    if (!this.controls(actor, target)) return DENIED;
    const name = attr.toUpperCase();
    let bag = this.snap.attrs.get(target);
    if (!bag) {
      bag = new Map();
      this.snap.attrs.set(target, bag);
    }
    const prev = bag.get(name);
    bag.set(name, { value, visual: prev?.visual ?? false, noInherit: prev?.noInherit ?? false });
    // Attribute NAMES are canonicalized to uppercase for storage/lookup (the
    // DB constraint + RPC do the same), but the journaled diagnostic keeps the
    // caller's original spelling — the mutation is applied case-insensitively.
    this.mutations.push({ op: "setAttr", target, detail: `${attr}=${value}` });
    return true;
  }

  emit(actor: string, text: string): void {
    // Buffered for prompt 05's transport to fan to room occupants; the engine
    // also collects emitted lines into RunOutcome.output, so this is a sink
    // that additionally records the room the line belongs to. The line lands
    // in the NEAREST ENCLOSING ROOM (GENMURK-EPIC1-07): a room speaks into
    // itself; a thing in a room speaks there; a pocket gadget speaks into its
    // holder's room. Bounded walk — a containment anomaly yields null (the
    // emit is dropped at routing), never a spin.
    let cur = this.snap.objects.get(actor);
    let hops = 0;
    while (cur && cur.type !== "room" && hops < 64) {
      cur = cur.locationId ? this.snap.objects.get(cur.locationId) : undefined;
      hops++;
    }
    const roomId = cur && cur.type === "room" ? cur.id : null;
    this.emits.push({ actorId: actor, roomId, text });
  }

  name(actor: string, target: string): string | WorldRefusal {
    const t = this.snap.objects.get(target);
    if (!t || !this.canSee(actor, target)) return DENIED;
    return t.name;
  }

  location(actor: string, target: string): string | WorldRefusal {
    const t = this.snap.objects.get(target);
    if (!t || !this.canSee(actor, target)) return DENIED;
    return t.locationId ?? "#0";
  }

  visibleObjects(actor: string): { id: string; name: string }[] {
    const out: { id: string; name: string }[] = [];
    for (const o of this.snap.objects.values()) {
      if (this.canSee(actor, o.id)) out.push({ id: o.id, name: o.name });
    }
    return out;
  }

  // ------------------------------------------- world-model hooks (GM-R12/R8)

  resolveName(actor: string, token: string): Resolution {
    return resolveName(
      this.snap,
      {
        canSee: (a, t) => this.canSee(a, t),
        locationOf: (id) => this.snap.objects.get(id)?.locationId ?? null,
      },
      actor,
      token,
    );
  }

  private lockWorld(): LockWorld {
    return {
      actorId: "", // filled per call below
      carrying: (id) =>
        [...this.snap.objects.values()].filter((o) => o.locationId === id).map((o) => o.id),
      attr: (id, name) => resolveAttr(this.snap, id, name)?.value ?? "",
    };
  }

  private checkLock(actor: string, target: string, kind: LockType): boolean {
    const expr = this.snap.locks.get(target)?.get(kind);
    if (expr === undefined) return true; // no lock ⇒ open (reference default)
    const w = { ...this.lockWorld(), actorId: actor };
    return evalLock(expr, w).ok;
  }

  canPickup(actor: string, target: string): boolean {
    return this.checkLock(actor, target, "pickup");
  }
  canEnter(actor: string, target: string): boolean {
    return this.checkLock(actor, target, "enter");
  }
  canUse(actor: string, target: string): boolean {
    return this.checkLock(actor, target, "use");
  }

  /** Movement (GM-R6): buffers a move + updates the snapshot. Lock GATING
   *  (canEnter/canPickup) is the caller's to run first — this enforces the
   *  structural rules: you move yourself or what you control, and no
   *  containment cycle. */
  move(actor: string, what: string, dest: string): true | WorldRefusal {
    if (!this.controls(actor, what)) return DENIED;
    const w = this.snap.objects.get(what);
    const d = this.snap.objects.get(dest);
    if (!w || !d) return DENIED;
    // containment cycle: dest must not sit inside `what`
    let cur: string | null = dest;
    let hops = 0;
    while (cur) {
      if (cur === what) return DENIED;
      if (++hops > 128) return DENIED;
      cur = this.snap.objects.get(cur)?.locationId ?? null;
    }
    const from = w.locationId;
    this.snap.objects.set(what, { ...w, locationId: dest });
    this.mutations.push({ op: "move", target: what, detail: `${from ?? "nowhere"}->${dest}` });
    return true;
  }
}

export function createWorldModel(snap: WorldSnapshot): WorldModel {
  return new WorldModel(snap);
}
