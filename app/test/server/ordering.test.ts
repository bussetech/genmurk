// THE ORDERING PROOF (GM-R4, acceptance criterion 1): N simulated clients in
// one room, concurrent speakers on separate sockets, and every observer must
// see the SAME events in the SAME order — 50 rounds in one CI run, plus a
// round that interleaves movement (arrive/depart) with speech so presence
// and speech are proven to share one ordering domain. The mechanism under
// test is the coordinator's single-writer-per-room fan-out
// (src/server/coordinator.ts `roomEvent`); its documentation of record is
// app/docs/presence-transport.md.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { ServerHandle } from "../../src/server/server.ts";
import { fixtureServer, TestClient, TOWN, eventKey } from "./helpers.ts";

const ROUNDS = 50;
const SPEAKERS = 3; // Alice, Bob, Cara — all on their own sockets
const MESSAGES_PER_SPEAKER = 5;

let server: ServerHandle;
let alice: TestClient;
let bob: TestClient;
let cara: TestClient;
let wanda: TestClient; // silent observer in Town
let zoe: TestClient; // outsider in the Cave — must hear NOTHING of Town

before(async () => {
  server = await fixtureServer();
  alice = await TestClient.connect(server.port, "Alice");
  bob = await TestClient.connect(server.port, "Bob");
  cara = await TestClient.connect(server.port, "Cara");
  wanda = await TestClient.connect(server.port, "Wanda");
  zoe = await TestClient.connect(server.port, "Zoe");
  // settle the arrive burst: everyone in Town has seen all four arrivals
  // (each client sees its own arrive plus every later one)
  await wanda.waitFor((m) => m.type === "event" && m.kind === "arrive");
});

after(async () => {
  for (const c of [alice, bob, cara, wanda, zoe]) c.close();
  await server.close();
});

test(`all Town observers see the identical order — ${ROUNDS} concurrent rounds`, async () => {
  const observers = [alice, bob, cara, wanda];

  for (let round = 0; round < ROUNDS; round++) {
    const baseline = observers.map((o) => o.events().filter((e) => e.kind === "say").length);
    const expectTotal = SPEAKERS * MESSAGES_PER_SPEAKER;

    // fire all speakers' messages without awaiting anything between sends —
    // three sockets racing into the server
    for (let i = 0; i < MESSAGES_PER_SPEAKER; i++) {
      alice.command(`say r${round} alice ${i}`);
      bob.command(`say r${round} bob ${i}`);
      cara.command(`say r${round} cara ${i}`);
    }

    await Promise.all(
      observers.map((o, idx) =>
        o.waitFor((m) => m.type === "event" && m.kind === "say", baseline[idx]! + expectTotal),
      ),
    );

    const sequences = observers.map((o) =>
      o
        .events()
        .filter((e) => e.kind === "say")
        .map(eventKey),
    );
    for (let i = 1; i < sequences.length; i++) {
      assert.deepEqual(
        sequences[i],
        sequences[0],
        `round ${round}: observer ${i} saw a different order than observer 0`,
      );
    }
  }

  // roomSeq is strictly monotonic per room for every observer
  for (const o of observers) {
    const town = o.events().filter((e) => e.room === TOWN);
    for (let i = 1; i < town.length; i++) {
      assert.ok(
        town[i]!.roomSeq > town[i - 1]!.roomSeq,
        `roomSeq must be strictly increasing (${town[i - 1]!.roomSeq} → ${town[i]!.roomSeq})`,
      );
    }
  }
});

test("presence and speech share one ordering domain — movement interleaved with says", async () => {
  const observers = [alice, bob, wanda];
  const baseline = observers.map((o) => o.events().length);

  // Cara walks out (depart) and back (arrive) while Alice and Bob keep
  // talking — all on separate sockets, no coordination
  alice.command("say mixed alice 1");
  cara.command("go north");
  bob.command("say mixed bob 1");
  alice.command("say mixed alice 2");
  cara.command("go south");
  bob.command("say mixed bob 2");

  // Town observers each see 6 new events: 4 says + Cara's depart + arrive
  await Promise.all(
    observers.map((o, idx) => o.waitFor((m) => m.type === "event", baseline[idx]! + 6)),
  );

  const sequences = observers.map((o, idx) => o.events().slice(baseline[idx]).map(eventKey));
  for (let i = 1; i < sequences.length; i++) {
    assert.deepEqual(
      sequences[i],
      sequences[0],
      `observer ${i} saw a different interleaving of speech and presence than observer 0`,
    );
  }
  // and the stream really does contain both kinds
  const kinds = new Set(observers[0]!.events().slice(baseline[0]).map((e) => e.kind));
  assert.ok(kinds.has("say") && kinds.has("depart") && kinds.has("arrive"), `got kinds: ${[...kinds]}`);
});

test("the outsider heard none of it — zero Town events, not filtered client-side", () => {
  const townEvents = zoe.events().filter((e) => e.room === TOWN);
  assert.equal(
    townEvents.length,
    0,
    `Zoe (Echo Cave) must receive ZERO Town events; got ${townEvents.length}`,
  );
  // Zoe's stream holds only her own Cave arrivals + Cara's brief visit
  for (const e of zoe.events()) {
    assert.notEqual(e.room, TOWN);
  }
});
