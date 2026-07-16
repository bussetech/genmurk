// Boolean lock evaluation (GM-R8): locks are stored as DATA and the world
// evaluates them per action (pickup / enter / use). GENMURK-EPIC1-09 brings
// the grammar to its full ruled scope — attribute AND ownership predicates
// (GM-R8 names both) — while keeping it a deliberately-bounded subset of the
// reference's boolean "key" language, documented in docs/world-model.md. Where
// the reference is richer, the safe subset wins and the divergence is recorded
// (GM-R14 / GM-R22 rubric: the safe behavior wins and is documented; forms are
// never invented from model memory of the wider MUSH family).
//
//   expr   := or
//   or     := and ( '|' and )*
//   and    := unary ( '&' unary )*
//   unary  := '!' unary | primary
//   primary:= '(' or ')' | '#'<dbref> | 'owner' '(' '#'<dbref> ')'
//           | NAME ':' glob | 'true' | 'false'
//
//   #N          passes if the actor IS object #N, or CARRIES it (holds a key)
//   owner(#N)   passes if the actor OWNS object #N (the ownership predicate,
//               GM-R5/R9 "owner"): a door `owner(#5)` opens for whoever the
//               charter #5 belongs to — a relationship a `#N` key cannot state
//   ATTR:glob   passes if the actor's ATTR attribute matches glob (*/? wildcards)
//   true/false  constants
//
// SANDBOX BY CONSTRUCTION (GM-R14): a stored lock is untrusted input, so its
// evaluation is bounded three ways, none of them "by hope":
//   1. length      — the source is capped (MAX_LOCK_LEN), matching the DB CHECK.
//   2. nesting     — the parser refuses expressions nested past MAX_LOCK_DEPTH,
//                    so a `((((…))))` bomb can never blow the recursion stack.
//   3. eval budget — every node visited spends one unit of a per-evaluation
//                    step budget (LOCK_EVAL_STEPS); exhausting it FAILS CLOSED.
// The glob compiler (world/glob.ts) is itself backtrack-free, so a hostile
// `ATTR:*a*a*…` cannot make one predicate super-linear. A lock is thus
// evaluated in bounded time on the transport plane without holding the engine's
// fuel meter — proven against a hostile-expression fixture pack
// (test/unit/world-lock-hostile.test.ts).

import { globToRegExp } from "./glob.ts";

export interface LockWorld {
  /** the object the actor is (its public id). */
  actorId: string;
  /** ids the actor is carrying (its inventory), for `#N` key checks. */
  carrying(actorId: string): string[];
  /** the actor's own attribute value (already inheritance-resolved), or "". */
  attr(actorId: string, name: string): string;
  /** the owner id of an object (its public id), or null if unknown — the
   *  ownership predicate `owner(#N)` passes iff this equals the actor. */
  ownerOf(id: string): string | null;
}

const MAX_LOCK_LEN = 1024;
/** Max parenthesis/operator nesting the parser will accept (GM-R14). Well
 *  above any legitimate lock; a deeper expression is refused as untrusted. */
const MAX_LOCK_DEPTH = 64;
/** Per-evaluation node budget (GM-R14): every evaluated AST node spends one.
 *  A well-formed lock under the length + depth caps has far fewer nodes than
 *  this; the ceiling exists so evaluation can never run unbounded. */
export const LOCK_EVAL_STEPS = 4096;

class Parser {
  private i = 0;
  private readonly s: string;
  constructor(s: string) {
    this.s = s;
  }

  parse(): Node {
    const node = this.or(0);
    this.ws();
    if (this.i < this.s.length) {
      throw new LockSyntaxError(`unexpected '${this.s[this.i]}' at ${this.i}`);
    }
    return node;
  }

  private ws(): void {
    while (this.i < this.s.length && this.s[this.i] === " ") this.i++;
  }

  private depth(d: number): void {
    if (d > MAX_LOCK_DEPTH) throw new LockSyntaxError("lock expression nested too deeply");
  }

  private or(d: number): Node {
    this.depth(d);
    let left = this.and(d);
    for (;;) {
      this.ws();
      if (this.s[this.i] !== "|") return left;
      this.i++;
      left = { kind: "or", left, right: this.and(d) };
    }
  }

  private and(d: number): Node {
    let left = this.unary(d);
    for (;;) {
      this.ws();
      if (this.s[this.i] !== "&") return left;
      this.i++;
      left = { kind: "and", left, right: this.unary(d) };
    }
  }

  private unary(d: number): Node {
    this.ws();
    if (this.s[this.i] === "!") {
      this.i++;
      return { kind: "not", child: this.unary(d + 1) };
    }
    return this.primary(d);
  }

  private primary(d: number): Node {
    this.depth(d);
    this.ws();
    const c = this.s[this.i];
    if (c === "(") {
      this.i++;
      const inner = this.or(d + 1);
      this.ws();
      if (this.s[this.i] !== ")") throw new LockSyntaxError("expected ')'");
      this.i++;
      return inner;
    }
    if (c === "#") {
      return { kind: "key", dbref: this.dbref() };
    }
    // NAME — either an attribute predicate (NAME:glob), the ownership predicate
    // (owner(#N)), or a bare constant (true/false).
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
    if (word.toLowerCase() === "owner" && this.s[this.i] === "(") {
      this.i++; // consume '('
      this.ws();
      if (this.s[this.i] !== "#") throw new LockSyntaxError("owner() expects a #dbref");
      const dbref = this.dbref();
      this.ws();
      if (this.s[this.i] !== ")") throw new LockSyntaxError("expected ')' to close owner()");
      this.i++;
      return { kind: "owner", dbref };
    }
    const lower = word.toLowerCase();
    if (lower === "true") return { kind: "const", value: true };
    if (lower === "false") return { kind: "const", value: false };
    throw new LockSyntaxError(`bare word '${word}' — expected NAME:glob, #dbref, owner(#N), true/false`);
  }

  /** Read a `#<digits>` reference the cursor sits on. */
  private dbref(): number {
    this.i++; // consume '#'
    const start = this.i;
    while (this.i < this.s.length && /[0-9]/.test(this.s[this.i]!)) this.i++;
    if (this.i === start) throw new LockSyntaxError("expected dbref digits after '#'");
    return Number(this.s.slice(start, this.i));
  }
}

type Node =
  | { kind: "or"; left: Node; right: Node }
  | { kind: "and"; left: Node; right: Node }
  | { kind: "not"; child: Node }
  | { kind: "key"; dbref: number }
  | { kind: "owner"; dbref: number }
  | { kind: "attr"; name: string; glob: string }
  | { kind: "const"; value: boolean };

export class LockSyntaxError extends Error {}
/** Raised when a lock's evaluation exhausts its node budget (GM-R14). Caught
 *  by evalLock, which then fails closed — a runaway lock never opens. */
export class LockBudgetError extends Error {}

/** Parse once; throws LockSyntaxError on malformed or over-nested input. */
export function parseLock(expr: string): Node {
  if (expr.length > MAX_LOCK_LEN) throw new LockSyntaxError("lock expression too long");
  return new Parser(expr).parse();
}

/** A tiny mutable step account, decremented per node — the GM-R14 eval budget. */
class Fuel {
  private left: number;
  constructor(steps: number) {
    this.left = steps;
  }
  spend(): void {
    if (--this.left < 0) throw new LockBudgetError("lock evaluation step budget exhausted");
  }
}

function evalNode(n: Node, w: LockWorld, fuel: Fuel): boolean {
  fuel.spend();
  switch (n.kind) {
    case "const":
      return n.value;
    case "not":
      return !evalNode(n.child, w, fuel);
    case "and":
      return evalNode(n.left, w, fuel) && evalNode(n.right, w, fuel);
    case "or":
      return evalNode(n.left, w, fuel) || evalNode(n.right, w, fuel);
    case "key": {
      const key = `#${n.dbref}`;
      return w.actorId === key || w.carrying(w.actorId).includes(key);
    }
    case "owner":
      return w.ownerOf(`#${n.dbref}`) === w.actorId;
    case "attr":
      return globToRegExp(n.glob).test(w.attr(w.actorId, n.name));
  }
}

/** Evaluate a stored lock expression for an actor. A malformed lock, an
 *  over-nested lock, or one that exhausts its evaluation budget FAILS CLOSED
 *  (denies) rather than throwing into the caller — a corrupt or hostile lock
 *  must never accidentally open. Returns { ok, error? }. */
export function evalLock(expr: string, w: LockWorld): { ok: boolean; error?: string } {
  let ast: Node;
  try {
    ast = parseLock(expr);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    return { ok: evalNode(ast, w, new Fuel(LOCK_EVAL_STEPS)) };
  } catch (e) {
    // budget exhaustion (or any evaluation fault) denies — fail closed
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
