// ROOM SCOPING & THE SPEECH VERBS' MECHANICS (GM-R1..R3, acceptance
// criterion 2): speech reaches exactly the speaker's room occupants (zero
// events to other rooms — zero at the server, not filtered client-side);
// movement is a channel switch; page/whisper cross rooms to exactly the
// named player; announce is gated on the capability tier and reaches
// everyone. Verb names here are the pre-capture placeholders (verbs.ts).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { ServerHandle } from "../../src/server/server.ts";
import { fixtureServer, TestClient, TOWN, CAVE } from "./helpers.ts";

let server: ServerHandle;
let alice: TestClient; // builder, Town
let bob: TestClient; // player, Town
let wanda: TestClient; // wizard, Town
let zoe: TestClient; // player, Cave

before(async () => {
  server = await fixtureServer();
  alice = await TestClient.connect(server.port, "Alice");
  bob = await TestClient.connect(server.port, "Bob");
  wanda = await TestClient.connect(server.port, "Wanda");
  zoe = await TestClient.connect(server.port, "Zoe");
});

after(async () => {
  for (const c of [alice, bob, wanda, zoe]) c.close();
  await server.close();
});

test("say/emote reach exactly the room's occupants (GM-R2)", async () => {
  alice.command("say hello town");
  alice.command("emote waves");
  await bob.waitFor((m) => m.type === "event" && m.kind === "emote");
  await wanda.waitFor((m) => m.type === "event" && m.kind === "emote");

  const bobSaw = bob.events().filter((e) => e.kind === "say" || e.kind === "emote");
  assert.deepEqual(
    bobSaw.map((e) => `${e.kind}:${e.text}`),
    ["say:hello town", "emote:waves"],
  );
  // the speaker hears their own speech through the same ordered stream
  const aliceSaw = alice.events().filter((e) => e.kind === "say" || e.kind === "emote");
  assert.equal(aliceSaw.length, 2);
  // Zoe (Echo Cave): ZERO speech events — not "events she ignores"
  assert.equal(zoe.events().filter((e) => e.kind === "say" || e.kind === "emote").length, 0);
});

test("movement is a channel switch: depart to the old room, arrive to the new (GM-R1/GM-R6)", async () => {
  const zoeBase = zoe.events().length;
  const bobBase = bob.events().length;

  alice.command("go north"); // Town -> Echo Cave
  await zoe.waitFor((m) => m.type === "event" && m.kind === "arrive" && m.actorName === "Alice");
  await bob.waitFor((m) => m.type === "event" && m.kind === "depart" && m.actorName === "Alice");

  // Bob (Town) saw the depart in Town's stream; Zoe (Cave) saw the arrive in
  // the Cave's stream — and neither saw the other room's half
  const bobNew = bob.events().slice(bobBase);
  const zoeNew = zoe.events().slice(zoeBase);
  assert.ok(bobNew.every((e) => e.room === TOWN));
  assert.ok(zoeNew.every((e) => e.room === CAVE));

  // Alice now speaks in the Cave: Zoe hears, Town does not
  const bobBase2 = bob.events().length;
  alice.command("say hello cave");
  await zoe.waitFor((m) => m.type === "event" && m.kind === "say" && m.text === "hello cave");
  assert.equal(bob.events().slice(bobBase2).filter((e) => e.kind === "say").length, 0);

  // walk back for the later tests
  alice.command("go south");
  await bob.waitFor((m) => m.type === "event" && m.kind === "arrive" && m.actorName === "Alice");
});

test("page and whisper cross rooms to exactly the named player (GM-R3)", async () => {
  alice.command("page Zoe are you there?");
  await zoe.waitFor((m) => m.type === "message" && m.kind === "page");
  const page = zoe.received.find((m) => m.type === "message" && m.kind === "page");
  assert.ok(page && page.type === "message");
  assert.equal(page.fromName, "Alice");
  assert.equal(page.text, "are you there?");

  zoe.command("whisper Alice yes, from the cave");
  await alice.waitFor((m) => m.type === "message" && m.kind === "whisper");

  // nobody else received a directed message
  assert.equal(bob.received.filter((m) => m.type === "message").length, 0);
  assert.equal(wanda.received.filter((m) => m.type === "message").length, 0);

  // a directed message to a not-connected player is a clean error
  alice.command("page Nobody hello?");
  await alice.waitFor((m) => m.type === "error" && m.code === "NO_SUCH_PLAYER");
});

test("announce is a privileged act: wizard reaches every room, player is refused (GM-R3)", async () => {
  // Bob (player tier) is refused, and NOBODY receives an event
  const counts = [alice, bob, wanda, zoe].map((c) => c.events().length);
  bob.command("announce pay no attention");
  await bob.waitFor((m) => m.type === "error" && m.code === "PERMISSION_DENIED");
  assert.deepEqual(
    [alice, bob, wanda, zoe].map((c) => c.events().length),
    counts,
    "a refused announce must produce zero events",
  );

  // Wanda (wizard tier) reaches both rooms
  wanda.command("announce the world is settling");
  await Promise.all(
    [alice, bob, wanda, zoe].map((c) =>
      c.waitFor((m) => m.type === "event" && m.kind === "announce"),
    ),
  );
  const zoeAnnounce = zoe.events().find((e) => e.kind === "announce");
  assert.ok(zoeAnnounce);
  assert.equal(zoeAnnounce.room, CAVE, "announce enters each room's own ordering domain");
});

test("presence is observable: look shows who is here (GM-R1)", async () => {
  const infosBefore = alice.received.filter((m) => m.type === "info").length;
  alice.command("look");
  await alice.waitFor((m) => m.type === "info", infosBefore + 1);
  const info = alice.received.filter((m) => m.type === "info").pop();
  assert.ok(info && info.type === "info");
  assert.match(info.text, /Town Square/);
  assert.match(info.text, /Alice/);
  assert.match(info.text, /Bob/);
  assert.match(info.text, /Wanda/);
  assert.doesNotMatch(info.text, /Zoe/);
});
