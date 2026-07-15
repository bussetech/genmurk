// Styled output (GM-R13) — the sanitizer and the renderer, asserted on
// EXACT BYTES. The contract under test: markup tokens are the only way
// player text influences presentation; ANSI escape bytes exist only on the
// far side of the renderer's fixed SGR table; raw control bytes never
// survive the boundary, whatever path smuggled them in.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_STYLE_DEPTH,
  renderMarkup,
  sanitizeOutbound,
  sanitizeText,
} from "../../src/server/style.ts";
import { run } from "./helpers.ts";

const ESC = "\u001b";

// ---------------------------------------------------------------- sanitizer

test("sanitizeText strips ESC, C0, DEL, and C1 — keeps \\n and \\t", () => {
  assert.equal(sanitizeText(`${ESC}[31mred`), "[31mred");
  assert.equal(sanitizeText("a\u0000\u0007\u0008bcd"), "abcd");
  assert.equal(sanitizeText("a\u009bCSI"), "aCSI"); // 8-bit CSI (C1)
  assert.equal(sanitizeText("line1\nline2\tend"), "line1\nline2\tend");
});

test("stripping is deletion, not replacement — no marker to build a second payload around", () => {
  // interleaved: removing ESC must not splice a new escape together… and it
  // doesn't matter if it does, because the result is re-scanned nowhere and
  // contains no control byte either way
  const s = sanitizeText(`${ESC}${ESC}[31m`);
  assert.ok(!s.includes(ESC));
});

test("sanitizeOutbound cleans every string field of a frame, recursively", () => {
  const frame = {
    type: "event",
    room: "#10",
    roomSeq: 3,
    kind: "emit",
    actor: "#104",
    actorName: `gong${ESC}]0;owned${ESC}\\`,
    text: `${ESC}[2Jwiped [[bold]]but styled[[/]]`,
  };
  const wire = JSON.stringify(sanitizeOutbound(frame));
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u009F]/.test(wire), "no control byte on the wire");
  assert.ok(wire.includes("[[bold]]but styled[[/]]"), "markup tokens survive as inert data");
  const parsed = JSON.parse(wire) as { roomSeq: number };
  assert.equal(parsed.roomSeq, 3, "non-string fields untouched");
});

// ----------------------------------------------------------------- renderer

test("legitimate styling renders: exact SGR bytes from the fixed table", () => {
  assert.equal(renderMarkup("[[bold]]hi[[/]]", { ansi: true }), `${ESC}[1mhi${ESC}[0m`);
  assert.equal(
    renderMarkup("[[color:red]]a[[bold]]b[[/]]c[[/]]", { ansi: true }),
    `${ESC}[31ma${ESC}[1mb${ESC}[0m${ESC}[31mc${ESC}[0m`,
    "closing an inner style recomputes the outer state",
  );
});

test("plain mode strips tokens to a clean transcript", () => {
  assert.equal(renderMarkup("[[bold]]hi[[/]] there", { ansi: false }), "hi there");
});

test("an unterminated style cannot bleed into the next line", () => {
  assert.equal(renderMarkup("[[color:red]]stuck", { ansi: true }), `${ESC}[31mstuck${ESC}[0m`);
});

// ------------------------------------------------------- escape fixtures

test("escape fixture: unknown specs are dropped tokens, inner text intact", () => {
  assert.equal(renderMarkup("[[blink]]x[[/]]", { ansi: true }), "x");
  assert.equal(renderMarkup("[[color:zalgo]]x[[/]]", { ansi: true }), "x");
});

test("escape fixture: an unmatched close is a dropped token", () => {
  assert.equal(renderMarkup("[[/]]clean", { ansi: true }), "clean");
});

test("escape fixture: raw ESC in the text never reaches the output", () => {
  const out = renderMarkup(`${ESC}[31mfake [[bold]]real[[/]]`, { ansi: true });
  assert.equal(out, `[31mfake ${ESC}[1mreal${ESC}[0m`);
});

test("escape fixture: token-SHAPED text that is not a token passes as plain text", () => {
  assert.equal(renderMarkup("[[Hello World]]", { ansi: true }), "[[Hello World]]");
  assert.equal(renderMarkup("[[BOLD]]", { ansi: true }), "[[BOLD]]");
});

test("escape fixture: a nesting flood is capped — opens beyond the depth are dropped", () => {
  const flood = "[[bold]]".repeat(40) + "x" + "[[/]]".repeat(40);
  const out = renderMarkup(flood, { ansi: true });
  // only MAX_STYLE_DEPTH opens took effect: the deepest SGR state carries at
  // most that many codes, and total escape output is bounded by the cap
  // (each real open emits one sequence; each real close at most two), so 40
  // nested opens cannot make the renderer amplify
  const deepest = Math.max(
    ...[...out.matchAll(/\u001b\[([0-9;]*)m/g)].map((m) => m[1]!.split(";").length),
  );
  assert.ok(deepest <= MAX_STYLE_DEPTH, `state never grows past the cap (saw ${deepest})`);
  const escCount = out.split(ESC).length - 1;
  assert.ok(escCount <= 3 * MAX_STYLE_DEPTH, `escape output bounded (saw ${escCount})`);
  assert.ok(out.includes("x"));
  assert.ok(out.endsWith(`${ESC}[0m`), "always reset at the end");
});

// ------------------------------------- the engine side of the same contract

test("out.style emits tokens; a spec that could smuggle syntax is a typed refusal", () => {
  const ok = run('out.emit(out.style("hello", "color:red"))');
  assert.equal(ok.outcome.status, "completed");
  assert.deepEqual(ok.outcome.output, ["[[color:red]]hello[[/]]"]);

  for (const spec of ["31;42", "bold]]sneak", "Bold", "color red", ""]) {
    const bad = run(`out.emit(out.style("x", ${JSON.stringify(spec)}))`);
    assert.equal(bad.outcome.status, "refused", `spec ${JSON.stringify(spec)}`);
    assert.equal(bad.outcome.refusalCode, "INVALID_PROGRAM");
  }
});

test("softcode cannot construct an escape byte: engine strings are data, the boundary strips", () => {
  // there is no chr()/unichr-class function in the library — an ESC can only
  // arrive as literal attribute data, and then the wire boundary deletes it
  const { outcome } = run(`out.emit("${ESC}[31mngineered")`);
  assert.equal(outcome.status, "completed");
  const wire = JSON.stringify(sanitizeOutbound({ type: "event", text: outcome.output[0] }));
  assert.ok(!wire.includes(ESC));
});
