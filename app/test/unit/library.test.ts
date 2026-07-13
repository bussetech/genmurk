// Unit contract tests for the v1 function library
// (app/docs/function-library-v1.md): every class, happy paths and typed
// refusals. Budget-charging is covered by meter.test.ts and the pack.

import { test } from "node:test";
import assert from "node:assert/strict";
import { run, value, refusal } from "./helpers.ts";

// ── 1. string ────────────────────────────────────────────────────────────

test("str.concat joins arguments", () => {
  assert.equal(value('str.concat("a", "b", "c")'), "abc");
});

test("str.length counts characters", () => {
  assert.equal(value('str.length("hello")'), "5");
  assert.equal(value('str.length("")'), "0");
});

test("str.slice clamps out-of-range instead of erroring", () => {
  assert.equal(value('str.slice("hello", 1, 3)'), "ell");
  assert.equal(value('str.slice("hello", 4, 100)'), "o");
  assert.equal(value('str.slice("hello", 99)'), "");
});

test("str.replace replaces all occurrences, literally", () => {
  assert.equal(value('str.replace("a.a.a", ".", "-")'), "a-a-a");
  assert.equal(value('str.replace("aaa", "", "x")'), "aaa");
});

test("str.upper / str.lower / str.trim", () => {
  assert.equal(value('str.upper("abc")'), "ABC");
  assert.equal(value('str.lower("ABC")'), "abc");
  assert.equal(value('str.trim("  x  ")'), "x");
});

test("str.repeat repeats; refuses a non-count", () => {
  assert.equal(value('str.repeat("ab", 3)'), "ababab");
  assert.equal(refusal('str.repeat("ab", -1)'), "INVALID_PROGRAM");
  assert.equal(refusal('str.repeat("ab", "x")'), "INVALID_PROGRAM");
});

// ── 2. list ──────────────────────────────────────────────────────────────

test("list.item is 1-based; out of range is empty", () => {
  assert.equal(value('list.item("a b c", 2)'), "b");
  assert.equal(value('list.item("a b c", 9)'), "");
});

test("list.count and list.append with default and custom delimiters", () => {
  assert.equal(value('list.count("a b c")'), "3");
  assert.equal(value('list.count("a|b", "|")'), "2");
  assert.equal(value('list.append("a b", "c")'), "a b c");
  assert.equal(value('list.append("", "c")'), "c");
});

test("list.map evaluates an own attribute per element with %0 bound", () => {
  const world = {
    objects: { "#1": { owner: "#1", attrs: { DOUBLE: "num.mul(%0, 2)" } } },
  };
  assert.equal(value('list.map("1 2 3", "DOUBLE")', { world }), "2 4 6");
});

test("list.filter keeps elements whose function result is truthy", () => {
  const world = {
    objects: { "#1": { owner: "#1", attrs: { ODD: "num.mod(%0, 2)" } } },
  };
  assert.equal(value('list.filter("1 2 3 4", "ODD")', { world }), "1 3");
});

// ── 3. arithmetic & logic ────────────────────────────────────────────────

test("num arithmetic on numeric strings", () => {
  assert.equal(value("num.add(1, 2)"), "3");
  assert.equal(value("num.sub(1, 2)"), "-1");
  assert.equal(value("num.mul(3, 4)"), "12");
  assert.equal(value("num.div(1, 2)"), "0.5");
  assert.equal(value("num.mod(7, 3)"), "1");
  assert.equal(value("num.cmp(1, 2)"), "-1");
  assert.equal(value("num.cmp(2, 2)"), "0");
});

test("division and modulo by zero are typed refusals, never crashes", () => {
  assert.equal(refusal("num.div(1, 0)"), "INVALID_PROGRAM");
  assert.equal(refusal("num.mod(1, 0)"), "INVALID_PROGRAM");
});

test("non-numeric arithmetic input is a typed refusal", () => {
  assert.equal(refusal('num.add("x", 1)'), "INVALID_PROGRAM");
});

test("bool functions coerce by numeric truthiness", () => {
  assert.equal(value("bool.and(1, 1)"), "1");
  assert.equal(value("bool.and(1, 0)"), "0");
  assert.equal(value("bool.or(0, 2)"), "1");
  assert.equal(value("bool.not(0)"), "1");
  assert.equal(value('bool.not("x")'), "1"); // non-numeric is falsy
});

// ── 4. object & attribute ────────────────────────────────────────────────

test("obj.getAttr reads own attributes; unset reads are empty", () => {
  const world = { objects: { "#1": { owner: "#1", attrs: { FOO: "bar" } } } };
  assert.equal(value('obj.getAttr(me, "FOO")', { world }), "bar");
  assert.equal(value('obj.getAttr(me, "NOPE")', { world }), "");
});

test("obj.setAttr journals a mutation; foreign writes refuse untouched", () => {
  const ok = run('obj.setAttr(me, "X", "1")');
  assert.equal(ok.outcome.status, "completed");
  assert.deepEqual(ok.world.mutations, [{ op: "setAttr", target: "#1", detail: "X=1" }]);

  const denied = run('obj.setAttr(#2, "X", "1")');
  assert.equal(denied.outcome.refusalCode, "PERMISSION_DENIED");
  assert.equal(denied.world.mutations.length, 0);
});

test("obj.name and obj.location resolve via the WorldAPI", () => {
  const world = {
    objects: { "#1": { owner: "#1", attrs: { NAME: "Tester", LOCATION: "#7" } } },
  };
  assert.equal(value("obj.name(me)", { world }), "Tester");
  assert.equal(value("obj.location(me)", { world }), "#7");
});

test("obj.resolve: me, #dbref, exact and partial names, no-match", () => {
  const world = {
    objects: { "#5": { owner: "#1", attrs: { NAME: "Brass Lantern" } } },
  };
  assert.equal(value('obj.resolve("me")', { world }), "#1");
  assert.equal(value('obj.resolve("#42")', { world }), "#42");
  assert.equal(value('obj.resolve("brass lantern")', { world }), "#5");
  assert.equal(value('obj.resolve("brass")', { world }), "#5");
  assert.equal(value('obj.resolve("zzz")', { world }), "");
});

test("obj.callAttr passes args as registers and returns the body's value", () => {
  const world = {
    objects: { "#1": { owner: "#1", attrs: { GREET: 'str.concat("hi ", %0)' } } },
  };
  assert.equal(value('obj.callAttr(me, "GREET", "there")', { world }), "hi there");
});

// ── 5. control ───────────────────────────────────────────────────────────

test("ctl.if is lazy: the untaken branch never runs", () => {
  const { outcome } = run('ctl.if(1, out.emit("yes"), out.emit("no"))');
  assert.deepEqual(outcome.output, ["yes"]);
});

test("ctl.switch matches wildcards in order; default when nothing matches", () => {
  assert.equal(value('ctl.switch("hello", "h*", "1", "2")'), "1");
  assert.equal(value('ctl.switch("hello", "x*", "1", "z?z", "2", "fallback")'), "fallback");
});

test("ctl.iter binds %0 per element", () => {
  const { outcome } = run('ctl.iter("a b", "out.emit(%0)")');
  assert.deepEqual(outcome.output, ["a", "b"]);
});

test("ctl.eval is the only deliberate re-evaluation path", () => {
  const world = {
    objects: { "#1": { owner: "#1", attrs: { P: 'out.emit("ran")' } } },
  };
  const { outcome } = run('ctl.eval(obj.getAttr(me, "P"))', { world });
  assert.deepEqual(outcome.output, ["ran"]);
});

// ── 6. output & styling ──────────────────────────────────────────────────

test("out.style wraps in markup tokens; raw escape bytes are impossible", () => {
  assert.equal(value('out.style("hi", "b")'), "[[b]]hi[[/]]");
  assert.equal(refusal('out.style("hi", "[31m")'), "INVALID_PROGRAM");
});

// ── unknown names ────────────────────────────────────────────────────────

test("names outside the frozen table are UNKNOWN_FUNCTION", () => {
  assert.equal(refusal("no.suchFn(1)"), "UNKNOWN_FUNCTION");
});
