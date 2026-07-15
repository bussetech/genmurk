// THE BUILDING & MOVEMENT ACCEPTANCE SCENARIO (GENMURK-EPIC1-06) — a v1
// acceptance gate, end-to-end through the REAL stack: real parseCommand →
// real dispatch → SupabaseGateway (the audited world_* RPCs, as the actor) →
// real RoomCoordinator presence. A scripted session (no human) digs two rooms,
// opens exits both ways, creates a thing, locks an exit, has ANOTHER player
// fail that lock, and moves so presence fires — all green through Postgres.
//
// Same discipline as test/world/isolation.test.ts: it is NOT in `npm test`
// (it needs a live local stack). Run against a freshly seeded stack:
//   npm run db:reset
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
//     npm run test:building

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { RoomCoordinator } from "../../src/server/coordinator.ts";
import { SupabaseGateway } from "../../src/server/supabase-gateway.ts";
import { dispatch } from "../../src/server/dispatch.ts";
import type { ServerMessage, RoomEventMessage } from "../../src/server/protocol.ts";

const url = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54541";
const anonKey = process.env["SUPABASE_ANON_KEY"] ?? "";
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const PASSWORD = "synthetic-password-1234";

// the scenario's cast, from the seeded world (supabase/seed.sql)
const CAST = [
  { name: "Merlin", email: "merlin@genmurk.invalid" }, // wizard — the builder
  { name: "Cara", email: "cara@genmurk.invalid" }, // plain player — fails the lock
];

function service(): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

let gateway: SupabaseGateway;
let coordinator: RoomCoordinator;

interface Seat {
  sessionId: string;
  playerId: string;
  received: ServerMessage[];
  run(line: string): Promise<void>;
  events(): RoomEventMessage[];
  infos(): string[];
  errors(): ServerMessage[];
  clear(): void;
}

let nextSession = 0;
async function connect(name: string): Promise<Seat> {
  const sessionId = `s${++nextSession}`;
  const player = await gateway.authenticate(`stub:${name}`);
  assert.ok(player, `authenticate ${name} (stack seeded + auth users linked?)`);
  const received: ServerMessage[] = [];
  const send = (m: ServerMessage): void => {
    received.push(m);
  };
  coordinator.join(sessionId, {
    playerId: player.playerId,
    playerName: player.playerName,
    power: player.power,
    roomId: player.roomId,
    roomName: player.roomName,
    sink: { send },
  });
  return {
    sessionId,
    playerId: player.playerId,
    received,
    run: (line) => dispatch({ coordinator, gateway, sessionId, send, disconnect: () => {} }, line),
    events: () => received.filter((m): m is RoomEventMessage => m.type === "event"),
    infos: () =>
      received
        .filter((m): m is Extract<ServerMessage, { type: "info" }> => m.type === "info")
        .map((m) => m.text),
    errors: () => received.filter((m) => m.type === "error"),
    clear: () => {
      received.length = 0;
    },
  };
}

before(async () => {
  assert.ok(anonKey && serviceKey, "set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (from `supabase start`)");
  const admin = service();
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
  for (const p of CAST) {
    const found = existing?.users.find((u) => u.email === p.email);
    if (found) await admin.auth.admin.deleteUser(found.id);
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser ${p.email}: ${error?.message}`);
    const { error: linkErr } = await admin
      .from("objects")
      .update({ auth_user_id: data.user.id })
      .eq("name", p.name)
      .eq("type", "player");
    if (linkErr) throw new Error(`link ${p.name}: ${linkErr.message}`);
  }
  gateway = new SupabaseGateway({ url, anonKey, serviceRoleKey: serviceKey });
  coordinator = new RoomCoordinator();
}, { timeout: 60_000 });

after(async () => {
  if (gateway) await gateway.close();
});

test("a scripted build session: dig, open both ways, create, lock, refuse, move — through the real stack", async () => {
  const merlin = await connect("Merlin"); // wizard, in Town Square
  const cara = await connect("Cara"); // plain player, same room

  // --- dig two rooms (GM-R7) ---
  await merlin.run("dig The Vault");
  await merlin.run("dig The Cellar");
  assert.ok(merlin.infos().some((t) => /Dug The Vault/.test(t)), "dug The Vault");
  assert.ok(merlin.infos().some((t) => /Dug The Cellar/.test(t)), "dug The Cellar");
  assert.deepEqual(merlin.errors(), [], "digging produced no errors");

  // --- open an exit from Town into the Vault, and lock it (GM-R7/R8) ---
  await merlin.run("open vault = The Vault");
  assert.ok(merlin.infos().some((t) => /Opened exit vault/.test(t)), "opened Town→Vault");
  await merlin.run(`lock use vault = ${merlin.playerId}`);
  assert.ok(merlin.infos().some((t) => /Locked vault \(use\)/.test(t)), "locked the exit");

  // --- create a thing and lock it too (GM-R7/R8). A unique name: the seed
  //     already stocks a brass lantern in Town, and "lantern" would then be a
  //     genuinely ambiguous partial match for a wizard who sees both. ---
  await merlin.run("create a silver chalice");
  assert.ok(merlin.infos().some((t) => /Created a silver chalice/.test(t)), "created the chalice");
  await merlin.run("describe chalice = a gleaming silver chalice");
  await merlin.run("lock pickup chalice = DESC:*silver*");
  assert.deepEqual(merlin.errors(), [], "building the chalice produced no errors");

  // --- ANOTHER player fails the lock (GM-R8) ---
  cara.clear();
  await cara.run("go vault");
  const caraErr = cara.errors();
  assert.equal(caraErr.length, 1);
  assert.equal(caraErr[0]!.type === "error" && caraErr[0]!.code, "LOCKED", "Cara is refused by the exit lock");

  // --- the key holder passes, and MOVEMENT FIRES PRESENCE (GM-R6) ---
  cara.clear();
  await merlin.run("go vault");
  assert.ok(merlin.infos().some((t) => /The Vault/.test(t)), "Merlin traversed into the Vault");
  // Cara, still in Town, sees Merlin depart — presence fired live
  assert.ok(
    cara.events().some((e) => e.kind === "depart" && e.actor === merlin.playerId),
    "Cara saw Merlin depart (live presence)",
  );

  // --- open exits BOTH WAYS between the two dug rooms (GM-R7). Both rooms are
  //     Merlin-owned, so both stay in his neighborhood snapshot and remain
  //     name-resolvable wherever he stands (unlike God's Town, which leaves
  //     his snapshot once he steps into the Vault — name resolution is
  //     neighborhood-scoped, GM-R12). ---
  await merlin.run("open down = The Cellar"); // Vault → Cellar
  await merlin.run("go down"); // into the Cellar
  await merlin.run("open up = The Vault"); // Cellar → Vault (back)
  assert.ok(merlin.infos().some((t) => /Opened exit down/.test(t)), "opened Vault→Cellar");
  assert.ok(merlin.infos().some((t) => /Opened exit up/.test(t)), "opened Cellar→Vault");
  assert.deepEqual(merlin.errors(), [], "the whole build session produced no errors");

  // --- durable presence record: the RPC wrote arrive/depart rows (GM-R4) ---
  const svc = service();
  const { data: merlinRow } = await svc
    .from("objects")
    .select("id")
    .eq("name", "Merlin")
    .eq("type", "player")
    .single();
  const { data: evs } = await svc
    .from("world_events")
    .select("kind")
    .eq("actor_id", merlinRow!.id as string)
    .in("kind", ["arrive", "depart"]);
  assert.ok((evs?.length ?? 0) >= 2, "world_events holds Merlin's arrive/depart (durable record)");
});
