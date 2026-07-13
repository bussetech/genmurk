// Parser contract: what the grammar admits, what it refuses, and the
// bounded-by-construction properties (input cap, nesting cap).

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, value, refusal, BUDGET } from "./helpers.ts";
import { PROGRAM_MAX_CHARS, PARSE_DEPTH_MAX } from "../../src/engine/parse.ts";

test("statement lists run in order; last value wins as the body result", () => {
  const { outcome } = run('out.emit("a"); out.emit("b")');
  assert.deepEqual(outcome.output, ["a", "b"]);
});

test("string literals support escaped quotes and backslashes", () => {
  assert.equal(value('str.length("a\\"b")'), "3");
  assert.equal(value('str.length("a\\\\b")'), "3");
});

test("dbref and negative/decimal number literals", () => {
  assert.equal(value("str.length(#900)"), "4");
  assert.equal(value("num.add(-1.5, 0.5)"), "-1");
});

test("registers beyond the supplied args are empty strings", () => {
  assert.equal(value("str.length(%7)"), "0");
  assert.equal(value("str.concat(%0, %1)", { args: ["a", "b"] }), "ab");
});

test("bare identifiers are INVALID_PROGRAM (globalThis-shaped probes)", () => {
  const { outcome } = run("globalThis");
  assert.equal(outcome.refusalCode, "INVALID_PROGRAM");
});

test("call results are not callable", () => {
  const { outcome } = run('t.noop()()');
  assert.equal(outcome.refusalCode, "INVALID_PROGRAM");
});

test("unterminated strings, stray '%', trailing garbage all refuse", () => {
  assert.equal(run('out.emit("oops').outcome.refusalCode, "INVALID_PROGRAM");
  assert.equal(run("out.emit(%x)").outcome.refusalCode, "INVALID_PROGRAM");
  assert.equal(run("t.noop() t.noop()").outcome.refusalCode, "INVALID_PROGRAM");
});

test("input longer than the program cap refuses before any work", () => {
  const big = `out.emit("${"a".repeat(PROGRAM_MAX_CHARS)}")`;
  const { outcome } = run(big);
  assert.equal(outcome.refusalCode, "INVALID_PROGRAM");
  assert.equal(outcome.stepsUsed, 0);
});

test("nesting beyond the parse depth cap refuses (host stack never at risk)", () => {
  const depth = PARSE_DEPTH_MAX + 1;
  const program = "str.length(".repeat(depth) + '"x"' + ")".repeat(depth);
  const { outcome } = run(program);
  assert.equal(outcome.refusalCode, "INVALID_PROGRAM");
});

test("nesting at the cap is legal work", () => {
  const program = "str.length(".repeat(PARSE_DEPTH_MAX) + '"x"' + ")".repeat(PARSE_DEPTH_MAX);
  const { outcome } = run(program, { budget: { steps: BUDGET.steps } });
  assert.equal(outcome.status, "completed");
});
