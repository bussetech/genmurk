// THE v1 PLAYABLE VERTICAL SLICE (GENMURK-EPIC1-09) — the epic's integration
// acceptance, end to end through the REAL local stack. One scripted,
// multi-client scenario exercises every subsystem the epic built, in the order
// a returning player would touch them:
//
//   register/login (08)  →  walk & talk across rooms (05/06)  →
//   build & lock (06, GM-R8)  →  attach a $-command another player triggers (07)
//   →  page & mail (05/GM-R17)  →  a wizard moderates (GM-R16)  →
//   destroy / undestroy (GM-R9)
//
// It runs against a freshly reset + first-booted stack (CI: the `v1-slice`
// job stands up Supabase, `db reset` applies migrations + seed, then this
// runs). Same live-stack discipline as the isolation/building gates: NOT in
// `npm test`. LOCALHOST ONLY — the sandbox gate holds; nothing is hosted.
//
//   npm run db:reset
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run test:slice

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { RoomCoordinator } from "../../src/server/coordinator.ts";
import { SupabaseGateway } from "../../src/server/supabase-gateway.ts";
import { dispatch } from "../../src/server/dispatch.ts";
import { createEngine } from "../../src/engine/engine.ts";
import type { ServerMessage, RoomEventMessage } from "../../src/server/protocol.ts";
import { provisionFirstBoot, registerOpen } from "../../src/server/auth.ts";
import { provisionCast, signIn, type Provisioned, type StackConfig } from "./auth-helpers.ts";

const url = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54541";
const anonKey = process.env["SUPABASE_ANON_KEY"] ?? "";
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const cfg: StackConfig = { url, anonKey, serviceRoleKey: serviceKey };

// The scenario cast, from the seeded world (supabase/seed.sql).
const CAST = [
  { name: "Merlin", email: "merlin@genmurk.invalid" }, // wizard — builder + moderator
  { name: "Cara", email: "cara@genmurk.invalid" }, // plain player — triggers, is moderated
];
// A per-run random registration passphrase for the register/login phase (never
// a repo literal — the credential leak-check stays green).
const PASSPHRASE = `pf-${Math.floor(performance.now())}-${process.pid}`;
const NEWBIE_SECRET = `ns-${Math.floor(performance.now())}-${process.pid}a`;

function service(): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

let gateway: SupabaseGateway;
let coordinator: RoomCoordinator;
let seats: Record<string, Provisioned>;
const engine = createEngine();

interface Seat {
  sessionId: string;
  playerId: string;
  disconnected: boolean;
  received: ServerMessage[];
  run(line: string): Promise<void>;
  events(): RoomEventMessage[];
  infos(): string[];
  errors(): Extract<ServerMessage, { type: "error" }>[];
  clear(): void;
}

let nextSession = 0;
async function connectToken(token: string): Promise<Seat> {
  const sessionId = `s${++nextSession}`;
  const player = await gateway.authenticate(token);
  assert.ok(player, "authenticate (stack seeded + auth users provisioned?)");
  const received: ServerMessage[] = [];
  const seat: Seat = {
    sessionId,
    playerId: player.playerId,
    disconnected: false,
    received,
    run: (line) =>
      dispatch(
        {
          coordinator,
          gateway,
          engine,
          sessionId,
          send: (m) => received.push(m),
          disconnect: () => {
            seat.disconnected = true;
          },
        },
        line,
      ),
    events: () => received.filter((m): m is RoomEventMessage => m.type === "event"),
    infos: () =>
      received.filter((m): m is Extract<ServerMessage, { type: "info" }> => m.type === "info").map((m) => m.text),
    errors: () => received.filter((m): m is Extract<ServerMessage, { type: "error" }> => m.type === "error"),
    clear: () => {
      received.length = 0;
    },
  };
  coordinator.join(sessionId, {
    playerId: player.playerId,
    playerName: player.playerName,
    power: player.power,
    roomId: player.roomId,
    roomName: player.roomName,
    sink: { send: (m) => received.push(m) },
    silencedUntil: player.silencedUntil,
    disconnect: () => {
      seat.disconnected = true;
    },
  });
  return seat;
}

const connect = (name: string): Promise<Seat> => connectToken(seats[name]!.token);

before(async () => {
  assert.ok(anonKey && serviceKey, "set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (from `supabase start`)");
  // first boot provisions God #1 and defaults the instance to passphrase-gated
  // registration — the precondition for the register/login phase.
  await provisionFirstBoot(
    { url, serviceRoleKey: serviceKey, anonKey },
    { email: "god@genmurk.invalid", secret: `god-${PASSPHRASE}`, registrationPassphrase: PASSPHRASE },
  );
  // the seeded cast get real auth accounts + a real login (the 08 auth path).
  seats = await provisionCast(cfg, CAST);
  gateway = new SupabaseGateway(cfg);
  coordinator = new RoomCoordinator();
}, { timeout: 120_000 });

after(async () => {
  if (gateway) await gateway.close();
});

test("v1 vertical slice: register→login→walk→talk→build→lock→softcode→page→mail→moderate→destroy/undestroy", async () => {
  // ============================================================ 1. register/login (08)
  // A fresh player self-registers with the instance passphrase, signs in, and
  // plays — the whole register→login→play path, end to end.
  const reg = await registerOpen(
    { url, serviceRoleKey: serviceKey, anonKey },
    { name: "Ada", email: "ada@genmurk.invalid", secret: NEWBIE_SECRET, passphrase: PASSPHRASE },
  );
  assert.ok(reg.dbref > 0, "Ada registered as a fresh player");
  const { token: adaToken } = await signIn(cfg, "ada@genmurk.invalid", NEWBIE_SECRET);
  const ada = await connectToken(adaToken);
  await ada.run("look");
  assert.ok(ada.infos().some((t) => /Limbo/.test(t)), "Ada logged in and looks around Limbo");
  await ada.run("say hello world");
  assert.deepEqual(ada.errors(), [], "a freshly registered player can play");

  // ============================================================ 2. walk & talk (05/06)
  const merlin = await connect("Merlin"); // wizard, Town Square
  const cara = await connect("Cara"); // plain player, Town Square

  await merlin.run("dig The Parlor");
  await merlin.run("open parlor = The Parlor");
  await merlin.run("go parlor");
  assert.ok(merlin.infos().some((t) => /The Parlor/.test(t)), "Merlin walked into the Parlor");

  cara.clear();
  await cara.run("go parlor"); // Cara follows
  await cara.run("say is anyone here?");
  // Merlin (in the Parlor) heard Cara arrive and speak
  assert.ok(merlin.events().some((e) => e.kind === "arrive" && e.actor === cara.playerId), "presence fired");
  assert.ok(
    merlin.events().some((e) => e.kind === "say" && e.actor === cara.playerId && /anyone here/.test(e.text)),
    "room-scoped speech reached the co-located wizard",
  );

  // ============================================================ 3. build & lock (06, GM-R8)
  // Merlin builds a locked room off the Parlor; the exit's `use` lock (a dbref
  // key) refuses Cara and passes Merlin. A pickup lock on a thing refuses Cara.
  await merlin.run("dig The Reliquary");
  await merlin.run("open reliquary = The Reliquary");
  await merlin.run(`lock use reliquary = ${merlin.playerId}`);
  assert.ok(merlin.infos().some((t) => /Locked reliquary \(use\)/.test(t)));

  cara.clear();
  await cara.run("go reliquary");
  assert.equal(cara.errors().at(0)?.code, "LOCKED", "Cara is refused by the exit lock (GM-R8 use)");

  await merlin.run("create a jeweled reliquary bell");
  await merlin.run("drop jeweled reliquary bell"); // into the Parlor room
  await merlin.run(`lock pickup jeweled reliquary bell = ${merlin.playerId}`);
  cara.clear();
  await cara.run("get jeweled reliquary bell");
  assert.equal(cara.errors().at(0)?.code, "LOCKED", "Cara is refused by the pickup lock (GM-R8 pickup)");

  // ============================================================ 4. attach a $-command another triggers (07)
  await merlin.run(
    'set here = KNOCK:$knock *:obj.setAttr(me, "LASTKNOCK", %0); out.emit(out.style(str.concat("The bell answers ", %0), "color:cyan"))',
  );
  merlin.clear();
  cara.clear();
  await cara.run("knock softly"); // Cara's typed line matches Merlin's $-command
  for (const seat of [merlin, cara]) {
    const emit = seat.events().find((e) => e.kind === "emit");
    assert.ok(emit, "the $-command emit reached the room");
    assert.equal(emit.text, "[[color:cyan]]The bell answers softly[[/]]", "styled as inert markup tokens");
  }
  // the journaled mutation applied via the OWNER's (Merlin's) JWT
  const svcA = service();
  const { data: parlorRow } = await svcA
    .from("objects")
    .select("id")
    .eq("name", "The Parlor")
    .eq("type", "room")
    .single();
  const { data: lastKnock } = await svcA
    .from("object_attributes")
    .select("value")
    .eq("object_id", parlorRow!.id as string)
    .eq("name", "LASTKNOCK")
    .single();
  assert.equal(lastKnock?.value, "softly", "the softcode mutation landed in the world of record");

  // ============================================================ 5. page & mail (05, GM-R17)
  cara.clear();
  merlin.clear();
  await cara.run("page Merlin heading out for now"); // directed, cross-room capable
  assert.ok(
    merlin.received.some((m) => m.type === "message" && m.kind === "page" && /heading out/.test(m.text)),
    "Merlin received Cara's page",
  );
  await merlin.run("mail Cara = thanks for visiting the parlor");
  assert.ok(merlin.infos().some((t) => /Mail sent to Cara/.test(t)));
  await cara.run("mail"); // list
  assert.ok(cara.infos().some((t) => /Mailbox \(1\)/.test(t) && /from Merlin/.test(t)), "Cara's inbox shows it");
  await cara.run("mail read 1");
  assert.ok(cara.infos().some((t) => /thanks for visiting the parlor/.test(t)), "Cara reads the message");

  // ============================================================ 6. a wizard moderates (GM-R16)
  // tier-gated: a plain player cannot moderate.
  await cara.run("silence Ada = 5");
  assert.equal(cara.errors().at(-1)?.code, "PERMISSION_DENIED", "a plain player cannot moderate");

  // silence gags Cara's speech; unsilence restores it.
  await merlin.run("silence Cara = 10");
  cara.clear();
  await cara.run("say can you hear me");
  assert.equal(cara.errors().at(0)?.code, "SILENCED", "the silenced player is gagged");
  await merlin.run("unsilence Cara");
  cara.clear();
  await cara.run("say i can speak again");
  assert.deepEqual(cara.errors(), [], "speech restored after unsilence");

  await merlin.run("warn Cara = please mind the reliquary");
  assert.ok(cara.infos().some((t) => /warned by a moderator: please mind the reliquary/.test(t)));

  // boot drops Cara's transport (and fires departure presence for the room).
  await merlin.run("boot Cara = time to log off");
  assert.equal(cara.disconnected, true, "Cara was booted from the transport");

  // THE MODERATION AUDIT TRAIL (acceptance criterion): the acts appear, are
  // attributed to Merlin, and no plain-player moderation act was journaled.
  const svcB = service();
  const { data: merlinRow } = await svcB
    .from("objects")
    .select("id")
    .eq("name", "Merlin")
    .eq("type", "player")
    .single();
  const { data: caraRow } = await svcB.from("objects").select("id").eq("name", "Cara").eq("type", "player").single();
  const { data: modActs } = await svcB
    .from("object_audit")
    .select("actor_id, action, target_id")
    .in("action", ["silence", "unsilence", "warn", "boot"]);
  const acts = modActs ?? [];
  for (const action of ["silence", "unsilence", "warn", "boot"]) {
    const row = acts.find((a) => a.action === action);
    assert.ok(row, `moderation act "${action}" is journaled`);
    assert.equal(row!.actor_id, merlinRow!.id, `"${action}" is attributed to Merlin (the wizard)`);
    assert.equal(row!.target_id, caraRow!.id, `"${action}" targets Cara`);
  }
  assert.ok(
    !acts.some((a) => a.actor_id === caraRow!.id),
    "no moderation act was journaled for the plain player's refused attempt (tier-gated)",
  );

  // ============================================================ 7. destroy / undestroy (GM-R9)
  await merlin.run("go parlor"); // back to the room that holds the bell
  merlin.clear();
  await merlin.run("destroy jeweled reliquary bell");
  const destroyed = merlin.infos().find((t) => /Destroyed a jeweled reliquary bell|Destroyed jeweled reliquary bell|Destroyed/.test(t));
  assert.ok(destroyed, "destroy confirmed");
  assert.match(destroyed!, /Recoverable with "undestroy #\d+"/, "the recovery window is stated (honest UX)");
  const dbref = /undestroy (#\d+)/.exec(destroyed!)![1]!;

  // the bell is gone from the world (destroyed row hidden)
  const svcC = service();
  const bellDbref = Number(dbref.slice(1));
  const { data: goneRow } = await svcC.from("objects").select("destroyed_at").eq("dbref", bellDbref).single();
  assert.ok(goneRow?.destroyed_at, "the bell is soft-destroyed in the world of record");

  await merlin.run(`undestroy ${dbref}`);
  assert.ok(merlin.infos().some((t) => /Recovered/.test(t)), "undestroy within the window recovers it");
  const { data: backRow } = await svcC.from("objects").select("destroyed_at").eq("dbref", bellDbref).single();
  assert.equal(backRow?.destroyed_at, null, "the bell is live again in the world of record");
});
