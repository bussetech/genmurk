// GM-R12 matcher mechanics: glob semantics, captures, case-insensitivity,
// and the sandbox property — match units charge fuel.

import { test } from "node:test";
import assert from "node:assert/strict";
import { globMatch } from "../../src/engine/match.ts";
import { Meter } from "../../src/engine/meter.ts";
import { BUDGET } from "./helpers.ts";

const meter = () => new Meter({ ...BUDGET, steps: 1000000 });

test("literal, star, and question-mark matching", () => {
  assert.equal(globMatch("hello", "hello", meter()).matched, true);
  assert.equal(globMatch("hello", "world", meter()).matched, false);
  assert.equal(globMatch("h*o", "hello", meter()).matched, true);
  assert.equal(globMatch("h?llo", "hello", meter()).matched, true);
  assert.equal(globMatch("h?llo", "hllo", meter()).matched, false);
  assert.equal(globMatch("*", "", meter()).matched, true);
  assert.equal(globMatch("", "", meter()).matched, true);
  assert.equal(globMatch("", "x", meter()).matched, false);
});

test("matching is case-insensitive; captures keep original case", () => {
  const r = globMatch("get *", "GET Lantern", meter());
  assert.equal(r.matched, true);
  assert.deepEqual(r.captures, ["Lantern"]);
});

test("captures come back in pattern order (stars and question marks)", () => {
  const r = globMatch("?ut * in *", "put fish in basket", meter());
  assert.equal(r.matched, true);
  assert.deepEqual(r.captures, ["p", "fish", "basket"]);
});

test("star runs collapse; backtracking still matches", () => {
  assert.equal(globMatch("a**b", "axxb", meter()).matched, true);
  assert.equal(globMatch("*a*b*", "xaxbx", meter()).matched, true);
});

test("match work charges fuel — a hostile pattern exhausts the budget", () => {
  const tight = new Meter({ ...BUDGET, steps: 100 });
  assert.throws(
    () => globMatch("*a*a*a*b", "a".repeat(10000), tight),
    /STEP_BUDGET_EXCEEDED/,
  );
});
