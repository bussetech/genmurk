// The world gateway — the connection layer's seam onto the world model. The
// coordinator (ordering, fan-out) is deliberately world-blind; everything
// that must consult the world of record — who a token binds to (AUTH STUB
// until prompt 08), where a player is, whether a move is allowed — goes
// through this interface. Two implementations: the in-memory fixture below
// (stack-free tests) and SupabaseGateway (supabase-gateway.ts), which drives
// the real audited `world_move` RPC so RLS + role checks stay the final wall.

import type { Power } from "../world/types.ts";

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
  | { ok: false; code: "NO_SUCH_EXIT" | "MOVE_REFUSED"; reason: string };

export interface WorldGateway {
  /**
   * AUTH STUB (GENMURK-EPIC1-05) — session-to-player binding by placeholder
   * token, `stub:<PlayerName>`. This is NOT authentication: no credential is
   * verified at this layer. Prompt 08 (GM-R15/GM-R18: modern KDF, no default
   * credentials) replaces the token scheme; the interface stays.
   */
  authenticate(token: string): Promise<GatewayPlayer | null>;

  /** Move the player through a named exit in their current room. The world
   *  of record decides (locks/structure/capability); the transport only
   *  relays the outcome. */
  move(playerId: string, exitName: string): Promise<MoveResult>;

  close(): Promise<void>;
}

// --------------------------------------------------------------- fixture

export interface FixtureSpec {
  rooms: Record<string, { name: string }>;
  /** exit name -> from room id -> to room id */
  exits: { name: string; from: string; to: string }[];
  players: Record<string, { power?: Power; room: string }>;
}

/** In-memory gateway for stack-free tests: same interface, toy world. */
export class FixtureGateway implements WorldGateway {
  private readonly spec: FixtureSpec;
  private readonly playerRooms = new Map<string, string>();
  private readonly playerIds = new Map<string, string>();

  constructor(spec: FixtureSpec) {
    this.spec = spec;
    let dbref = 100;
    for (const [name, p] of Object.entries(spec.players)) {
      this.playerIds.set(name, `#${dbref++}`);
      this.playerRooms.set(name, p.room);
    }
  }

  async authenticate(token: string): Promise<GatewayPlayer | null> {
    if (!token.startsWith("stub:")) return null;
    const name = token.slice("stub:".length);
    const p = this.spec.players[name];
    const id = this.playerIds.get(name);
    if (!p || !id) return null;
    const roomId = this.playerRooms.get(name)!;
    return {
      playerId: id,
      playerName: name,
      power: p.power ?? "player",
      roomId,
      roomName: this.spec.rooms[roomId]?.name ?? roomId,
    };
  }

  async move(playerId: string, exitName: string): Promise<MoveResult> {
    const name = [...this.playerIds.entries()].find(([, id]) => id === playerId)?.[0];
    if (!name) return { ok: false, code: "MOVE_REFUSED", reason: "no such player" };
    const from = this.playerRooms.get(name)!;
    const wanted = exitName.toLowerCase();
    const exit = this.spec.exits.find(
      (e) => e.from === from && e.name.toLowerCase().startsWith(wanted),
    );
    if (!exit) return { ok: false, code: "NO_SUCH_EXIT", reason: `no exit "${exitName}" here` };
    this.playerRooms.set(name, exit.to);
    return { ok: true, roomId: exit.to, roomName: this.spec.rooms[exit.to]?.name ?? exit.to };
  }

  async close(): Promise<void> {}
}
