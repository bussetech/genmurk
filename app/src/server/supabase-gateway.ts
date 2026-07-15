// The real-stack gateway: the connection layer over the GENMURK-EPIC1-04
// world of record. Reads use the service role (the server plane); every
// MUTATION goes through the audited `world_move` RPC AS THE ACTOR (a
// JWT-scoped client), so RLS + the RPC role checks stay the final wall —
// the same discipline as src/world/snapshot.ts applyMutations. The RPC also
// writes arrive/depart rows to `world_events`, which stays the DURABLE
// presence record; the live fan-out order is the coordinator's (see
// app/docs/presence-transport.md for why the live path does not tail the
// table).
//
// AUTH STUB (GENMURK-EPIC1-05), loudly: `stub:<PlayerName>` resolves to the
// seeded synthetic auth user `<name>@genmurk.invalid` with the shared
// synthetic password — the SAME synthetic principals the isolation proof
// creates (test/world/isolation.test.ts). This exists so the playable check
// exercises real RLS-scoped clients; it verifies no player credential and
// MUST NOT survive prompt 08 (GM-R15/GM-R18).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Power } from "../world/types.ts";
import { publicId } from "../world/types.ts";
import type { GatewayPlayer, MoveResult, WorldGateway } from "./gateway.ts";

const STUB_PASSWORD = "synthetic-password-1234"; // isolation-proof synthetic, not a secret
const STUB_EMAIL_DOMAIN = "genmurk.invalid";

export interface SupabaseGatewayConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

interface BoundPlayer {
  uuid: string;
  actor: SupabaseClient;
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
    if (!token.startsWith("stub:")) return null;
    const name = token.slice("stub:".length);

    // AUTH STUB: sign in the synthetic principal for this player name.
    const email = `${name.toLowerCase()}@${STUB_EMAIL_DOMAIN}`;
    const anon = createClient(this.cfg.url, this.cfg.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.auth.signInWithPassword({
      email,
      password: STUB_PASSWORD,
    });
    if (error || !data.session) return null;
    const actor = createClient(this.cfg.url, this.cfg.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    });

    const { data: row, error: rowErr } = await this.svc
      .from("objects")
      .select("id, dbref, name, power, location_id")
      .eq("type", "player")
      .eq("name", name)
      .is("destroyed_at", null)
      .single();
    if (rowErr || !row || !row.location_id) return null;

    const room = await this.roomOf(row.location_id);
    if (!room) return null;

    const playerId = publicId(row.dbref as number);
    this.bound.set(playerId, { uuid: row.id as string, actor });
    return {
      playerId,
      playerName: row.name as string,
      power: row.power as Power,
      roomId: room.id,
      roomName: room.name,
    };
  }

  async move(playerId: string, exitName: string): Promise<MoveResult> {
    const b = this.bound.get(playerId);
    if (!b) return { ok: false, code: "MOVE_REFUSED", reason: "session not bound" };

    const { data: me, error: meErr } = await this.svc
      .from("objects")
      .select("location_id")
      .eq("id", b.uuid)
      .single();
    if (meErr || !me?.location_id) {
      return { ok: false, code: "MOVE_REFUSED", reason: "player has no location" };
    }

    // Exit resolution here is deliberately minimal (case-insensitive prefix
    // over the room's exits); full GM-R12 matching stays the world-API's.
    const { data: exits, error: exErr } = await this.svc
      .from("objects")
      .select("id, name, destination_id")
      .eq("type", "exit")
      .eq("location_id", me.location_id)
      .is("destroyed_at", null);
    if (exErr) return { ok: false, code: "MOVE_REFUSED", reason: exErr.message };
    const wanted = exitName.toLowerCase();
    const exit = (exits ?? []).find((e) => (e.name as string).toLowerCase().startsWith(wanted));
    if (!exit || !exit.destination_id) {
      return { ok: false, code: "NO_SUCH_EXIT", reason: `no exit "${exitName}" here` };
    }

    // The audited RPC, as the actor: capability + structure enforced in the
    // world of record; arrive/depart land on world_events (durable record).
    const { error: mvErr } = await b.actor.rpc("world_move", {
      p_what: b.uuid,
      p_dest: exit.destination_id,
    });
    if (mvErr) return { ok: false, code: "MOVE_REFUSED", reason: mvErr.message };

    const room = await this.roomOf(exit.destination_id as string);
    if (!room) return { ok: false, code: "MOVE_REFUSED", reason: "destination unreadable" };
    return { ok: true, roomId: room.id, roomName: room.name };
  }

  async close(): Promise<void> {
    this.bound.clear();
  }

  private async roomOf(uuid: string): Promise<{ id: string; name: string } | null> {
    const { data, error } = await this.svc
      .from("objects")
      .select("dbref, name")
      .eq("id", uuid)
      .single();
    if (error || !data) return null;
    return { id: publicId(data.dbref as number), name: data.name as string };
  }
}
