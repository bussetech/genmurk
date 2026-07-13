// Name resolution (GM-R12): me / here / #dbref / partial names, always
// scoped to what the actor can see.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorld } from "../world/build.ts";

const w = buildWorld({
  "#0": { type: "room", name: "Town Square", location: null },
  "#1": { type: "player", name: "Alice", location: "#0" },
  "#2": { type: "player", name: "Bob", location: "#0" },
  "#5": { type: "thing", name: "a brass lantern", owner: "#1", location: "#0" },
  "#6": { type: "thing", name: "a lamp", owner: "#1", location: "#1" }, // Alice's inventory
  "#9": { type: "thing", name: "faraway gem", owner: "#7", location: "#99" }, // another's, elsewhere — not in scope
});

test("me and here", () => {
  assert.deepEqual(w.resolveName("#1", "me"), { status: "ok", id: "#1" });
  assert.deepEqual(w.resolveName("#1", "here"), { status: "ok", id: "#0" });
});

test("absolute dbref resolves only when visible", () => {
  assert.deepEqual(w.resolveName("#1", "#5"), { status: "ok", id: "#5" });
  assert.deepEqual(w.resolveName("#1", "#9"), { status: "none" }); // out of scope
});

test("partial (substring) name matching within scope", () => {
  assert.deepEqual(w.resolveName("#1", "lantern"), { status: "ok", id: "#5" });
  assert.deepEqual(w.resolveName("#1", "lamp"), { status: "ok", id: "#6" }); // inventory
  assert.deepEqual(w.resolveName("#1", "Bob"), { status: "ok", id: "#2" });
});

test("exact match wins over ambiguity", () => {
  const w2 = buildWorld({
    "#0": { type: "room", name: "Room", location: null },
    "#1": { type: "player", name: "Alice", location: "#0" },
    "#5": { type: "thing", name: "lamp", owner: "#1", location: "#0" },
    "#6": { type: "thing", name: "lamplight", owner: "#1", location: "#0" },
  });
  // "lamp" is an EXACT hit on #5 even though it is also a substring of #6
  assert.deepEqual(w2.resolveName("#1", "lamp"), { status: "ok", id: "#5" });
  // "lam" is a substring of both → ambiguous
  assert.deepEqual(w2.resolveName("#1", "lam"), { status: "ambiguous" });
});

test("unknown token resolves to none", () => {
  assert.deepEqual(w.resolveName("#1", "dragon"), { status: "none" });
});

test("a co-located player cannot resolve an out-of-room object", () => {
  // Bob shares the room, so he sees #5 but not the faraway gem
  assert.deepEqual(w.resolveName("#2", "lantern"), { status: "ok", id: "#5" });
  assert.deepEqual(w.resolveName("#2", "faraway"), { status: "none" });
});
