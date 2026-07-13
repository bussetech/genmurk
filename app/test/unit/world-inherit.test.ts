// Attribute inheritance (GM-R9): resolution order is own-wins, then up the
// parent chain to the first ancestor that has the attribute; a no_inherit
// ancestor attribute does not pass down.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAttr } from "../../src/world/inherit.ts";
import { buildSnapshot } from "../world/build.ts";

const snap = buildSnapshot({
  "#1": {
    name: "base",
    attrs: {
      DESC: "base description",
      SIZE: { value: "big", noInherit: true }, // present on self, blocked from children
    },
  },
  "#2": { name: "mid", parent: "#1", attrs: { COLOR: "red" } },
  "#3": { name: "leaf", parent: "#2", attrs: { DESC: "leaf description" } },
});

test("an object's own attribute wins over the parent chain", () => {
  const r = resolveAttr(snap, "#3", "DESC");
  assert.equal(r?.value, "leaf description");
  assert.equal(r?.inherited, false);
  assert.equal(r?.holderId, "#3");
});

test("an attribute is inherited from the nearest ancestor that has it", () => {
  const r = resolveAttr(snap, "#3", "COLOR");
  assert.equal(r?.value, "red");
  assert.equal(r?.inherited, true);
  assert.equal(r?.holderId, "#2");
});

test("a no_inherit ancestor attribute does NOT pass down", () => {
  assert.equal(resolveAttr(snap, "#3", "SIZE"), null);
  assert.equal(resolveAttr(snap, "#2", "SIZE"), null);
});

test("a no_inherit attribute is still readable on the object that owns it", () => {
  const r = resolveAttr(snap, "#1", "SIZE");
  assert.equal(r?.value, "big");
  assert.equal(r?.inherited, false);
});

test("a missing attribute resolves to null (walk is bounded)", () => {
  assert.equal(resolveAttr(snap, "#3", "NOPE"), null);
});

test("case-insensitive attribute names", () => {
  assert.equal(resolveAttr(snap, "#3", "desc")?.value, "leaf description");
});
