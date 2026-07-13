// Lexer + recursive-descent parser for GenMURK softcode. Bounded by
// construction: input length is capped, nesting depth is capped (a
// recursive-descent parser fed unbounded nesting is a host-stack crash —
// found while building, fixture 20), and parse work charges the meter in
// character-block units (design record §2/§3; granularity delta in §9).
//
// Substitution registers (%0..%9) lex to a dedicated token and parse to a
// dedicated AST leaf. Expansion happens at EVALUATION, to the register's
// string VALUE — never as a textual splice into source — which is what makes
// expanded data inert (fixture 19; design delta §9.1).

import { RefusalSignal } from "./refusal.ts";
import type { Meter } from "./meter.ts";

/** Hard cap on any parsed program text (input lines, attr bodies, ctl.eval args). */
export const PROGRAM_MAX_CHARS = 65536;
/** Hard cap on syntactic nesting — bounds parser AND evaluator host-stack use. */
export const PARSE_DEPTH_MAX = 32;
/** Parse work charges 1 fuel per this many input characters. */
const PARSE_CHARS_PER_FUEL = 64;

export type Node =
  | { kind: "str"; v: string }
  | { kind: "num"; v: string }
  | { kind: "dbref"; v: string }
  | { kind: "reg"; i: number }
  | { kind: "atom"; name: "me" | "here" }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "seq"; stmts: Node[] };

type Token =
  | { t: "str"; v: string }
  | { t: "num"; v: string }
  | { t: "dbref"; v: string }
  | { t: "reg"; i: number }
  | { t: "ident"; v: string }
  | { t: "lparen" }
  | { t: "rparen" }
  | { t: "comma" }
  | { t: "semi" }
  | { t: "eof" };

const invalid = (why: string): RefusalSignal =>
  new RefusalSignal("INVALID_PROGRAM", why);

const isDigit = (c: string): boolean => c >= "0" && c <= "9";
const isIdentStart = (c: string): boolean =>
  (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
const isIdentPart = (c: string): boolean => isIdentStart(c) || isDigit(c);

function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    if (c === "(") { tokens.push({ t: "lparen" }); i++; continue; }
    if (c === ")") { tokens.push({ t: "rparen" }); i++; continue; }
    if (c === ",") { tokens.push({ t: "comma" }); i++; continue; }
    if (c === ";") { tokens.push({ t: "semi" }); i++; continue; }
    if (c === '"') {
      i++;
      let v = "";
      for (;;) {
        if (i >= source.length) throw invalid("unterminated string literal");
        const d = source[i];
        if (d === '"') { i++; break; }
        if (d === "\\" && i + 1 < source.length) {
          const e = source[i + 1];
          if (e === '"' || e === "\\") { v += e; i += 2; continue; }
        }
        v += d;
        i++;
      }
      tokens.push({ t: "str", v });
      continue;
    }
    if (c === "#") {
      let j = i + 1;
      while (j < source.length && isDigit(source[j])) j++;
      if (j === i + 1) throw invalid("bare '#' is not a dbref");
      tokens.push({ t: "dbref", v: source.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "%") {
      const d = source[i + 1];
      if (d !== undefined && isDigit(d)) {
        tokens.push({ t: "reg", i: Number(d) });
        i += 2;
        continue;
      }
      throw invalid("'%' must be followed by a register digit 0-9");
    }
    if (isDigit(c) || (c === "-" && isDigit(source[i + 1] ?? ""))) {
      let j = c === "-" ? i + 1 : i;
      while (j < source.length && isDigit(source[j])) j++;
      if (source[j] === "." && isDigit(source[j + 1] ?? "")) {
        j++;
        while (j < source.length && isDigit(source[j])) j++;
      }
      tokens.push({ t: "num", v: source.slice(i, j) });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < source.length && isIdentPart(source[j])) j++;
      // dotted namespace path: str.concat, obj.getAttr, ...
      while (source[j] === "." && isIdentStart(source[j + 1] ?? "")) {
        j += 2;
        while (j < source.length && isIdentPart(source[j])) j++;
      }
      tokens.push({ t: "ident", v: source.slice(i, j) });
      i = j;
      continue;
    }
    throw invalid(`unexpected character ${JSON.stringify(c)}`);
  }
  tokens.push({ t: "eof" });
  return tokens;
}

/**
 * Parse one program (a ';'-separated statement list). Charges the meter:
 * fuel in character blocks, allocation for the held source text.
 */
export function parse(source: string, meter: Meter): Node {
  if (source.length > PROGRAM_MAX_CHARS)
    throw invalid(`program exceeds ${PROGRAM_MAX_CHARS} chars`);
  meter.charge(Math.floor(source.length / PARSE_CHARS_PER_FUEL));
  meter.chargeAlloc(source.length);

  const tokens = lex(source);
  let pos = 0;
  const peek = (): Token => tokens[pos];
  const next = (): Token => tokens[pos++];

  function parseExpr(depth: number): Node {
    if (depth > PARSE_DEPTH_MAX)
      throw invalid(`nesting exceeds ${PARSE_DEPTH_MAX}`);
    const tok = next();
    let node: Node;
    switch (tok.t) {
      case "str":
        node = { kind: "str", v: tok.v };
        break;
      case "num":
        node = { kind: "num", v: tok.v };
        break;
      case "dbref":
        node = { kind: "dbref", v: tok.v };
        break;
      case "reg":
        node = { kind: "reg", i: tok.i };
        break;
      case "ident": {
        if (tok.v === "me" || tok.v === "here") {
          node = { kind: "atom", name: tok.v };
          break;
        }
        if (peek().t !== "lparen")
          throw invalid(`bare identifier ${JSON.stringify(tok.v)}`);
        next(); // consume '('
        const args: Node[] = [];
        if (peek().t !== "rparen") {
          args.push(parseExpr(depth + 1));
          while (peek().t === "comma") {
            next();
            args.push(parseExpr(depth + 1));
          }
        }
        if (next().t !== "rparen") throw invalid("expected ')'");
        node = { kind: "call", name: tok.v, args };
        break;
      }
      default:
        throw invalid(`unexpected token '${tok.t}'`);
    }
    // A call-of-a-result (`f(...)(...)`) has no meaning in softcode; refusing
    // it here closes the "callable value" surface entirely (fixture 15).
    if (peek().t === "lparen") throw invalid("value is not callable");
    return node;
  }

  const stmts: Node[] = [parseExpr(0)];
  while (peek().t === "semi") {
    next();
    if (peek().t === "eof") break; // tolerate one trailing ';'
    stmts.push(parseExpr(0));
  }
  if (next().t !== "eof") throw invalid("trailing input after statement list");
  return stmts.length === 1 ? stmts[0] : { kind: "seq", stmts };
}
