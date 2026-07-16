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
  /** GM-R16 moderation: ISO instant this player is silenced until, or null.
   *  The coordinator reads it to gate speech at connect (and on re-silence). */
  silencedUntil: string | null;
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

/** Error codes the faithful layer (GENMURK-EPIC1-09) surfaces beyond the build
 *  codes: containment (get/drop → LOCKED), destruction (GM-R9), mail (GM-R17),
 *  moderation (GM-R16). A superset of BuildErrorCode. */
export type FaithfulErrorCode =
  | BuildErrorCode
  | "LOCKED"
  | "NO_SUCH_PLAYER"
  | "MAILBOX_FULL"
  | "NO_SUCH_MAIL"
  | "SILENCED"
  | "MODERATION_REFUSED";

/** Result of a creating verb (dig/open/create): the new object's id + name. */
export type BuildResult =
  | { ok: true; id: string; name: string }
  | { ok: false; code: BuildErrorCode; reason: string };

/** Result of a mutating verb over an existing target (set/lock/name/describe),
 *  and the containment verbs (get/drop, which can additionally be LOCKED). */
export type ActResult =
  | { ok: true; targetId: string; targetName: string }
  | { ok: false; code: FaithfulErrorCode; reason: string };

/** Result of destroying an object (GM-R9): success carries the dbref to
 *  `undestroy` with and the recovery window so the UX is honest to the user. */
export type DestroyResult =
  | { ok: true; targetId: string; targetName: string; recoverySeconds: number }
  | { ok: false; code: FaithfulErrorCode; reason: string };

/** Result of sending mail (GM-R17). */
export type MailSendResult =
  | { ok: true; recipientName: string }
  | { ok: false; code: FaithfulErrorCode; reason: string };

/** One inbox line (GM-R17), newest first; `index` is the 1-based handle the
 *  player uses with `mail read`/`mail delete`. */
export interface MailSummary {
  index: number;
  id: number;
  fromName: string;
  subject: string;
  sentAt: string;
  unread: boolean;
}

export type MailReadResult =
  | { ok: true; fromName: string; subject: string; body: string; sentAt: string }
  | { ok: false; code: FaithfulErrorCode; reason: string };

export type MailDeleteResult =
  | { ok: true }
  | { ok: false; code: FaithfulErrorCode; reason: string };

/** Result of a moderation act (GM-R16): success carries the affected player so
 *  the transport plane can act (deliver a warning, disconnect a booted
 *  player, update a silenced session). */
export type ModerationResult =
  | { ok: true; targetPlayerId: string; targetName: string }
  | { ok: false; code: FaithfulErrorCode; reason: string };

/** Silence adds the window's end so the coordinator can gate speech and the
 *  UX can report the expiry honestly (GM-R16). */
export type SilenceResult =
  | { ok: true; targetPlayerId: string; targetName: string; until: string }
  | { ok: false; code: FaithfulErrorCode; reason: string };

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

/** A self-service registration request (GM-R18 open-signup posture). The
 *  passphrase is present only when the instance is in `passphrase` mode. */
export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  passphrase?: string;
}

export type RegisterResult =
  | { ok: true; playerId: string; playerName: string }
  | { ok: false; code: "REGISTRATION_REFUSED" | "REGISTRATION_FAILED"; reason: string };

export interface WorldGateway {
  /**
   * Bind a session to a player from its HELLO token (GM-R18). On the real
   * stack (supabase-gateway.ts) the token is a VERIFIED Supabase Auth JWT and
   * this IS authentication; the un-credentialed 05 stub is gone. The in-memory
   * FixtureGateway below issues opaque test-principal tokens (`tokenFor`) for
   * the stack-free transport/dispatch tests — it has no credentials to verify
   * and never claims to; the real auth path is proven by the live-stack gates
   * (isolation / first-boot / escalation). A bad/unknown token yields null.
   */
  authenticate(token: string): Promise<GatewayPlayer | null>;

  /** Self-service registration (GM-R18 open-signup posture), when the backing
   *  store supports it. The real stack mints an auth account + a base-tier
   *  player, gated by the instance registration policy; the stack-free fixture
   *  has no such store and does not implement it (server reports UNSUPPORTED). */
  register?(req: RegisterRequest): Promise<RegisterResult>;

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

  // --- containment: take a thing / drop it (GM-R6 + pickup lock GM-R8) ---
  /** Take a co-located thing into inventory, gated by its pickup lock (GM-R8). */
  get(playerId: string, targetToken: string): Promise<ActResult>;
  /** Drop a held thing into the current room. */
  drop(playerId: string, targetToken: string): Promise<ActResult>;

  // --- recoverable destruction (GM-R9) ---
  /** Soft-destroy a controlled object; returns its dbref + the recovery window. */
  destroy(playerId: string, targetToken: string): Promise<DestroyResult>;
  /** Recover a soft-destroyed object by its `#dbref` (destroyed objects are not
   *  name-resolvable — they have left the actor's snapshot), within the window. */
  recover(playerId: string, dbrefToken: string): Promise<ActResult>;

  // --- in-world mail (GM-R17) ---
  mailSend(playerId: string, recipientToken: string, subject: string, body: string): Promise<MailSendResult>;
  mailInbox(playerId: string): Promise<MailSummary[]>;
  mailRead(playerId: string, index: number): Promise<MailReadResult>;
  mailDelete(playerId: string, index: number): Promise<MailDeleteResult>;

  // --- moderation (GM-R16), wizard+ — the audit trail is written server-side ---
  warn(playerId: string, targetToken: string, reason: string): Promise<ModerationResult>;
  boot(playerId: string, targetToken: string, reason: string): Promise<ModerationResult>;
  silence(playerId: string, targetToken: string, minutes: number | null): Promise<SilenceResult>;
  unsilence(playerId: string, targetToken: string): Promise<ModerationResult>;

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

/** Prefix for FixtureGateway test-principal tokens — a labelled, non-secret
 *  handle for stack-free transport tests, never a credential. */
export const FIXTURE_PRINCIPAL_PREFIX = "fixture-principal:";

/** The wire token a stack-free test presents for `name` (mirrors
 *  FixtureGateway.tokenFor, for callers that only hold the player name). */
export function fixturePrincipalToken(name: string): string {
  return `${FIXTURE_PRINCIPAL_PREFIX}${name}`;
}

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
interface FixtureMail {
  id: number;
  senderId: string;
  recipientId: string;
  subject: string;
  body: string;
  sentAt: string;
  readAt: string | null;
  deleted: boolean;
}

const FIXTURE_RECOVERY_SECONDS = 604800; // 7 days — mirrors app_settings default
const FIXTURE_MAIL_INBOX_MAX = 100;
const FIXTURE_SILENCE_DEFAULT_MINUTES = 60;

export class FixtureGateway implements WorldGateway {
  private readonly snap: WorldSnapshot = { objects: new Map(), attrs: new Map(), locks: new Map() };
  private readonly nameToId = new Map<string, string>();
  private nextDbref = 100;
  // the faithful layer's in-memory state (GENMURK-EPIC1-09): the soft-destroy
  // bin (GM-R9), the mailbag (GM-R17), and per-player silence (GM-R16).
  private readonly bin = new Map<string, SnapObject>();
  private readonly mailbag: FixtureMail[] = [];
  private nextMailId = 1;
  private readonly silencedUntil = new Map<string, string>();

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

  /** The test-principal token for a fixture player — the handle the stack-free
   *  transport tests present at HELLO. Not a credential (there is no world of
   *  record here to hold one), and deliberately NOT the retired `stub:` scheme;
   *  the real auth path is proven only on the live stack. */
  tokenFor(name: string): string {
    return fixturePrincipalToken(name);
  }

  async authenticate(token: string): Promise<GatewayPlayer | null> {
    if (!token.startsWith(FIXTURE_PRINCIPAL_PREFIX)) return null;
    const name = token.slice(FIXTURE_PRINCIPAL_PREFIX.length);
    const id = this.nameToId.get(name.toLowerCase());
    if (!id) return null;
    const p = this.snap.objects.get(id)!;
    const room = p.locationId ? this.roomView(p.locationId) : null;
    if (!room) return null;
    return {
      playerId: id,
      playerName: p.name,
      power: p.power,
      roomId: room.id,
      roomName: room.name,
      silencedUntil: this.silencedUntil.get(id) ?? null,
    };
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

  // ---- containment: take / drop (GM-R6 + pickup lock GM-R8) ----------------

  async get(playerId: string, targetToken: string): Promise<ActResult> {
    const me = this.snap.objects.get(playerId);
    if (!me) return { ok: false, code: "PERMISSION_DENIED", reason: "no such player" };
    const r = this.resolveToken(playerId, targetToken);
    if (r.status === "none") return { ok: false, code: "NO_SUCH_TARGET", reason: `no "${targetToken}" here` };
    if (r.status === "ambiguous") return { ok: false, code: "AMBIGUOUS_TARGET", reason: `"${targetToken}" is ambiguous` };
    const t = this.snap.objects.get(r.id)!;
    if (t.type !== "thing") return { ok: false, code: "NO_SUCH_TARGET", reason: `you can't take ${t.name}` };
    if (t.locationId !== me.locationId) return { ok: false, code: "NO_SUCH_TARGET", reason: `${t.name} is not here` };
    // GM-R8: the thing's pickup lock gates taking it (default open, as in the reference).
    if (!this.world().canPickup(playerId, t.id)) {
      return { ok: false, code: "LOCKED", reason: `you can't pick up ${t.name}` };
    }
    this.put({ ...t, locationId: playerId });
    return { ok: true, targetId: t.id, targetName: t.name };
  }

  async drop(playerId: string, targetToken: string): Promise<ActResult> {
    const me = this.snap.objects.get(playerId);
    if (!me || !me.locationId) return { ok: false, code: "PERMISSION_DENIED", reason: "you are nowhere" };
    const r = this.resolveToken(playerId, targetToken);
    if (r.status === "none") return { ok: false, code: "NO_SUCH_TARGET", reason: `you aren't holding "${targetToken}"` };
    if (r.status === "ambiguous") return { ok: false, code: "AMBIGUOUS_TARGET", reason: `"${targetToken}" is ambiguous` };
    const t = this.snap.objects.get(r.id)!;
    if (t.type !== "thing" || t.locationId !== playerId) {
      return { ok: false, code: "NO_SUCH_TARGET", reason: `you aren't holding ${t.name}` };
    }
    this.put({ ...t, locationId: me.locationId });
    return { ok: true, targetId: t.id, targetName: t.name };
  }

  // ---- recoverable destruction (GM-R9) ------------------------------------

  async destroy(playerId: string, targetToken: string): Promise<DestroyResult> {
    const r = this.resolveToken(playerId, targetToken);
    if (r.status === "none") return { ok: false, code: "NO_SUCH_TARGET", reason: `no "${targetToken}" here` };
    if (r.status === "ambiguous") return { ok: false, code: "AMBIGUOUS_TARGET", reason: `"${targetToken}" is ambiguous` };
    const t = this.snap.objects.get(r.id)!;
    if (!this.controls(playerId, t.id)) {
      return { ok: false, code: "PERMISSION_DENIED", reason: `you don't control ${t.name}` };
    }
    if (t.dbref === 0 || t.dbref === 1) {
      return { ok: false, code: "PERMISSION_DENIED", reason: "the root room and god are indestructible" };
    }
    if ([...this.snap.objects.values()].some((o) => o.locationId === t.id)) {
      return { ok: false, code: "BUILD_FAILED", reason: "object is not empty (move its contents first)" };
    }
    this.snap.objects.delete(t.id);
    this.bin.set(t.id, t);
    return { ok: true, targetId: t.id, targetName: t.name, recoverySeconds: FIXTURE_RECOVERY_SECONDS };
  }

  async recover(playerId: string, dbrefToken: string): Promise<ActResult> {
    const id = dbrefToken.trim();
    if (!/^#\d+$/.test(id)) return { ok: false, code: "NO_SUCH_TARGET", reason: "recover takes a #dbref" };
    const t = this.bin.get(id);
    if (!t) return { ok: false, code: "NO_SUCH_TARGET", reason: `#${id.slice(1)} is not in the bin` };
    // the target is destroyed (out of the snapshot), so check control against
    // the binned object directly: its owner, or a wizard/god.
    const actor = this.snap.objects.get(playerId);
    if (!actor || (powerRank(actor.power) < 3 && t.ownerId !== playerId)) {
      return { ok: false, code: "PERMISSION_DENIED", reason: `you don't control ${t.name}` };
    }
    this.bin.delete(id);
    this.put(t);
    return { ok: true, targetId: t.id, targetName: t.name };
  }

  // ---- in-world mail (GM-R17) ---------------------------------------------

  private resolvePlayerGlobally(actorId: string, token: string): SnapObject | null {
    const t = token.trim();
    if (t.toLowerCase() === "me") return this.snap.objects.get(actorId) ?? null;
    if (/^#\d+$/.test(t)) {
      const o = this.snap.objects.get(t);
      return o && o.type === "player" ? o : null;
    }
    const players = [...this.snap.objects.values()].filter(
      (o) => o.type === "player" && o.name.toLowerCase() === t.toLowerCase(),
    );
    return players.length === 1 ? players[0]! : null;
  }

  private inboxFor(playerId: string): FixtureMail[] {
    return this.mailbag
      .filter((m) => m.recipientId === playerId && !m.deleted)
      .sort((a, b) => b.id - a.id);
  }

  async mailSend(playerId: string, recipientToken: string, subject: string, body: string): Promise<MailSendResult> {
    const me = this.snap.objects.get(playerId);
    if (!me) return { ok: false, code: "PERMISSION_DENIED", reason: "no such player" };
    if (this.isSilenced(playerId)) return { ok: false, code: "SILENCED", reason: "you are silenced and cannot send mail" };
    const to = this.resolvePlayerGlobally(playerId, recipientToken);
    if (!to) return { ok: false, code: "NO_SUCH_PLAYER", reason: `no player "${recipientToken}"` };
    if (body.trim() === "") return { ok: false, code: "BUILD_FAILED", reason: "a message may not be empty" };
    if (this.inboxFor(to.id).length >= FIXTURE_MAIL_INBOX_MAX) {
      return { ok: false, code: "MAILBOX_FULL", reason: "recipient mailbox is full" };
    }
    this.mailbag.push({
      id: this.nextMailId++,
      senderId: playerId,
      recipientId: to.id,
      subject: subject.slice(0, 128),
      body,
      sentAt: new Date().toISOString(),
      readAt: null,
      deleted: false,
    });
    return { ok: true, recipientName: to.name };
  }

  async mailInbox(playerId: string): Promise<MailSummary[]> {
    return this.inboxFor(playerId).map((m, i) => ({
      index: i + 1,
      id: m.id,
      fromName: this.snap.objects.get(m.senderId)?.name ?? m.senderId,
      subject: m.subject,
      sentAt: m.sentAt,
      unread: m.readAt === null,
    }));
  }

  async mailRead(playerId: string, index: number): Promise<MailReadResult> {
    const inbox = this.inboxFor(playerId);
    const m = inbox[index - 1];
    if (!m) return { ok: false, code: "NO_SUCH_MAIL", reason: `no message ${index} in your inbox` };
    m.readAt = m.readAt ?? new Date().toISOString();
    return {
      ok: true,
      fromName: this.snap.objects.get(m.senderId)?.name ?? m.senderId,
      subject: m.subject,
      body: m.body,
      sentAt: m.sentAt,
    };
  }

  async mailDelete(playerId: string, index: number): Promise<MailDeleteResult> {
    const inbox = this.inboxFor(playerId);
    const m = inbox[index - 1];
    if (!m) return { ok: false, code: "NO_SUCH_MAIL", reason: `no message ${index} in your inbox` };
    m.deleted = true;
    return { ok: true };
  }

  // ---- moderation (GM-R16) ------------------------------------------------

  private isSilenced(playerId: string): boolean {
    const until = this.silencedUntil.get(playerId);
    return until !== undefined && new Date(until).getTime() > Date.now();
  }

  private moderationTarget(
    actorId: string,
    token: string,
  ): SnapObject | { ok: false; code: FaithfulErrorCode; reason: string } {
    const actor = this.snap.objects.get(actorId);
    if (!actor || powerRank(actor.power) < 3) {
      return { ok: false, code: "PERMISSION_DENIED", reason: "moderation requires the wizard power" };
    }
    const t = this.resolvePlayerGlobally(actorId, token);
    if (!t) return { ok: false, code: "NO_SUCH_PLAYER", reason: `no player "${token}"` };
    if (t.dbref === 1) return { ok: false, code: "MODERATION_REFUSED", reason: "God #1 may not be moderated" };
    if (powerRank(actor.power) < 4 && powerRank(t.power) >= powerRank(actor.power)) {
      return { ok: false, code: "MODERATION_REFUSED", reason: "you may not moderate an equal or higher tier" };
    }
    return t;
  }

  async warn(playerId: string, targetToken: string, _reason: string): Promise<ModerationResult> {
    const t = this.moderationTarget(playerId, targetToken);
    if ("ok" in t) return t;
    return { ok: true, targetPlayerId: t.id, targetName: t.name };
  }

  async boot(playerId: string, targetToken: string, _reason: string): Promise<ModerationResult> {
    const t = this.moderationTarget(playerId, targetToken);
    if ("ok" in t) return t;
    return { ok: true, targetPlayerId: t.id, targetName: t.name };
  }

  async silence(playerId: string, targetToken: string, minutes: number | null): Promise<SilenceResult> {
    const t = this.moderationTarget(playerId, targetToken);
    if ("ok" in t) return t;
    const mins = minutes && minutes > 0 ? minutes : FIXTURE_SILENCE_DEFAULT_MINUTES;
    const until = new Date(Date.now() + mins * 60_000).toISOString();
    this.silencedUntil.set(t.id, until);
    return { ok: true, targetPlayerId: t.id, targetName: t.name, until };
  }

  async unsilence(playerId: string, targetToken: string): Promise<ModerationResult> {
    const t = this.moderationTarget(playerId, targetToken);
    if ("ok" in t) return t;
    this.silencedUntil.delete(t.id);
    return { ok: true, targetPlayerId: t.id, targetName: t.name };
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
