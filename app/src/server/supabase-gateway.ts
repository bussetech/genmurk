// The real-stack gateway: the connection/command layer over the
// GENMURK-EPIC1-04 world of record. Reads use the service role (the server
// plane); every MUTATION goes through the audited world_* RPCs AS THE ACTOR
// (a JWT-scoped client), so RLS + the RPC role checks stay the final wall —
// the same discipline as src/world/snapshot.ts applyMutations. Movement's RPC
// also writes arrive/depart rows to `world_events`, which stays the DURABLE
// presence record; the live fan-out order is the coordinator's (see
// app/docs/presence-transport.md for why the live path does not tail the
// table).
//
// GENMURK-EPIC1-06 — the building/movement verbs (GM-R6/R7) and name matching
// (GM-R12) resolve through a per-call SNAPSHOT of the actor's neighborhood
// (src/world/snapshot.ts + src/world/world-api.ts): the SAME loader + name
// matcher + lock evaluator the engine uses. A token → object id is
// resolveName (GM-R12); an exit's `use` lock is evaluated in-snapshot before
// the move RPC (GM-R8); the RPC's own capability/structure checks remain the
// authority underneath. A fresh snapshot per command is the dev-tier simple
// choice (a just-dug room is visible to the next command); 08 may cache.
//
// AUTHENTICATION (GENMURK-EPIC1-08, GM-R18): the HELLO token is a VERIFIED
// Supabase Auth access-token JWT. The player authenticates out of band against
// Supabase Auth (the sanctioned argon2/bcrypt-class KDF, ADR-0048) and presents
// the resulting JWT; this gateway VERIFIES it (`auth.getUser`) and binds the
// session to the player object the auth principal is linked to (objects.
// auth_user_id, the RLS bridge). The server never handles a password, and the
// 05 stub — the un-credentialed `stub:<name>` name binding — is gone. A
// forged, expired, or unbound token yields no session (null), and the actor
// client is scoped by the SAME JWT so RLS + the RPC role checks stay the wall.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Power, WorldSnapshot } from "../world/types.ts";
import { publicId } from "../world/types.ts";
import { applyMutations, loadSnapshot } from "../world/snapshot.ts";
import { createWorldModel, type WorldModel } from "../world/world-api.ts";
import type { Resolution } from "../world/resolve.ts";
import { matchDollarCommand, collectTriggers, type SoftcodeRun, type TriggerKind } from "./softcode.ts";
import type {
  ActResult,
  BuildErrorCode,
  BuildResult,
  DestroyResult,
  ExamineOutcome,
  FaithfulErrorCode,
  GatewayPlayer,
  InventoryResult,
  LookResult,
  MailDeleteResult,
  MailReadResult,
  MailSendResult,
  MailSummary,
  ModerationResult,
  MoveResult,
  RegisterRequest,
  RegisterResult,
  SilenceResult,
  SoftcodeBatch,
  WorldGateway,
} from "./gateway.ts";
import { registerOpen, RegistrationRefused } from "./auth.ts";
import type { LockKind } from "./verbs.ts";

export interface SupabaseGatewayConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

interface BoundPlayer {
  uuid: string;
  dbref: number;
  actor: SupabaseClient;
}

interface Loaded {
  world: WorldModel;
  snapshot: WorldSnapshot;
  actorId: string; // #dbref
  refToUuid: Map<string, string>;
}

export class SupabaseGateway implements WorldGateway {
  private readonly cfg: SupabaseGatewayConfig;
  private readonly svc: SupabaseClient;
  /** playerId (`#dbref`) -> actor-scoped client + row uuid */
  private readonly bound = new Map<string, BoundPlayer>();

  constructor(cfg: SupabaseGatewayConfig) {
    this.cfg = cfg;
    this.svc = createClient(cfg.url, cfg.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async authenticate(token: string): Promise<GatewayPlayer | null> {
    // GM-R18: the token is a Supabase Auth access-token JWT. VERIFY it — a
    // forged/expired token has no user, an unbound auth account has no player.
    if (!token) return null;
    const { data: userData, error: userErr } = await this.svc.auth.getUser(token);
    if (userErr || !userData.user) return null;
    const authUserId = userData.user.id;

    // Resolve the player object this verified principal is linked to. The
    // actor client below carries the SAME JWT, so RLS is the wall on its reads
    // and its RPC writes — the service-role read here is only to shape the
    // welcome frame (name/room), never to act on the player's behalf.
    const { data: row, error: rowErr } = await this.svc
      .from("objects")
      .select("id, dbref, name, power, location_id, silenced_until")
      .eq("type", "player")
      .eq("auth_user_id", authUserId)
      .is("destroyed_at", null)
      .single();
    if (rowErr || !row || !row.location_id) return null;

    const actor = createClient(this.cfg.url, this.cfg.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const room = await this.roomOf(row.location_id);
    if (!room) return null;

    const playerId = publicId(row.dbref as number);
    this.bound.set(playerId, { uuid: row.id as string, dbref: row.dbref as number, actor });
    return {
      playerId,
      playerName: row.name as string,
      power: row.power as Power,
      roomId: room.id,
      roomName: room.name,
      silencedUntil: (row.silenced_until as string | null) ?? null,
    };
  }

  async register(req: RegisterRequest): Promise<RegisterResult> {
    try {
      const r = await registerOpen(this.cfg, {
        name: req.name,
        email: req.email,
        secret: req.password,
        ...(req.passphrase ? { passphrase: req.passphrase } : {}),
      });
      return { ok: true, playerId: publicId(r.dbref), playerName: req.name };
    } catch (err) {
      if (err instanceof RegistrationRefused) {
        return { ok: false, code: "REGISTRATION_REFUSED", reason: err.message };
      }
      return { ok: false, code: "REGISTRATION_FAILED", reason: err instanceof Error ? err.message : String(err) };
    }
  }

  // ---- snapshot + resolution --------------------------------------------

  private async loadFor(playerId: string): Promise<Loaded | null> {
    const b = this.bound.get(playerId);
    if (!b) return null;
    const { snapshot, refToUuid } = await loadSnapshot(this.svc, b.dbref);
    return { world: createWorldModel(snapshot), snapshot, actorId: playerId, refToUuid };
  }

  async resolve(playerId: string, token: string): Promise<Resolution & { name?: string }> {
    const l = await this.loadFor(playerId);
    if (!l) return { status: "none" };
    const r = l.world.resolveName(playerId, token);
    if (r.status !== "ok") return r;
    return { ...r, name: l.snapshot.objects.get(r.id)?.name };
  }

  /** Resolve a token to a snapshot object id (#dbref) + its row uuid. */
  private resolveWithUuid(
    l: Loaded,
    token: string,
  ): { id: string; uuid: string } | { fail: Extract<ActResult, { ok: false }> } {
    const r = l.world.resolveName(l.actorId, token);
    if (r.status === "none") {
      return { fail: { ok: false, code: "NO_SUCH_TARGET", reason: `no "${token}" here` } };
    }
    if (r.status === "ambiguous") {
      return { fail: { ok: false, code: "AMBIGUOUS_TARGET", reason: `"${token}" is ambiguous` } };
    }
    const uuid = l.refToUuid.get(r.id);
    if (!uuid) return { fail: { ok: false, code: "NO_SUCH_TARGET", reason: "unresolved id" } };
    return { id: r.id, uuid };
  }

  // ---- movement (GM-R6) --------------------------------------------------

  async move(playerId: string, exitName: string): Promise<MoveResult> {
    const b = this.bound.get(playerId);
    const l = await this.loadFor(playerId);
    if (!b || !l) return { ok: false, code: "MOVE_REFUSED", reason: "session not bound" };

    const me = l.snapshot.objects.get(playerId);
    const wanted = exitName.toLowerCase();
    const exit = me?.locationId
      ? [...l.snapshot.objects.values()].find(
          (o) =>
            o.type === "exit" &&
            o.locationId === me.locationId &&
            o.name.toLowerCase().startsWith(wanted),
        )
      : undefined;
    if (!exit || !exit.destinationId) {
      return { ok: false, code: "NO_SUCH_EXIT", reason: `no exit "${exitName}" here` };
    }
    // GM-R8: the exit's `use` lock gates traversal (evaluated in-snapshot,
    // reusing the engine's lock evaluator). The RPC's structure/capability
    // checks remain the authority underneath.
    if (!l.world.canUse(playerId, exit.id)) {
      return { ok: false, code: "LOCKED", reason: `the ${exit.name} exit is locked` };
    }
    const destUuid = l.refToUuid.get(exit.destinationId);
    if (!destUuid) return { ok: false, code: "MOVE_REFUSED", reason: "destination unresolved" };

    const { error } = await b.actor.rpc("world_move", { p_what: b.uuid, p_dest: destUuid });
    if (error) return { ok: false, code: "MOVE_REFUSED", reason: error.message };

    const room = await this.roomOf(destUuid);
    if (!room) return { ok: false, code: "MOVE_REFUSED", reason: "destination unreadable" };
    return { ok: true, roomId: room.id, roomName: room.name };
  }

  async enter(playerId: string, targetToken: string): Promise<MoveResult> {
    const b = this.bound.get(playerId);
    const l = await this.loadFor(playerId);
    if (!b || !l) return { ok: false, code: "MOVE_REFUSED", reason: "session not bound" };
    const found = this.resolveWithUuid(l, targetToken);
    if ("fail" in found) return { ok: false, code: "NO_SUCH_EXIT", reason: found.fail.reason };
    if (!l.world.canEnter(playerId, found.id)) {
      return { ok: false, code: "LOCKED", reason: `${targetToken} is locked` };
    }
    const { error } = await b.actor.rpc("world_move", { p_what: b.uuid, p_dest: found.uuid });
    if (error) return { ok: false, code: "MOVE_REFUSED", reason: error.message };
    const room = await this.roomOf(found.uuid);
    if (!room) return { ok: false, code: "MOVE_REFUSED", reason: "destination unreadable" };
    return { ok: true, roomId: room.id, roomName: room.name };
  }

  async leave(playerId: string): Promise<MoveResult> {
    const b = this.bound.get(playerId);
    if (!b) return { ok: false, code: "MOVE_REFUSED", reason: "session not bound" };
    const { data: me } = await this.svc.from("objects").select("location_id").eq("id", b.uuid).single();
    if (!me?.location_id) return { ok: false, code: "MOVE_REFUSED", reason: "nowhere to go" };
    const { data: container } = await this.svc
      .from("objects")
      .select("location_id")
      .eq("id", me.location_id)
      .single();
    if (!container?.location_id) {
      return { ok: false, code: "MOVE_REFUSED", reason: "you are not inside anything" };
    }
    const { error } = await b.actor.rpc("world_move", { p_what: b.uuid, p_dest: container.location_id });
    if (error) return { ok: false, code: "MOVE_REFUSED", reason: error.message };
    const room = await this.roomOf(container.location_id as string);
    if (!room) return { ok: false, code: "MOVE_REFUSED", reason: "destination unreadable" };
    return { ok: true, roomId: room.id, roomName: room.name };
  }

  async look(playerId: string): Promise<LookResult | null> {
    const l = await this.loadFor(playerId);
    if (!l) return null;
    const me = l.snapshot.objects.get(playerId);
    if (!me?.locationId) return null;
    const room = l.snapshot.objects.get(me.locationId);
    if (!room) return null;
    const exits: string[] = [];
    const contents: string[] = [];
    for (const o of l.snapshot.objects.values()) {
      if (o.locationId !== room.id || o.id === playerId) continue;
      if (o.type === "exit") exits.push(o.name);
      else contents.push(o.name);
    }
    const desc = l.snapshot.attrs.get(room.id)?.get("DESCRIBE")?.value ?? "";
    return { roomId: room.id, roomName: room.name, description: desc, exits: exits.sort(), contents: contents.sort() };
  }

  async examine(playerId: string, targetToken: string): Promise<ExamineOutcome> {
    const l = await this.loadFor(playerId);
    if (!l) return { ok: false, code: "NO_SUCH_TARGET", reason: "session not bound" };
    const r = l.world.resolveName(playerId, targetToken);
    if (r.status !== "ok") {
      return { ok: false, code: "NO_SUCH_TARGET", reason: `you don't see "${targetToken}" here` };
    }
    const t = l.snapshot.objects.get(r.id)!;
    const controlled = l.world.controlsTarget(playerId, t.id);
    const attrBag = l.snapshot.attrs.get(t.id);
    const description = attrBag?.get("DESCRIBE")?.value ?? "";
    // Same visibility authority as the fixture: controller sees all, others
    // only `visual`; DESCRIBE is the description line, not an attribute row.
    const attrs: { name: string; value: string }[] = [];
    if (attrBag) {
      for (const [name, a] of attrBag) {
        if (name === "DESCRIBE") continue;
        if (controlled || a.visual) attrs.push({ name, value: a.value });
      }
    }
    attrs.sort((x, y) => x.name.localeCompare(y.name));
    const locks: { kind: LockKind; expr: string }[] = [];
    if (controlled) {
      const lockBag = l.snapshot.locks.get(t.id);
      if (lockBag) for (const [kind, expr] of lockBag) locks.push({ kind, expr });
      locks.sort((x, y) => x.kind.localeCompare(y.kind));
    }
    const contents: string[] = [];
    for (const o of l.snapshot.objects.values()) {
      if (o.locationId === t.id && o.type !== "exit") contents.push(o.name);
    }
    const ownerName = l.snapshot.objects.get(t.ownerId)?.name ?? t.ownerId;
    return {
      ok: true, id: t.id, name: t.name, type: t.type, ownerName, description,
      controlled, attrs, locks, contents: contents.sort(),
    };
  }

  async inventory(playerId: string): Promise<InventoryResult> {
    const l = await this.loadFor(playerId);
    if (!l) return { things: [] };
    const things: { id: string; name: string }[] = [];
    for (const o of l.snapshot.objects.values()) {
      if (o.locationId === playerId && o.type !== "exit") things.push({ id: o.id, name: o.name });
    }
    things.sort((a, b) => a.name.localeCompare(b.name));
    return { things };
  }

  // ---- building (GM-R7) + locks (GM-R8) ---------------------------------

  async dig(playerId: string, roomName: string): Promise<BuildResult> {
    return this.creating(playerId, (actor) => actor.rpc("world_dig", { p_name: roomName }));
  }

  async create(playerId: string, thingName: string): Promise<BuildResult> {
    return this.creating(playerId, (actor) => actor.rpc("world_create", { p_name: thingName }));
  }

  async open(playerId: string, exitName: string, destToken: string): Promise<BuildResult> {
    const b = this.bound.get(playerId);
    const l = await this.loadFor(playerId);
    if (!b || !l) return { ok: false, code: "BUILD_FAILED", reason: "session not bound" };
    const me = l.snapshot.objects.get(playerId);
    if (!me?.locationId) return { ok: false, code: "BUILD_FAILED", reason: "you are nowhere" };
    const sourceUuid = l.refToUuid.get(me.locationId);
    if (!sourceUuid) return { ok: false, code: "BUILD_FAILED", reason: "room unresolved" };
    const dest = this.resolveWithUuid(l, destToken);
    if ("fail" in dest) return { ok: false, code: "NO_SUCH_ROOM", reason: `no room "${destToken}"` };
    if (l.snapshot.objects.get(dest.id)?.type !== "room") {
      return { ok: false, code: "NO_SUCH_ROOM", reason: `"${destToken}" is not a room` };
    }
    return this.creating(playerId, (actor) =>
      actor.rpc("world_open", { p_name: exitName, p_source: sourceUuid, p_dest: dest.uuid }),
    );
  }

  async setAttr(playerId: string, targetToken: string, attr: string, value: string): Promise<ActResult> {
    return this.mutating(playerId, targetToken, (actor, uuid) =>
      actor.rpc("world_set_attr", { p_target: uuid, p_name: attr, p_value: value }),
    );
  }

  async setLock(playerId: string, targetToken: string, lock: LockKind, expr: string): Promise<ActResult> {
    return this.mutating(playerId, targetToken, (actor, uuid) =>
      actor.rpc("world_set_lock", { p_target: uuid, p_type: lock, p_expr: expr }),
    );
  }

  async rename(playerId: string, targetToken: string, newName: string): Promise<ActResult> {
    return this.mutating(playerId, targetToken, (actor, uuid) =>
      actor.rpc("world_rename", { p_target: uuid, p_name: newName }),
    );
  }

  // ---- containment: take / drop (GM-R6 + pickup lock GM-R8) ---------------

  async get(playerId: string, targetToken: string): Promise<ActResult> {
    const b = this.bound.get(playerId);
    const l = await this.loadFor(playerId);
    if (!b || !l) return { ok: false, code: "BUILD_FAILED", reason: "session not bound" };
    const found = this.resolveWithUuid(l, targetToken);
    if ("fail" in found) return found.fail;
    const obj = l.snapshot.objects.get(found.id);
    const me = l.snapshot.objects.get(playerId);
    if (!obj || obj.type !== "thing") {
      return { ok: false, code: "NO_SUCH_TARGET", reason: `you can't take "${targetToken}"` };
    }
    if (obj.locationId !== me?.locationId) {
      return { ok: false, code: "NO_SUCH_TARGET", reason: `${obj.name} is not here to take` };
    }
    // GM-R8: the thing's pickup lock gates taking it (evaluated in-snapshot,
    // the engine's evaluator; the RPC holds the structural wall underneath).
    if (!l.world.canPickup(playerId, obj.id)) {
      return { ok: false, code: "LOCKED", reason: `you can't pick up ${obj.name}` };
    }
    const { error } = await b.actor.rpc("world_get", { p_thing: found.uuid });
    if (error) return { ok: false, code: classify(error.message), reason: error.message };
    return { ok: true, targetId: found.id, targetName: obj.name };
  }

  async drop(playerId: string, targetToken: string): Promise<ActResult> {
    const b = this.bound.get(playerId);
    const l = await this.loadFor(playerId);
    if (!b || !l) return { ok: false, code: "BUILD_FAILED", reason: "session not bound" };
    const found = this.resolveWithUuid(l, targetToken);
    if ("fail" in found) return found.fail;
    const obj = l.snapshot.objects.get(found.id);
    if (!obj || obj.type !== "thing" || obj.locationId !== playerId) {
      return { ok: false, code: "NO_SUCH_TARGET", reason: `you aren't holding "${targetToken}"` };
    }
    const { error } = await b.actor.rpc("world_drop", { p_thing: found.uuid });
    if (error) return { ok: false, code: classify(error.message), reason: error.message };
    return { ok: true, targetId: found.id, targetName: obj.name };
  }

  // ---- recoverable destruction (GM-R9) ------------------------------------

  async destroy(playerId: string, targetToken: string): Promise<DestroyResult> {
    const b = this.bound.get(playerId);
    const l = await this.loadFor(playerId);
    if (!b || !l) return { ok: false, code: "BUILD_FAILED", reason: "session not bound" };
    const found = this.resolveWithUuid(l, targetToken);
    if ("fail" in found) return found.fail;
    const name = l.snapshot.objects.get(found.id)?.name ?? found.id;
    const { error } = await b.actor.rpc("world_destroy", { p_target: found.uuid });
    if (error) return { ok: false, code: classifyFaithful(error.message), reason: error.message };
    return { ok: true, targetId: found.id, targetName: name, recoverySeconds: await this.recoveryWindowSeconds() };
  }

  async recover(playerId: string, dbrefToken: string): Promise<ActResult> {
    const b = this.bound.get(playerId);
    if (!b) return { ok: false, code: "BUILD_FAILED", reason: "session not bound" };
    const m = /^#(\d+)$/.exec(dbrefToken.trim());
    if (!m) return { ok: false, code: "NO_SUCH_TARGET", reason: "recover takes a #dbref" };
    // destroyed objects have left the snapshot; look the dbref up directly
    // (service read), then recover AS THE ACTOR so the RPC's control check is
    // the wall.
    const { data: row } = await this.svc
      .from("objects")
      .select("id, name")
      .eq("dbref", Number(m[1]))
      .single();
    if (!row) return { ok: false, code: "NO_SUCH_TARGET", reason: `no object #${m[1]}` };
    const { error } = await b.actor.rpc("world_recover", { p_target: row.id as string });
    if (error) return { ok: false, code: classify(error.message), reason: error.message };
    return { ok: true, targetId: dbrefToken.trim(), targetName: row.name as string };
  }

  // ---- in-world mail (GM-R17) ---------------------------------------------

  async mailSend(playerId: string, recipientToken: string, subject: string, body: string): Promise<MailSendResult> {
    const b = this.bound.get(playerId);
    if (!b) return { ok: false, code: "BUILD_FAILED", reason: "session not bound" };
    const to = await this.resolvePlayerUuid(playerId, recipientToken);
    if (!to) return { ok: false, code: "NO_SUCH_PLAYER", reason: `no player "${recipientToken}"` };
    const { error } = await b.actor.rpc("world_mail_send", { p_to: to.uuid, p_subject: subject, p_body: body });
    if (error) return { ok: false, code: classifyFaithful(error.message), reason: error.message };
    return { ok: true, recipientName: to.name };
  }

  async mailInbox(playerId: string): Promise<MailSummary[]> {
    const b = this.bound.get(playerId);
    if (!b) return [];
    const rows = await this.rawInbox(b.uuid);
    const senderIds = [...new Set(rows.map((m) => m.sender_id))];
    const nameOf = new Map<string, string>();
    if (senderIds.length) {
      const { data } = await this.svc.from("objects").select("id, name").in("id", senderIds);
      for (const s of data ?? []) nameOf.set(s.id as string, s.name as string);
    }
    return rows.map((m, i) => ({
      index: i + 1,
      id: m.id,
      fromName: nameOf.get(m.sender_id) ?? "?",
      subject: m.subject,
      sentAt: m.sent_at,
      unread: m.read_at === null,
    }));
  }

  async mailRead(playerId: string, index: number): Promise<MailReadResult> {
    const b = this.bound.get(playerId);
    if (!b) return { ok: false, code: "BUILD_FAILED", reason: "session not bound" };
    const rows = await this.rawInbox(b.uuid);
    const m = rows[index - 1];
    if (!m) return { ok: false, code: "NO_SUCH_MAIL", reason: `no message ${index} in your inbox` };
    await b.actor.rpc("world_mail_mark_read", { p_mail: m.id }); // mark read as the recipient
    const { data: sender } = await this.svc.from("objects").select("name").eq("id", m.sender_id).single();
    return {
      ok: true,
      fromName: (sender?.name as string) ?? "?",
      subject: m.subject,
      body: m.body,
      sentAt: m.sent_at,
    };
  }

  async mailDelete(playerId: string, index: number): Promise<MailDeleteResult> {
    const b = this.bound.get(playerId);
    if (!b) return { ok: false, code: "BUILD_FAILED", reason: "session not bound" };
    const rows = await this.rawInbox(b.uuid);
    const m = rows[index - 1];
    if (!m) return { ok: false, code: "NO_SUCH_MAIL", reason: `no message ${index} in your inbox` };
    const { error } = await b.actor.rpc("world_mail_delete", { p_mail: m.id });
    if (error) return { ok: false, code: classifyFaithful(error.message), reason: error.message };
    return { ok: true };
  }

  // ---- moderation (GM-R16) ------------------------------------------------

  async warn(playerId: string, targetToken: string, reason: string): Promise<ModerationResult> {
    return this.moderate(playerId, targetToken, (actor, t) =>
      actor.rpc("world_warn", { p_target: t.uuid, p_reason: reason }),
    );
  }

  async boot(playerId: string, targetToken: string, reason: string): Promise<ModerationResult> {
    return this.moderate(playerId, targetToken, (actor, t) =>
      actor.rpc("world_boot", { p_target: t.uuid, p_reason: reason }),
    );
  }

  async unsilence(playerId: string, targetToken: string): Promise<ModerationResult> {
    return this.moderate(playerId, targetToken, (actor, t) =>
      actor.rpc("world_unsilence", { p_target: t.uuid }),
    );
  }

  async silence(playerId: string, targetToken: string, minutes: number | null): Promise<SilenceResult> {
    const b = this.bound.get(playerId);
    if (!b) return { ok: false, code: "MODERATION_REFUSED", reason: "session not bound" };
    const t = await this.resolvePlayerUuid(playerId, targetToken);
    if (!t) return { ok: false, code: "NO_SUCH_PLAYER", reason: `no player "${targetToken}"` };
    const { data, error } = await b.actor.rpc("world_silence", {
      p_target: t.uuid,
      p_minutes: minutes,
      p_reason: null,
    });
    if (error) return { ok: false, code: classifyFaithful(error.message), reason: error.message };
    return { ok: true, targetPlayerId: publicId(t.dbref), targetName: t.name, until: data as string };
  }

  // ---- faithful-layer helpers --------------------------------------------

  private async recoveryWindowSeconds(): Promise<number> {
    const { data } = await this.svc.from("app_settings").select("value").eq("key", "recovery_window_seconds").single();
    const v = data?.value as unknown;
    const n = typeof v === "string" ? Number(v) : Number(v);
    return Number.isFinite(n) ? n : 604800;
  }

  /** Resolve a player anywhere in the world by `me` / `#dbref` / exact name
   *  (case-insensitive) — mail and moderation address players globally, unlike
   *  the neighborhood-scoped `resolveName` used for co-located targets. */
  private async resolvePlayerUuid(
    playerId: string,
    token: string,
  ): Promise<{ uuid: string; name: string; dbref: number } | null> {
    const t = token.trim();
    if (t.toLowerCase() === "me") {
      const b = this.bound.get(playerId);
      if (!b) return null;
      return { uuid: b.uuid, name: "", dbref: b.dbref };
    }
    const { data } = await this.svc
      .from("objects")
      .select("id, name, dbref")
      .eq("type", "player")
      .is("destroyed_at", null);
    const rows = (data ?? []) as { id: string; name: string; dbref: number }[];
    const m = /^#(\d+)$/.exec(t);
    const matches = m
      ? rows.filter((r) => r.dbref === Number(m[1]))
      : rows.filter((r) => r.name.toLowerCase() === t.toLowerCase());
    if (matches.length !== 1) return null;
    const r = matches[0]!;
    return { uuid: r.id, name: r.name, dbref: r.dbref };
  }

  /** The recipient's live inbox rows (service read, scoped to the recipient),
   *  newest first — the ordering `mail read N`/`mail delete N` index into. */
  private async rawInbox(
    recipientUuid: string,
  ): Promise<{ id: number; sender_id: string; subject: string; body: string; sent_at: string; read_at: string | null }[]> {
    const { data } = await this.svc
      .from("mail")
      .select("id, sender_id, subject, body, sent_at, read_at")
      .eq("recipient_id", recipientUuid)
      .eq("recipient_deleted", false)
      .order("id", { ascending: false });
    return (data ?? []) as {
      id: number;
      sender_id: string;
      subject: string;
      body: string;
      sent_at: string;
      read_at: string | null;
    }[];
  }

  private async moderate(
    playerId: string,
    targetToken: string,
    call: (
      actor: SupabaseClient,
      t: { uuid: string; name: string; dbref: number },
    ) => PromiseLike<{ error: { message: string } | null }>,
  ): Promise<ModerationResult> {
    const b = this.bound.get(playerId);
    if (!b) return { ok: false, code: "MODERATION_REFUSED", reason: "session not bound" };
    const t = await this.resolvePlayerUuid(playerId, targetToken);
    if (!t) return { ok: false, code: "NO_SUCH_PLAYER", reason: `no player "${targetToken}"` };
    const { error } = await call(b.actor, t);
    if (error) return { ok: false, code: classifyFaithful(error.message), reason: error.message };
    return { ok: true, targetPlayerId: publicId(t.dbref), targetName: t.name };
  }

  // ---- softcode meets the world (GENMURK-EPIC1-07) ------------------------

  /** Wrap prepared runs over a fresh neighborhood snapshot. Mutations a run
   *  journals apply through ITS OWNER's JWT-scoped client — the same
   *  applyMutations discipline as src/world/snapshot.ts, so RLS + the RPC
   *  role checks stay the final wall under softcode too. An owner with no
   *  bound session has that run's mutations SKIPPED and counted: the
   *  offline-owner execution principal is prompt 08's auth/capability work,
   *  and dropping writes loudly beats applying them with elevated rights. */
  private batchOver(l: Loaded, runs: SoftcodeRun[]): SoftcodeBatch | null {
    if (runs.length === 0) return null;
    return {
      world: l.world,
      runs,
      nameOf: (id) => l.snapshot.objects.get(id)?.name ?? id,
      apply: async (outcomes) => {
        let applied = 0;
        let skippedUnbound = 0;
        for (let i = 0; i < outcomes.length; i++) {
          const outcome = outcomes[i];
          const run = runs[i];
          if (!outcome || !run || outcome.status !== "completed") continue;
          if (outcome.mutations.length === 0) continue;
          const ownerSession = this.bound.get(run.owner);
          if (!ownerSession) {
            skippedUnbound++;
            continue;
          }
          await applyMutations(ownerSession.actor, l.refToUuid, outcome.mutations);
          applied++;
        }
        return { applied, skippedUnbound };
      },
    };
  }

  async softcodeCommand(playerId: string, line: string): Promise<SoftcodeBatch | null> {
    const l = await this.loadFor(playerId);
    if (!l) return null;
    const match = matchDollarCommand(l.snapshot, playerId, line);
    return match ? this.batchOver(l, [match]) : null;
  }

  async softcodeTriggers(
    playerId: string,
    event: { kind: TriggerKind; targetId: string },
  ): Promise<SoftcodeBatch | null> {
    const l = await this.loadFor(playerId);
    if (!l) return null;
    const me = l.snapshot.objects.get(playerId);
    if (!me) return null;
    const runs = collectTriggers(l.snapshot, event.kind, event.targetId, {
      id: playerId,
      name: me.name,
    });
    return this.batchOver(l, runs);
  }

  async close(): Promise<void> {
    this.bound.clear();
  }

  // ---- shared RPC drivers ------------------------------------------------

  private async creating(
    playerId: string,
    call: (actor: SupabaseClient) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  ): Promise<BuildResult> {
    const b = this.bound.get(playerId);
    if (!b) return { ok: false, code: "BUILD_FAILED", reason: "session not bound" };
    const { data, error } = await call(b.actor);
    if (error) return { ok: false, code: classify(error.message), reason: error.message };
    const newUuid = data as string;
    const { data: row } = await this.svc.from("objects").select("dbref, name").eq("id", newUuid).single();
    if (!row) return { ok: false, code: "BUILD_FAILED", reason: "created but unreadable" };
    return { ok: true, id: publicId(row.dbref as number), name: row.name as string };
  }

  private async mutating(
    playerId: string,
    targetToken: string,
    call: (actor: SupabaseClient, uuid: string) => PromiseLike<{ error: { message: string } | null }>,
  ): Promise<ActResult> {
    const b = this.bound.get(playerId);
    const l = await this.loadFor(playerId);
    if (!b || !l) return { ok: false, code: "BUILD_FAILED", reason: "session not bound" };
    const found = this.resolveWithUuid(l, targetToken);
    if ("fail" in found) return found.fail;
    const targetName = l.snapshot.objects.get(found.id)?.name ?? found.id;
    const { error } = await call(b.actor, found.uuid);
    if (error) return { ok: false, code: classify(error.message), reason: error.message };
    return { ok: true, targetId: found.id, targetName };
  }

  private async roomOf(uuid: string): Promise<{ id: string; name: string } | null> {
    const { data, error } = await this.svc.from("objects").select("dbref, name").eq("id", uuid).single();
    if (error || !data) return null;
    return { id: publicId(data.dbref as number), name: data.name as string };
  }
}

/** The RPCs raise plain-text exceptions; map the ones the command layer wants
 *  to distinguish, everything else is a generic build failure. */
function classify(message: string): BuildErrorCode {
  if (/permission denied|requires the builder|only god/i.test(message)) return "PERMISSION_DENIED";
  return "BUILD_FAILED";
}

/** The faithful layer (GENMURK-EPIC1-09) distinguishes more refusal shapes than
 *  the build codes: a full mailbox, a silenced sender, a missing message, and
 *  the moderation guards (God #1 / equal-or-higher tier). */
function classifyFaithful(message: string): FaithfulErrorCode {
  if (/mailbox is full/i.test(message)) return "MAILBOX_FULL";
  if (/silenced/i.test(message)) return "SILENCED";
  if (/no such message/i.test(message)) return "NO_SUCH_MAIL";
  if (/God #1|equal or higher tier|may not be moderated/i.test(message)) return "MODERATION_REFUSED";
  if (/permission denied|requires the|only god|not signed in/i.test(message)) return "PERMISSION_DENIED";
  if (/no such (live )?player|no such player to/i.test(message)) return "NO_SUCH_PLAYER";
  return "BUILD_FAILED";
}
