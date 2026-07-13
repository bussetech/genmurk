// The world-API permission model: visibility, the attribute read gate,
// buffered mutations, and movement with containment-cycle refusal. This is
// the SECOND GM-R14 wall (the engine sandbox is the first, RLS the third).

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildWorld } from "../world/build.ts";
import type { WorldRefusal } from "../../src/engine/types.ts";

function refused(v: unknown): v is WorldRefusal {
  return typeof v === "object" && v !== null && "refused" in v;
}

function scene() {
  return buildWorld({
    "#0": { type: "room", name: "Town Square", location: null },
    "#1": { type: "player", name: "Alice", location: "#0", power: "builder" },
    "#2": { type: "player", name: "Cara", location: "#0", power: "player" },
    "#3": { type: "room", name: "Dark Cave", location: null },
    "#5": {
      type: "thing",
      name: "a brass lantern",
      owner: "#1",
      location: "#0",
      attrs: { DESC: { value: "A polished brass lantern.", visual: true }, SECRET: "vault 4771" },
    },
    "#9": { type: "thing", name: "a gem", owner: "#2", location: "#3" }, // in the cave
  });
}

test("visual attributes are readable by co-located viewers; non-visual are not", () => {
  const w = scene();
  assert.equal(w.getAttr("#1", "#5", "DESC"), "A polished brass lantern."); // owner
  assert.equal(w.getAttr("#2", "#5", "DESC"), "A polished brass lantern."); // co-located, visual
  assert.equal(w.getAttr("#1", "#5", "SECRET"), "vault 4771"); // owner sees non-visual
  assert.ok(refused(w.getAttr("#2", "#5", "SECRET"))); // co-located, non-visual → denied
});

test("reads across rooms are denied (a player sees the room, not the database)", () => {
  const w = scene();
  assert.ok(refused(w.getAttr("#1", "#9", "DESC"))); // #9 is in the cave
  assert.ok(refused(w.name("#1", "#9")));
});

test("owner reads a missing attribute as empty; a non-owner cannot probe", () => {
  const w = scene();
  assert.equal(w.getAttr("#1", "#5", "MISSING"), "");
  assert.ok(refused(w.getAttr("#2", "#5", "MISSING")));
});

test("setAttr requires control and journals a mutation", () => {
  const w = scene();
  assert.equal(w.setAttr("#1", "#5", "MOOD", "warm"), true);
  assert.equal(w.getAttr("#1", "#5", "MOOD"), "warm");
  assert.deepEqual(w.mutations, [{ op: "setAttr", target: "#5", detail: "MOOD=warm" }]);
  // Cara does not control the lantern
  assert.ok(refused(w.setAttr("#2", "#5", "MOOD", "cold")));
  assert.equal(w.mutations.length, 1); // no new mutation
});

test("name and location respect visibility", () => {
  const w = scene();
  assert.equal(w.name("#1", "#5"), "a brass lantern");
  assert.equal(w.location("#1", "#5"), "#0");
});

test("visibleObjects returns exactly what the actor may see", () => {
  const w = scene();
  const alice = w.visibleObjects("#1").map((o) => o.id).sort();
  assert.deepEqual(alice, ["#0", "#1", "#2", "#5"]); // room, self, co-located Cara, own lantern
  assert.ok(!alice.includes("#9")); // the cave gem is out of scope
});

test("a wizard sees across rooms", () => {
  const w = buildWorld({
    "#0": { type: "room", name: "Town", location: null },
    "#1": { type: "player", name: "Merlin", location: "#0", power: "wizard" },
    "#3": { type: "room", name: "Cave", location: null },
    "#9": { type: "thing", name: "a gem", owner: "#9", location: "#3" },
  });
  assert.equal(w.name("#1", "#9"), "a gem"); // wizard sees the cave gem
});

test("movement journals a mutation and updates the snapshot", () => {
  const w = scene();
  assert.equal(w.move("#1", "#1", "#3"), true); // Alice walks to the cave
  assert.deepEqual(w.mutations, [{ op: "move", target: "#1", detail: "#0->#3" }]);
  // now co-located with the gem in the cave
  assert.equal(w.name("#1", "#9"), "a gem");
});

test("a containment cycle is refused", () => {
  const w = buildWorld({
    "#0": { type: "room", name: "Room", location: null },
    "#1": { type: "player", name: "Alice", location: "#0", power: "builder" },
    "#5": { type: "thing", name: "a box", owner: "#1", location: "#0" },
    "#6": { type: "thing", name: "a bag", owner: "#1", location: "#5" }, // bag is in the box
  });
  // putting the box inside the bag would make the box contain itself
  assert.ok(refused(w.move("#1", "#5", "#6")));
});
