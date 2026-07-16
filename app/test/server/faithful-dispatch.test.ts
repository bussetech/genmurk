// The faithful layer (GENMURK-EPIC1-09), stack-free: real parseCommand + real
// dispatch + real RoomCoordinator + FixtureGateway. Proves containment
// (take/drop over the pickup lock, GM-R8), recoverable destruction (GM-R9),
// in-world mail (GM-R17), and moderation (GM-R16) without a database — the
// real-stack v1 slice (test/world/slice.test.ts) proves the same shapes end to
// end through Postgres with the audit trail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../../src/engine/engine.ts";
import { RoomCoordinator } from "../../src/server/coordinator.ts";
import { FixtureGateway, type FixtureSpec } from "../../src/server/gateway.ts";
import { dispatch, type DispatchDeps } from "../../src/server/dispatch.ts";
import type { ServerMessage, RoomEventMessage } from "../../src/server/protocol.ts";

const SPEC: FixtureSpec = {
  rooms: { "#10": { name: "Town Square" }, "#20": { name: "Echo Cave" } },
  exits: [{ name: "north", from: "#10", to: "#20" }],
  players: {
    Wanda: { power: "wizard", room: "#10" }, // moderator
    Merlin: { power: "wizard", room: "#10" }, // a second wizard (can't-moderate-equal)
    Bob: { room: "#10" }, // plain player
    Zoe: { room: "#20" }, // plain player, elsewhere (mail crosses rooms)
  },
  things: [
    { name: "a brass lantern", owner: "Bob", room: "#10" }, // unlocked, takeable
    { name: "a sealed casket", owner: "Wanda", room: "#10" }, // locked at runtime
  ],
};

interface Seat {
  sessionId: string;
  playerId: string;
  received: ServerMessage[];
  disconnected: boolean;
  run(line: string): Promise<void>;
  events(): RoomEventMessage[];
  infos(): string[];
  errors(): Extract<ServerMessage, { type: "error" }>[];
  clear(): void;
}

async function world(): Promise<{ coord: RoomCoordinator; gw: FixtureGateway; seat(name: string): Promise<Seat> }> {
  const coord = new RoomCoordinator();
  const gw = new FixtureGateway(SPEC);
  const engine = createEngine();
  let n = 0;
  async function seat(name: string): Promise<Seat> {
    const sessionId = `s${++n}`;
    const player = await gw.authenticate(gw.tokenFor(name));
    assert.ok(player, `authenticate ${name}`);
    const received: ServerMessage[] = [];
    const s: Seat = {
      sessionId,
      playerId: player.playerId,
      received,
      disconnected: false,
      run: (line) =>
        dispatch(
          {
            coordinator: coord,
            gateway: gw,
            engine,
            sessionId,
            send: (m) => received.push(m),
            disconnect: () => {
              s.disconnected = true;
            },
          } satisfies DispatchDeps,
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
    coord.join(sessionId, {
      playerId: player.playerId,
      playerName: player.playerName,
      power: player.power,
      roomId: player.roomId,
      roomName: player.roomName,
      sink: { send: (m) => received.push(m) },
      silencedUntil: player.silencedUntil,
      disconnect: () => {
        s.disconnected = true;
      },
    });
    return s;
  }
  return { coord, gw, seat };
}

// ---- containment: take / drop over the pickup lock (GM-R6/R8) ---------------

test("get/drop an unlocked thing: into the hand and back to the room", async () => {
  const { gw, seat } = await world();
  const bob = await seat("Bob");

  await bob.run("get brass lantern");
  assert.ok(bob.infos().some((t) => /You take a brass lantern/.test(t)));
  assert.deepEqual(bob.errors(), []);

  await bob.run("drop brass lantern");
  assert.ok(bob.infos().some((t) => /You drop a brass lantern/.test(t)));
  // it resolves in the room again
  assert.equal((await gw.resolve(bob.playerId, "lantern")).status, "ok");
});

test("pickup lock (GM-R8): a non-key player is refused; the key holder passes", async () => {
  const { seat } = await world();
  const wanda = await seat("Wanda");
  const bob = await seat("Bob");

  // Wanda locks her casket's pickup to her own key (#dbref)
  await wanda.run(`lock pickup casket = ${wanda.playerId}`);
  assert.ok(wanda.infos().some((t) => /Locked a sealed casket \(pickup\)/.test(t)));

  bob.clear();
  await bob.run("get casket");
  assert.equal(bob.errors().at(0)?.code, "LOCKED", "Bob lacks the key");

  wanda.clear();
  await wanda.run("get casket");
  assert.ok(wanda.infos().some((t) => /You take a sealed casket/.test(t)), "Wanda holds the key");
});

// ---- recoverable destruction (GM-R9) ----------------------------------------

test("destroy then undestroy by dbref, within the window", async () => {
  const { gw, seat } = await world();
  const bob = await seat("Bob");

  await bob.run("destroy brass lantern");
  const destroyed = bob.infos().find((t) => /Destroyed a brass lantern/.test(t));
  assert.ok(destroyed, "destroy confirms with the window");
  assert.match(destroyed!, /Recoverable with "undestroy #\d+" for 7 day\(s\)/);
  // it has left the actor's world
  assert.equal((await gw.resolve(bob.playerId, "lantern")).status, "none");

  const dbref = /undestroy (#\d+)/.exec(destroyed!)![1]!;
  await bob.run(`undestroy ${dbref}`);
  assert.ok(bob.infos().some((t) => /Recovered a brass lantern/.test(t)));
  assert.equal((await gw.resolve(bob.playerId, "lantern")).status, "ok", "back in the world");
});

// ---- in-world mail (GM-R17) -------------------------------------------------

test("mail: send across rooms, list, read, delete", async () => {
  const { seat } = await world();
  const bob = await seat("Bob"); // Town
  const zoe = await seat("Zoe"); // Cave — mail reaches her anyway

  await bob.run("mail Zoe = meet me at the fountain");
  assert.ok(bob.infos().some((t) => /Mail sent to Zoe/.test(t)));

  await zoe.run("mail");
  const list = zoe.infos().at(-1) ?? "";
  assert.match(list, /Mailbox \(1\)/);
  assert.match(list, /from Bob/);

  await zoe.run("mail read 1");
  assert.ok(zoe.infos().some((t) => /meet me at the fountain/.test(t)));

  await zoe.run("mail delete 1");
  await zoe.run("mail");
  assert.ok(zoe.infos().some((t) => /Your mailbox is empty/.test(t)));
});

test("mail to an unknown player is refused", async () => {
  const { seat } = await world();
  const bob = await seat("Bob");
  await bob.run("mail Nobody = hello?");
  assert.equal(bob.errors().at(0)?.code, "NO_SUCH_PLAYER");
});

// ---- moderation (GM-R16) ----------------------------------------------------

test("silence gags a player's speech, unsilence restores it", async () => {
  const { seat } = await world();
  const wanda = await seat("Wanda");
  const bob = await seat("Bob");

  await wanda.run("silence Bob = 5");
  assert.ok(wanda.infos().some((t) => /Silenced Bob until/.test(t)));

  bob.clear();
  await bob.run("say hello");
  assert.equal(bob.errors().at(0)?.code, "SILENCED", "a silenced player cannot speak");
  // …nor mail
  await bob.run("mail Wanda = let me out");
  assert.ok(bob.errors().some((e) => e.code === "SILENCED"));

  await wanda.run("unsilence Bob");
  bob.clear();
  await bob.run("say hello now");
  assert.deepEqual(bob.errors(), [], "speech restored");
});

test("moderation is wizard+, and cannot reach an equal-or-higher tier", async () => {
  const { seat } = await world();
  const wanda = await seat("Wanda"); // wizard
  const merlin = await seat("Merlin"); // wizard
  const bob = await seat("Bob"); // plain player

  // a plain player cannot moderate
  await bob.run("silence Zoe = 5");
  assert.equal(bob.errors().at(0)?.code, "PERMISSION_DENIED");

  // a wizard cannot silence another wizard (equal tier)
  await wanda.run("silence Merlin = 5");
  assert.equal(wanda.errors().at(0)?.code, "MODERATION_REFUSED");
  assert.deepEqual(merlin.errors(), []);
});

test("warn delivers a notice to the target and confirms to the moderator", async () => {
  const { seat } = await world();
  const wanda = await seat("Wanda");
  const bob = await seat("Bob");
  bob.clear();

  await wanda.run("warn Bob = please keep it civil");
  assert.ok(wanda.infos().some((t) => /Warned Bob/.test(t)));
  assert.ok(bob.infos().some((t) => /warned by a moderator: please keep it civil/.test(t)));
});

test("boot disconnects the target's session and fires departure presence", async () => {
  const { seat } = await world();
  const wanda = await seat("Wanda");
  const bob = await seat("Bob"); // Town, with Wanda
  wanda.clear();

  await wanda.run("boot Bob = spamming the channel");
  assert.ok(wanda.infos().some((t) => /Booted Bob/.test(t)));
  assert.equal(bob.disconnected, true, "Bob's transport was dropped");
  assert.ok(bob.infos().some((t) => /disconnected by a moderator/.test(t)), "Bob was told why");
  // Wanda, still in Town, saw Bob depart (presence fired)
  assert.ok(wanda.events().some((e) => e.kind === "depart" && e.actor === bob.playerId));
});
