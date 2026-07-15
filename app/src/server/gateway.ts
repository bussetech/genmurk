// The world gateway — the connection/command layer's seam onto the world
// model. The coordinator (ordering, fan-out) is deliberately world-blind;
// everything that must consult the world of record — who a token binds to
// (AUTH STUB until prompt 08), where a player is, what a typed name resolves
// to (GM-R12), whether a move or build is allowed (GM-R7/R8/R15) — goes
// through this interface. Two implementations: the in-memory FixtureGateway
// below (stack-free dispatch tests) and SupabaseGateway (supabase-gateway.ts),
// which drives the real audited world_* RPCs AS THE ACTOR so RLS + role
// checks stay the final wall.
//
// GENMURK-EPIC1-06 adds the building/movement verb surface (GM-R6/R7) and
// name matching (GM-R12) here. The fixture is built on the SAME world-model
// primitives the real path uses — WorldSnapshot + resolveName (GM-R12) +
// evalLock via WorldModel (GM-R8) — so name resolution and lock evaluation
// have ONE source of truth; only the mutation ops (dig/open/create/rename)
// are re-expressed in-memory, and the real RPCs remain the semantic authority
// the acceptance scenario proves against.

import type { Power, WorldSnapshot, SnapObject, SnapAttr, LockType } from "../world/types.ts";
import { powerRank, publicId } from "../world/types.ts";
import { resolveName, type Resolution } from "../world/resolve.ts";
import { createWorldModel, type WorldModel } from "../world/world-api.ts";
import type { RunOutcome } from "../engine/types.ts";
import { matchDollarCommand, collectTriggers, type SoftcodeRun, type TriggerKind } from "./softcode.ts";
import type { LockKind } from "./verbs.ts";

export interface GatewayPlayer {
  /** public `#dbref` id */
  playerId: string;
  playerName: string;
  power: Power;
  roomId: string;
  roomName: string;
}

export type MoveResult =
  | { ok: true; roomId: string; roomName: string }
  | { ok: false; code: "NO_SUCH_EXIT" | "MOVE_REFUSED" | "LOCKED"; reason: string };

export type BuildErrorCode =
  | "NO_SUCH_TARGET"
  | "AMBIGUOUS_TARGET"
  | "NO_SUCH_ROOM"
  | "PERMISSION_DENIED"
  | "BUILD_FAILED";

/** Result of a creating verb (dig/open/create): the new object's id + name. */
export type BuildResult =
  | { ok: true; id: string; name: string }
  | { ok: false; code: BuildErrorCode; reason: string };

/** Result of a mutating verb over an existing target (set/lock/name/describe). */
export type ActResult =
  | { ok: true; targetId: string; targetName: string }
  | { ok: false; code: BuildErrorCode; reason: string };

/** What `look` sees, from the world of record (occupancy — who is *connected*
 *  — is the coordinator's; dispatch merges the two). */
export interface LookResult {
  roomId: string;
  roomName: string;
  description: string;
  exits: string[];
  contents: string[];
}

/** A prepared softcode evaluation batch (GENMURK-EPIC1-07): the runs the
 *  world found for a typed line or an event, plus the snapshot-backed
 *  WorldAPI they execute against. The DISPATCHER runs them through the
 *  sandboxed engine (the one metered branch) — the gateway only prepares. */
export interface SoftcodeBatch {
  /** the engine's capability handle for this batch, over one snapshot */
  world: WorldModel;
  /** runs in scheduler-submission order (outcomes return parallel to this) */
  runs: SoftcodeRun[];
  /** display name for an emitting object id (snapshot names) */
  nameOf(id: string): string;
  /**
   * Apply run i's journaled mutations to the world of record. On the real
   * stack a run's mutations apply through ITS OWNER's JWT-scoped client (RLS
   * + RPC checks stay the final wall), so an owner without a bound session
   * has that run's mutations skipped — counted, never silent (the offline-
   * owner execution principal is prompt 08's, on the auth/capability track).
   * The fixture world mutates its snapshot in place, so this only reports.
   */
  apply(outcomes: RunOutcome[]): Promise<{ applied: number; skippedUnbound: number }>;
}

export interface WorldGateway {
  /**
   * AUTH STUB (GENMURK-EPIC1-05) — session-to-player binding by placeholder
   * token, `stub:<PlayerName>`. This is NOT authentication: no credential is
   * verified at this layer. Prompt 08 (GM-R15/GM-R18: modern KDF, no default
   * credentials) replaces the token scheme; the interface stays.
   */
  authenticate(token: string): Promise<GatewayPlayer | null>;

  /** GM-R12 name matching exposed at the command layer: resolve a typed token
   *  (`me`/`here`/`#dbref`/partial) to an object the actor may see. Dispatch
   *  and tests use it directly; the building verbs call it internally. */
  resolve(playerId: string, token: string): Promise<Resolution & { name?: string }>;

  // --- movement (GM-R6) — the world of record decides; transport relays ---
  /** Traverse a named exit in the current room. Exit-lock gated (GM-R8). */
  move(playerId: string, exitName: string): Promise<MoveResult>;
  /** Enter a co-located enterable thing (containment move, enter-lock gated). */
  enter(playerId: string, targetToken: string): Promise<MoveResult>;
  /** Leave the current container back to its own location. */
  leave(playerId: string): Promise<MoveResult>;
  /** Observe the current room (GM-R6). */
  look(playerId: string): Promise<LookResult | null>;

  // --- building (GM-R7) + locks (GM-R8) ---
  dig(playerId: string, roomName: string): Promise<BuildResult>;
  open(playerId: string, exitName: string, destToken: string): Promise<BuildResult>;
  create(playerId: string, thingName: string): Promise<BuildResult>;
  setAttr(playerId: string, targetToken: string, attr: string, value: string): Promise<ActResult>;
  setLock(playerId: string, targetToken: string, lock: LockKind, expr: string): Promise<ActResult>;
  rename(playerId: string, targetToken: string, newName: string): Promise<ActResult>;

  // --- softcode meets the world (GM-R11/R12, GENMURK-EPIC1-07) ---
  /** Scan the player's neighborhood for a `$`-command matching the typed
   *  line (built-ins have already declined it — precedence is theirs).
   *  Null = no match; the dispatcher then reports UNKNOWN_COMMAND. */
  softcodeCommand(playerId: string, line: string): Promise<SoftcodeBatch | null>;
  /** Collect the event-trigger runs for a world event the player caused
   *  (arrive into a room / use of an entered thing). Null = no listeners. */
  softcodeTriggers(
    playerId: string,
    event: { kind: TriggerKind; targetId: string },
  ): Promise<SoftcodeBatch | null>;

  close(): Promise<void>;
}

// --------------------------------------------------------------- fixture

export interface FixtureSpec {
  rooms: Record<string, { name: string; attrs?: Record<string, string> }>;
  /** exit name -> from room id -> to room id */
  exits: { name: string; from: string; to: string }[];
  players: Record<string, { power?: Power; room: string }>;
  /** seeded things (softcode-world tests): owned by a named player, placed
   *  in a room (or the owner's inventory when `room` is omitted). This is
   *  TEST SEEDING, not a command surface — moving things between rooms at
   *  the command layer is the get/drop verb class, capture-gated. */
  things?: {
    name: string;
    owner: string;
    room?: string;
    attrs?: Record<string, string>;
  }[];
}

/**
 * In-memory gateway for stack-free dispatch tests. Its world is a mutable
 * WorldSnapshot so it reuses the REAL name-matcher (resolveName, GM-R12) and
 * the REAL lock evaluator (via WorldModel, GM-R8); the creating verbs mirror
 * the RPC semantics (builder power, ownership). It is a test double, not a
 * second world of record — the real RPCs are the authority the acceptance
 * scenario proves against.
 */
export class FixtureGateway implements WorldGateway {
  private readonly snap: WorldSnapshot = { objects: new Map(), attrs: new Map(), locks: new Map() };
  private readonly nameToId = new Map<string, string>();
  private nextDbref = 100;

  constructor(spec: FixtureSpec) {
    for (const [key, r] of Object.entries(spec.rooms)) {
      const id = key; // spec uses #dbref-style keys (e.g. "#10")
      this.put({
        id,
        dbref: Number(id.slice(1)),
        type: "room",
        name: r.name,
        ownerId: "#1",
        locationId: null,
        destinationId: null,
        parentId: null,
        power: "player",
      });
      if (r.attrs) {
        const bag = new Map<string, SnapAttr>();
        for (const [k, v] of Object.entries(r.attrs)) {
          bag.set(k.toUpperCase(), { value: v, visual: false, noInherit: false });
        }
        this.snap.attrs.set(id, bag);
      }
      this.nextDbref = Math.max(this.nextDbref, Number(id.slice(1)) + 1);
    }
    for (const e of spec.exits) {
      const id = this.mint();
      this.put({
        id,
        dbref: Number(id.slice(1)),
        type: "exit",
        name: e.name,
        ownerId: "#1",
        locationId: e.from,
        destinationId: e.to,
        parentId: null,
        power: "player",
      });
    }
    for (const [name, p] of Object.entries(spec.players)) {
      const id = this.mint();
      this.nameToId.set(name.toLowerCase(), id);
      this.put({
        id,
        dbref: Number(id.slice(1)),
        type: "player",
        name,
        ownerId: id,
        locationId: p.room,
        destinationId: null,
        parentId: null,
        power: p.power ?? "player",
      });
    }
    for (const t of spec.things ?? []) {
      const ownerId = this.nameToId.get(t.owner.toLowerCase());
      if (!ownerId) throw new Error(`fixture thing "${t.name}": unknown owner ${t.owner}`);
      const id = this.mint();
      this.put({
        id,
        dbref: Number(id.slice(1)),
        type: "thing",
        name: t.name,
        ownerId,
        locationId: t.room ?? ownerId,
        destinationId: null,
        parentId: null,
        power: "player",
      });
      if (t.attrs) {
        const bag = new Map<string, SnapAttr>();
        for (const [k, v] of Object.entries(t.attrs)) {
          bag.set(k.toUpperCase(), { value: v, visual: false, noInherit: false });
        }
        this.snap.attrs.set(id, bag);
      }
    }
  }

  // ---- store helpers -----------------------------------------------------

  private put(o: SnapObject): void {
    this.snap.objects.set(o.id, o);
  }
  private mint(): string {
    return publicId(this.nextDbref++);
  }
  private world() {
    return createWorldModel(this.snap);
  }
  private resolveToken(actorId: string, token: string): Resolution {
    return this.world().resolveName(actorId, token);
  }
  private controls(actorId: string, targetId: string): boolean {
    const a = this.snap.objects.get(actorId);
    const t = this.snap.objects.get(targetId);
    if (!a || !t) return false;
    if (powerRank(a.power) >= 3) return true;
    return t.ownerId === actorId;
  }
  private roomView(roomId: string): { id: string; name: string } | null {
    const r = this.snap.objects.get(roomId);
    return r ? { id: r.id, name: r.name } : null;
  }

  // ---- WorldGateway ------------------------------------------------------

  async authenticate(token: string): Promise<GatewayPlayer | null> {
    if (!token.startsWith("stub:")) return null;
    const name = token.slice("stub:".length);
    const id = this.nameToId.get(name.toLowerCase());
    if (!id) return null;
    const p = this.snap.objects.get(id)!;
    const room = p.locationId ? this.roomView(p.locationId) : null;
    if (!room) return null;
    return { playerId: id, playerName: p.name, power: p.power, roomId: room.id, roomName: room.name };
  }

  async resolve(playerId: string, token: string): Promise<Resolution & { name?: string }> {
    const r = this.resolveToken(playerId, token);
    if (r.status === "ok") return { ...r, name: this.snap.objects.get(r.id)?.name };
    return r;
  }

  async move(playerId: string, exitName: string): Promise<MoveResult> {
    const me = this.snap.objects.get(playerId);
    if (!me || !me.locationId) return { ok: false, code: "MOVE_REFUSED", reason: "no location" };
    const exit = [...this.snap.objects.values()].find(
      (o) =>
        o.type === "exit" &&
        o.locationId === me.locationId &&
        o.name.toLowerCase().startsWith(exitName.toLowerCase()),
    );
    if (!exit || !exit.destinationId) {
      return { ok: false, code: "NO_SUCH_EXIT", reason: `no exit "${exitName}" here` };
    }
    // GM-R8: the exit's `use` lock gates traversal.
    if (!this.world().canUse(playerId, exit.id)) {
      return { ok: false, code: "LOCKED", reason: `the ${exit.name} exit is locked` };
    }
    this.put({ ...me, locationId: exit.destinationId });
    const room = this.roomView(exit.destinationId)!;
    return { ok: true, roomId: room.id, roomName: room.name };
  }

  async enter(playerId: string, targetToken: string): Promise<MoveResult> {
    const r = this.resolveToken(playerId, targetToken);
    if (r.status === "none") return { ok: false, code: "NO_SUCH_EXIT", reason: "no such thing" };
    if (r.status === "ambiguous") return { ok: false, code: "MOVE_REFUSED", reason: "which one?" };
    const target = this.snap.objects.get(r.id)!;
    if (target.type !== "thing" && target.type !== "room") {
      return { ok: false, code: "MOVE_REFUSED", reason: `you can't enter ${target.name}` };
    }
    if (!this.world().canEnter(playerId, target.id)) {
      return { ok: false, code: "LOCKED", reason: `${target.name} is locked` };
    }
    const me = this.snap.objects.get(playerId)!;
    this.put({ ...me, locationId: target.id });
    return { ok: true, roomId: target.id, roomName: target.name };
  }

  async leave(playerId: string): Promise<MoveResult> {
    const me = this.snap.objects.get(playerId);
    if (!me || !me.locationId) return { ok: false, code: "MOVE_REFUSED", reason: "nowhere to go" };
    const container = this.snap.objects.get(me.locationId);
    const dest = container?.locationId ?? null;
    if (!dest) return { ok: false, code: "MOVE_REFUSED", reason: "you are not inside anything" };
    this.put({ ...me, locationId: dest });
    const room = this.roomView(dest)!;
    return { ok: true, roomId: room.id, roomName: room.name };
  }

  async look(playerId: string): Promise<LookResult | null> {
    const me = this.snap.objects.get(playerId);
    if (!me || !me.locationId) return null;
    const room = this.snap.objects.get(me.locationId);
    if (!room) return null;
    const exits: string[] = [];
    const contents: string[] = [];
    for (const o of this.snap.objects.values()) {
      if (o.locationId !== room.id || o.id === playerId) continue;
      if (o.type === "exit") exits.push(o.name);
      else contents.push(o.name);
    }
    const desc = this.snap.attrs.get(room.id)?.get("DESCRIBE")?.value ?? "";
    return { roomId: room.id, roomName: room.name, description: desc, exits: exits.sort(), contents: contents.sort() };
  }

  async dig(playerId: string, roomName: string): Promise<BuildResult> {
    const guard = this.buildGuard(playerId);
    if (guard) return guard;
    const id = this.mint();
    this.put({
      id, dbref: Number(id.slice(1)), type: "room", name: roomName, ownerId: playerId,
      locationId: null, destinationId: null, parentId: null, power: "player",
    });
    return { ok: true, id, name: roomName };
  }

  async open(playerId: string, exitName: string, destToken: string): Promise<BuildResult> {
    const guard = this.buildGuard(playerId);
    if (guard) return guard;
    const me = this.snap.objects.get(playerId)!;
    if (!me.locationId) return { ok: false, code: "BUILD_FAILED", reason: "you are nowhere" };
    if (!this.controls(playerId, me.locationId)) {
      return { ok: false, code: "PERMISSION_DENIED", reason: "you don't control this room" };
    }
    const dest = this.resolveToken(playerId, destToken);
    if (dest.status !== "ok" || this.snap.objects.get(dest.id)?.type !== "room") {
      return { ok: false, code: "NO_SUCH_ROOM", reason: `no room "${destToken}"` };
    }
    const id = this.mint();
    this.put({
      id, dbref: Number(id.slice(1)), type: "exit", name: exitName, ownerId: playerId,
      locationId: me.locationId, destinationId: dest.id, parentId: null, power: "player",
    });
    return { ok: true, id, name: exitName };
  }

  async create(playerId: string, thingName: string): Promise<BuildResult> {
    const guard = this.buildGuard(playerId);
    if (guard) return guard;
    const id = this.mint();
    this.put({
      id, dbref: Number(id.slice(1)), type: "thing", name: thingName, ownerId: playerId,
      locationId: playerId, destinationId: null, parentId: null, power: "player",
    });
    return { ok: true, id, name: thingName };
  }

  async setAttr(playerId: string, targetToken: string, attr: string, value: string): Promise<ActResult> {
    return this.withTarget(playerId, targetToken, (t) => {
      let bag = this.snap.attrs.get(t.id);
      if (!bag) {
        bag = new Map<string, SnapAttr>();
        this.snap.attrs.set(t.id, bag);
      }
      bag.set(attr.toUpperCase(), { value, visual: false, noInherit: false });
    });
  }

  async setLock(playerId: string, targetToken: string, lock: LockKind, expr: string): Promise<ActResult> {
    return this.withTarget(playerId, targetToken, (t) => {
      let bag = this.snap.locks.get(t.id);
      if (!bag) {
        bag = new Map<LockType, string>();
        this.snap.locks.set(t.id, bag);
      }
      bag.set(lock, expr);
    });
  }

  async rename(playerId: string, targetToken: string, newName: string): Promise<ActResult> {
    return this.withTarget(playerId, targetToken, (t) => {
      this.put({ ...t, name: newName });
    });
  }

  // ---- softcode meets the world (GENMURK-EPIC1-07) ------------------------

  /** Wrap runs over the fixture's LIVE snapshot: WorldModel writes land in
   *  this.snap directly, so `apply` only reports (nothing to re-apply). */
  private batch(runs: SoftcodeRun[]): SoftcodeBatch | null {
    if (runs.length === 0) return null;
    return {
      world: this.world(),
      runs,
      nameOf: (id) => this.snap.objects.get(id)?.name ?? id,
      apply: async (outcomes) => ({
        applied: outcomes.filter((o) => o.status === "completed" && o.mutations.length > 0).length,
        skippedUnbound: 0,
      }),
    };
  }

  async softcodeCommand(playerId: string, line: string): Promise<SoftcodeBatch | null> {
    const match = matchDollarCommand(this.snap, playerId, line);
    return this.batch(match ? [match] : []);
  }

  async softcodeTriggers(
    playerId: string,
    event: { kind: TriggerKind; targetId: string },
  ): Promise<SoftcodeBatch | null> {
    const me = this.snap.objects.get(playerId);
    if (!me) return null;
    const runs = collectTriggers(this.snap, event.kind, event.targetId, {
      id: playerId,
      name: me.name,
    });
    return this.batch(runs);
  }

  async close(): Promise<void> {}

  // ---- shared guards -----------------------------------------------------

  private buildGuard(playerId: string): BuildResult | null {
    const me = this.snap.objects.get(playerId);
    if (!me) return { ok: false, code: "PERMISSION_DENIED", reason: "no such player" };
    if (powerRank(me.power) < powerRank("builder")) {
      return { ok: false, code: "PERMISSION_DENIED", reason: "building requires the builder power" };
    }
    return null;
  }

  private withTarget(playerId: string, targetToken: string, mutate: (t: SnapObject) => void): ActResult {
    const r = this.resolveToken(playerId, targetToken);
    if (r.status === "none") {
      return { ok: false, code: "NO_SUCH_TARGET", reason: `no "${targetToken}" here` };
    }
    if (r.status === "ambiguous") {
      return { ok: false, code: "AMBIGUOUS_TARGET", reason: `"${targetToken}" is ambiguous` };
    }
    const t = this.snap.objects.get(r.id)!;
    if (!this.controls(playerId, t.id)) {
      return { ok: false, code: "PERMISSION_DENIED", reason: `you don't control ${t.name}` };
    }
    mutate(t);
    const after = this.snap.objects.get(r.id)!;
    return { ok: true, targetId: r.id, targetName: after.name };
  }
}
