// Boolean lock evaluation (GM-R8): locks are stored as DATA and the world
// evaluates them per action (pickup / enter / use). The grammar is a small,
// deliberately-bounded subset of the reference's boolean "key" language,
// documented in docs/world-model.md. Where the reference is richer, the
// safe subset wins and the divergence is recorded (GM-R14 / GM-R22 rubric:
// the safe behavior wins and is documented; commands/behaviors are never
// invented from model memory of the wider MUSH family).
//
//   expr   := or
//   or     := and ( '|' and )*
//   and    := unary ( '&' unary )*
//   unary  := '!' unary | primary
//   primary:= '(' or ')' | '#'<dbref> | NAME ':' glob | 'true' | 'false'
//
//   #N        passes if the actor IS object #N, or CARRIES it (holds a key)
//   ATTR:glob passes if the actor's ATTR attribute matches glob (*/? wildcards)
//   true/false constants
//
// The evaluator is pure and bounded: parsing is O(n) over a length-capped
// expression, evaluation touches only the snapshot the caller already holds,
// and the world-API charges the engine's fuel around each lock call.

import { globToRegExp } from "./glob.ts";

export interface LockWorld {
  /** the object the actor is (its public id). */
  actorId: string;
  /** ids the actor is carrying (its inventory), for `#N` key checks. */
  carrying(actorId: string): string[];
  /** the actor's own attribute value (already inheritance-resolved), or "". */
  attr(actorId: string, name: string): string;
}

const MAX_LOCK_LEN = 1024;

class Parser {
  private i = 0;
  private readonly s: string;
  constructor(s: string) {
    this.s = s;
  }

  parse(): Node {
    const node = this.or();
    this.ws();
    if (this.i < this.s.length) {
      throw new LockSyntaxError(`unexpected '${this.s[this.i]}' at ${this.i}`);
    }
    return node;
  }

  private ws(): void {
    while (this.i < this.s.length && this.s[this.i] === " ") this.i++;
  }

  private or(): Node {
    let left = this.and();
    for (;;) {
      this.ws();
      if (this.s[this.i] !== "|") return left;
      this.i++;
      left = { kind: "or", left, right: this.and() };
    }
  }

  private and(): Node {
    let left = this.unary();
    for (;;) {
      this.ws();
      if (this.s[this.i] !== "&") return left;
      this.i++;
      left = { kind: "and", left, right: this.unary() };
    }
  }

  private unary(): Node {
    this.ws();
    if (this.s[this.i] === "!") {
      this.i++;
      return { kind: "not", child: this.unary() };
    }
    return this.primary();
  }

  private primary(): Node {
    this.ws();
    const c = this.s[this.i];
    if (c === "(") {
      this.i++;
      const inner = this.or();
      this.ws();
      if (this.s[this.i] !== ")") throw new LockSyntaxError("expected ')'");
      this.i++;
      return inner;
    }
    if (c === "#") {
      this.i++;
      const start = this.i;
      while (this.i < this.s.length && /[0-9]/.test(this.s[this.i]!)) this.i++;
      if (this.i === start) throw new LockSyntaxError("expected dbref digits after '#'");
      return { kind: "key", dbref: Number(this.s.slice(start, this.i)) };
    }
    // NAME ':' glob   (or the bare constants true/false)
    const start = this.i;
    while (this.i < this.s.length && /[A-Za-z0-9_]/.test(this.s[this.i]!)) this.i++;
    const word = this.s.slice(start, this.i);
    if (word.length === 0) throw new LockSyntaxError(`unexpected '${c ?? "end"}'`);
    if (this.s[this.i] === ":") {
      this.i++;
      const gstart = this.i;
      // glob runs to the next operator / close-paren / end
      while (this.i < this.s.length && !"|&)".includes(this.s[this.i]!)) this.i++;
      return { kind: "attr", name: word.toUpperCase(), glob: this.s.slice(gstart, this.i).trim() };
    }
    const lower = word.toLowerCase();
    if (lower === "true") return { kind: "const", value: true };
    if (lower === "false") return { kind: "const", value: false };
    throw new LockSyntaxError(`bare word '${word}' — expected NAME:glob, #dbref, true/false`);
  }
}

type Node =
  | { kind: "or"; left: Node; right: Node }
  | { kind: "and"; left: Node; right: Node }
  | { kind: "not"; child: Node }
  | { kind: "key"; dbref: number }
  | { kind: "attr"; name: string; glob: string }
  | { kind: "const"; value: boolean };

export class LockSyntaxError extends Error {}

/** Parse once; throws LockSyntaxError on malformed input. */
export function parseLock(expr: string): Node {
  if (expr.length > MAX_LOCK_LEN) throw new LockSyntaxError("lock expression too long");
  return new Parser(expr).parse();
}

function evalNode(n: Node, w: LockWorld): boolean {
  switch (n.kind) {
    case "const":
      return n.value;
    case "not":
      return !evalNode(n.child, w);
    case "and":
      return evalNode(n.left, w) && evalNode(n.right, w);
    case "or":
      return evalNode(n.left, w) || evalNode(n.right, w);
    case "key": {
      const key = `#${n.dbref}`;
      return w.actorId === key || w.carrying(w.actorId).includes(key);
    }
    case "attr":
      return globToRegExp(n.glob).test(w.attr(w.actorId, n.name));
  }
}

/** Evaluate a stored lock expression for an actor. A malformed lock FAILS
 *  CLOSED (denies) rather than throwing into the caller — a corrupt lock must
 *  never accidentally open. Returns { ok, error? }. */
export function evalLock(expr: string, w: LockWorld): { ok: boolean; error?: string } {
  let ast: Node;
  try {
    ast = parseLock(expr);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  return { ok: evalNode(ast, w) };
}
