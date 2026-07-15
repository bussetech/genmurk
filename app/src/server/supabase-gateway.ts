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
  GatewayPlayer,
  LookResult,
  MoveResult,
  RegisterRequest,
  RegisterResult,
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
      .select("id, dbref, name, power, location_id")
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
