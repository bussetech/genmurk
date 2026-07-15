// `$`-command dispatch (GM-R11/R12, GENMURK-EPIC1-07), stack-free: real
// parseCommand + real dispatch + real engine + FixtureGateway over the real
// world model. Proves the acceptance shapes: a demo object's `$`-command
// works end-to-end from a SECOND player's input; built-in shadowing resolves
// per the recorded precedence rule (built-ins ALWAYS win), tested BOTH
// directions; wildcard captures land in %0..; scan scope is the typist's
// neighborhood; a refused run surfaces as a typed SOFTCODE_REFUSED value.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../../src/engine/engine.ts";
import { RoomCoordinator } from "../../src/server/coordinator.ts";
import { FixtureGateway, type FixtureSpec } from "../../src/server/gateway.ts";
import { dispatch, type DispatchDeps } from "../../src/server/dispatch.ts";
import type { ServerMessage, RoomEventMessage } from "../../src/server/protocol.ts";

const SPEC: FixtureSpec = {
  rooms: { "#10": { name: "Town Square" }, "#20": { name: "Echo Cave" } },
  exits: [
    { name: "north", from: "#10", to: "#20" },
    { name: "south", from: "#20", to: "#10" },
  ],
  players: {
    Alice: { power: "wizard", room: "#10" },
    Bob: { room: "#10" },
    Zoe: { room: "#20" },
  },
  things: [
    {
      name: "brass gong",
      owner: "Alice",
      room: "#10",
      attrs: {
        // the demo `$`-command: pattern captures flow into %0..
        RING: '$ring *:out.emit(str.concat("The gong rings ", %0, " times."))',
        // a shadowing attempt on a built-in — must NEVER fire
        HIJACK: '$say *:out.emit("hijacked")',
        // multi-capture pattern
        GIVE: '$give * to *:out.emit(str.concat("passed ", %0, " to ", %1))',
        // self-state: an object controls itself (writes its own attribute)
        NOTE: '$note *:obj.setAttr(me, "MEMO", %0)',
        RECALL: '$recall:out.emit(str.concat("memo: ", obj.getAttr(me, "MEMO")))',
        // a runaway program — must refuse by budget, typed, surfaced
        ZAP: '$zap *:ctl.iter(str.trim(str.repeat("x ", 20000)), "bool.not(1)")',
      },
    },
    {
      // in Bob's inventory (no `room`): private scope, works only for Bob
      name: "pocket watch",
      owner: "Bob",
      attrs: { TICK: '$time:out.emit("tick, tick")' },
    },
  ],
};

interface Seat {
  sessionId: string;
  playerId: string;
  received: ServerMessage[];
  run(line: string): Promise<void>;
  events(): RoomEventMessage[];
  errors(): Extract<ServerMessage, { type: "error" }>[];
  clear(): void;
}

async function world(): Promise<{
  coord: RoomCoordinator;
  gw: FixtureGateway;
  seat(name: string): Promise<Seat>;
}> {
  const coord = new RoomCoordinator();
  const gw = new FixtureGateway(SPEC);
  const engine = createEngine();
  let n = 0;
  async function seat(name: string): Promise<Seat> {
    const sessionId = `s${++n}`;
    const player = await gw.authenticate(`stub:${name}`);
    assert.ok(player, `authenticate ${name}`);
    const received: ServerMessage[] = [];
    const seatObj: Seat = {
      sessionId,
      playerId: player.playerId,
      received,
      run: (line) =>
        dispatch(
          {
            coordinator: coord,
            gateway: gw,
            engine,
            sessionId,
            send: (m) => received.push(m),
            disconnect: () => {},
          } satisfies DispatchDeps,
          line,
        ),
      events: () => received.filter((m): m is RoomEventMessage => m.type === "event"),
      errors: () =>
        received.filter((m): m is Extract<ServerMessage, { type: "error" }> => m.type === "error"),
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
    });
    return seatObj;
  }
  return { coord, gw, seat };
}

test("acceptance: a demo object's $-command fires end-to-end from a second player's input", async () => {
  const { seat } = await world();
  const alice = await seat("Alice"); // owns the gong
  const bob = await seat("Bob"); // the SECOND player — not the owner
  alice.clear();
  bob.clear();

  await bob.run("ring three");

  // the emit enters the room's ordering domain and reaches every occupant
  for (const s of [alice, bob]) {
    const emit = s.events().find((e) => e.kind === "emit");
    assert.ok(emit, "gong emit delivered");
    assert.equal(emit.text, "The gong rings three times.");
    assert.equal(emit.actorName, "brass gong", "the OBJECT speaks, not a player");
  }
});

test("run attribution: the program runs AS the object, billed to the object's OWNER", async () => {
  const { gw, seat } = await world();
  const alice = await seat("Alice");
  const bob = await seat("Bob");
  const batch = await gw.softcodeCommand(bob.playerId, "ring twice");
  assert.ok(batch);
  assert.equal(batch.runs.length, 1, "single deterministic match");
  const run = batch.runs[0]!;
  assert.equal(run.objectName, "brass gong");
  assert.equal(run.owner, alice.playerId, "billed to the gong's owner, never the typist");
  assert.notEqual(run.actor, bob.playerId, "never runs as the typist");
  assert.deepEqual(run.args, ["twice"], "wildcard capture flows into %0");
});

test("precedence, direction 1: softcode can NEVER shadow a built-in", async () => {
  const { seat } = await world();
  const bob = await seat("Bob");
  bob.clear();
  await bob.run("say hello");
  const kinds = bob.events().map((e) => e.kind);
  assert.ok(kinds.includes("say"), "the built-in ran");
  assert.ok(!kinds.includes("emit"), "the $say shadow did not fire");
  assert.ok(!bob.events().some((e) => e.text === "hijacked"));
});

test("precedence, direction 2: a line no built-in claims reaches the $-scan and fires", async () => {
  const { seat } = await world();
  const bob = await seat("Bob");
  bob.clear();
  await bob.run("give rose to zoe");
  const emit = bob.events().find((e) => e.kind === "emit");
  assert.ok(emit);
  assert.equal(emit.text, "passed rose to zoe", "each wildcard captured in pattern order");
});

test("scan scope: inventory is private; other rooms are out of reach", async () => {
  const { seat } = await world();
  const alice = await seat("Alice");
  const bob = await seat("Bob"); // owns the pocket watch
  const zoe = await seat("Zoe"); // different room entirely

  bob.clear();
  await bob.run("time");
  assert.ok(bob.events().some((e) => e.kind === "emit" && e.text === "tick, tick"));

  // Alice shares Bob's room but not his pockets
  alice.clear();
  await alice.run("time");
  assert.ok(alice.errors().some((e) => e.code === "UNKNOWN_COMMAND"));

  // Zoe is in the Cave: the gong is not in her neighborhood
  zoe.clear();
  await zoe.run("ring four");
  assert.ok(zoe.errors().some((e) => e.code === "UNKNOWN_COMMAND"));
});

test("an object keeps state on ITSELF (self-control), never beyond", async () => {
  const { seat } = await world();
  const bob = await seat("Bob");
  await bob.run("note remember the cave");
  bob.clear();
  await bob.run("recall");
  const emit = bob.events().find((e) => e.kind === "emit");
  assert.ok(emit);
  assert.equal(emit.text, "memo: remember the cave");
});

test("a runaway $-command refuses by budget — typed, surfaced to the typist, nothing crashes", async () => {
  const { seat } = await world();
  const alice = await seat("Alice");
  const bob = await seat("Bob");
  bob.clear();
  alice.clear();
  await bob.run("zap everything");
  const err = bob.errors().find((e) => e.code === "SOFTCODE_REFUSED");
  assert.ok(err, "the refusal is surfaced as a value");
  assert.match(err.text, /STEP_BUDGET_EXCEEDED/);
  // and the room still works: the refusal cost the GONG's budget, no one else's
  bob.clear();
  await bob.run("say still alive");
  assert.ok(bob.events().some((e) => e.kind === "say" && e.text === "still alive"));
  assert.ok(alice.events().some((e) => e.kind === "say" && e.text === "still alive"));
});

test("attaching a $-command through the real `set` verb works (the player path)", async () => {
  const { seat } = await world();
  const alice = await seat("Alice"); // wizard — controls the shared room
  const bob = await seat("Bob");
  await alice.run('set here = GREET:$hello:out.emit("The Town Square welcomes you.")');
  bob.clear();
  await bob.run("hello");
  const emit = bob.events().find((e) => e.kind === "emit");
  assert.ok(emit, "the room's $-command fired");
  assert.equal(emit.text, "The Town Square welcomes you.");
  assert.equal(emit.actorName, "Town Square", "the ROOM is the speaking object");
});
