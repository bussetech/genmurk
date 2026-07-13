// The metered AST-walker — the engine core the design record specifies.
// ONE choke point: evaluate() charges the meter before any work; the
// function library is a frozen table built at construction; the only I/O is
// the WorldAPI handle on the invocation. Softcode values are strings, all
// the way down (GM-R11) — no host reference can be a softcode value.
//
// Deny-by-construction (design record §4): name resolution searches exactly
// the frozen library table and the substitution registers. Nothing here
// consults globalThis or evaluates host code — the source tripwire
// (test/tripwire.ts) enforces the absence of the forbidden tokens in CI.

import { RefusalSignal } from "./refusal.ts";
import { Meter } from "./meter.ts";
import { parse, type Node } from "./parse.ts";
import { globMatch } from "./match.ts";
import type { Budget, WorldAPI, WorldMutation, WorldRefusal } from "./types.js";

/** A follow-on queue entry, buffered transactionally (committed on completion). */
export interface PendingEntry {
  owner: string;
  target: string;
  attr: string;
  args: string[];
}

/** Parse results are cached per invocation; past this many texts, parse again. */
const PARSE_CACHE_MAX = 256;

export class Invocation {
  readonly actor: string;
  readonly meter: Meter;
  readonly world: WorldAPI;
  readonly budget: Budget;
  /** committed queue depth for an owner — supplied by the scheduler */
  readonly pendingCount: (owner: string) => number;
  readonly output: string[] = [];
  readonly mutations: WorldMutation[] = [];
  readonly enqueued: PendingEntry[] = [];
  private readonly parseCache = new Map<string, Node>();
  private registers: string[];

  constructor(
    actor: string,
    meter: Meter,
    world: WorldAPI,
    budget: Budget,
    pendingCount: (owner: string) => number,
    args: string[] = [],
  ) {
    this.actor = actor;
    this.meter = meter;
    this.world = world;
    this.budget = budget;
    this.pendingCount = pendingCount;
    this.registers = args;
  }

  register(i: number): string {
    return this.registers[i] ?? "";
  }

  /** Run fn with a fresh register frame (used by frames and iteration bodies). */
  withRegisters<T>(regs: string[], fn: () => T): T {
    const saved = this.registers;
    this.registers = regs;
    try {
      return fn();
    } finally {
      this.registers = saved;
    }
  }

  parseCached(text: string): Node {
    const hit = this.parseCache.get(text);
    if (hit) return hit;
    const node = parse(text, this.meter);
    if (this.parseCache.size < PARSE_CACHE_MAX) this.parseCache.set(text, node);
    return node;
  }
}

type PlainFn = (inv: Invocation, args: string[]) => string;
type SpecialFn = (inv: Invocation, argNodes: Node[]) => string;
export type Library = ReadonlyMap<
  string,
  { special: false; fn: PlainFn } | { special: true; fn: SpecialFn }
>;

// ── the choke point ─────────────────────────────────────────────────────

export function evaluate(inv: Invocation, lib: Library, node: Node): string {
  switch (node.kind) {
    case "str":
      return node.v;
    case "num":
      return node.v;
    case "dbref":
      return node.v;
    case "atom":
      if (node.name === "me") return inv.actor;
      // `here` is a world question — charged, and refusable by the world
      inv.meter.charge(1);
      return unwrap(inv.world.location(inv.actor, inv.actor));
    case "reg": {
      // substitution: expansion charges fuel + allocation; the expanded
      // VALUE is returned as data and never re-scanned (design §2)
      inv.meter.charge(1);
      const v = inv.register(node.i);
      inv.meter.chargeAlloc(v.length);
      return v;
    }
    case "seq": {
      let last = "";
      for (const stmt of node.stmts) last = evaluate(inv, lib, stmt);
      return last;
    }
    case "call": {
      inv.meter.charge(1); // every call charges on entry — no free work
      const entry = lib.get(node.name);
      if (!entry) throw new RefusalSignal("UNKNOWN_FUNCTION", node.name);
      if (entry.special) return entry.fn(inv, node.args);
      const args = node.args.map((a) => evaluate(inv, lib, a));
      return entry.fn(inv, args);
    }
  }
}

/** Evaluate an attribute body as a user function: THE frame site (GM-R14 depth). */
export function evalAttrBody(
  inv: Invocation,
  lib: Library,
  text: string,
  args: string[],
): string {
  const node = inv.parseCached(text);
  inv.meter.enterFrame();
  try {
    return inv.withRegisters(args, () => evaluate(inv, lib, node));
  } finally {
    inv.meter.exitFrame();
  }
}

// ── helpers (all typed-refusal, all total) ──────────────────────────────

const bad = (why: string): RefusalSignal =>
  new RefusalSignal("INVALID_PROGRAM", why);

function unwrap(v: string | true | WorldRefusal): string {
  if (v === true) return "";
  if (typeof v === "object") throw new RefusalSignal(v.refused);
  return v;
}

function toNumber(s: string): number {
  const t = s.trim();
  const n = t === "" ? NaN : Number(t);
  if (!Number.isFinite(n)) throw bad(`not a number: ${JSON.stringify(s)}`);
  return n;
}

function toCount(s: string): number {
  const n = toNumber(s);
  if (!Number.isInteger(n) || n < 0) throw bad(`not a count: ${JSON.stringify(s)}`);
  return n;
}

const fmtNumber = (n: number): string => String(n);

const truthy = (s: string): boolean => {
  const n = Number(s.trim());
  return Number.isFinite(n) && n !== 0;
};

const boolStr = (b: boolean): string => (b ? "1" : "0");

/** Charge the allocation account for a result BEFORE constructing it. */
function give(inv: Invocation, s: string): string {
  inv.meter.chargeAlloc(s.length);
  return s;
}

/** Split a list string: charged in character blocks + allocation for the parts. */
function splitList(inv: Invocation, l: string, delim: string): string[] {
  const d = delim === "" ? " " : delim;
  inv.meter.charge(Math.floor(l.length / 64));
  inv.meter.chargeAlloc(l.length);
  return l === "" ? [] : l.split(d);
}

/** me / here / #dbref / partial-name resolution (GM-R12). */
function resolveTarget(inv: Invocation, name: string): string {
  const t = name.trim();
  if (t.startsWith("#")) return t;
  const lower = t.toLowerCase();
  if (lower === "me") return inv.actor;
  if (lower === "here") return unwrap(inv.world.location(inv.actor, inv.actor));
  const candidates = inv.world.visibleObjects(inv.actor);
  let prefixHit = "";
  for (const c of candidates) {
    inv.meter.charge(1); // match units charge fuel (GM-R12 mechanics)
    const cn = c.name.toLowerCase();
    if (cn === lower) return c.id;
    if (!prefixHit && lower !== "" && cn.startsWith(lower)) prefixHit = c.id;
  }
  return prefixHit; // "" = no match — a value, never a crash
}

// ── the function library (frozen at construction; design §6) ────────────

export function buildLibrary(instrumentation: boolean): Library {
  const table = new Map<
    string,
    { special: false; fn: PlainFn } | { special: true; fn: SpecialFn }
  >();
  const plain = (name: string, fn: PlainFn): void => {
    table.set(name, { special: false, fn });
  };
  const special = (name: string, fn: SpecialFn): void => {
    table.set(name, { special: true, fn });
  };
  // the table needs itself for frame-creating functions (callAttr, iter, …)
  const lib = table as unknown as Library;

  // 1. string
  plain("str.concat", (inv, args) => {
    let len = 0;
    for (const a of args) len += a.length;
    inv.meter.chargeAlloc(len); // result size, not 1 — the concat-bomb wall
    return args.join("");
  });
  plain("str.length", (inv, [s = ""]) => give(inv, fmtNumber(s.length)));
  plain("str.slice", (inv, [s = "", start = "0", len]) => {
    const from = Math.max(0, Math.min(s.length, toCount(start)));
    const upto =
      len === undefined
        ? s.length
        : Math.max(from, Math.min(s.length, from + toCount(len)));
    return give(inv, s.slice(from, upto));
  });
  plain("str.replace", (inv, [s = "", find = "", repl = ""]) => {
    if (find === "") return give(inv, s);
    const parts = s.split(find);
    inv.meter.charge(Math.floor(s.length / 64));
    return give(inv, parts.join(repl));
  });
  plain("str.upper", (inv, [s = ""]) => give(inv, s.toUpperCase()));
  plain("str.lower", (inv, [s = ""]) => give(inv, s.toLowerCase()));
  plain("str.trim", (inv, [s = ""]) => give(inv, s.trim()));
  plain("str.repeat", (inv, [s = "", n = "0"]) => {
    const count = toCount(n);
    inv.meter.chargeAlloc(s.length * count); // charge BEFORE building
    return s.repeat(count);
  });

  // 2. list
  plain("list.item", (inv, [l = "", i = "1", d = " "]) => {
    const items = splitList(inv, l, d);
    const idx = toCount(i);
    return give(inv, idx >= 1 && idx <= items.length ? items[idx - 1] : "");
  });
  plain("list.count", (inv, [l = "", d = " "]) =>
    give(inv, fmtNumber(splitList(inv, l, d).length)),
  );
  plain("list.append", (inv, [l = "", x = "", d = " "]) => {
    inv.meter.chargeAlloc(l.length + d.length + x.length);
    return l === "" ? x : l + d + x;
  });
  const mapLike =
    (keep: "map" | "filter"): PlainFn =>
    (inv, [l = "", fnAttr = "", d = " "]) => {
      const items = splitList(inv, l, d);
      const text = unwrap(inv.world.getAttr(inv.actor, inv.actor, fnAttr));
      inv.meter.chargeAlloc(text.length);
      const out: string[] = [];
      for (const item of items) {
        inv.meter.charge(1); // per-element iteration unit
        const r = evalAttrBody(inv, lib, text, [item]);
        if (keep === "map") out.push(r);
        else if (truthy(r)) out.push(item);
      }
      const joined = out.join(d);
      inv.meter.chargeAlloc(joined.length);
      return joined;
    };
  plain("list.map", mapLike("map"));
  plain("list.filter", mapLike("filter"));

  // 3. arithmetic & logic
  const arith = (name: string, op: (a: number, b: number) => number): void =>
    plain(name, (inv, [a = "", b = ""]) =>
      give(inv, fmtNumber(op(toNumber(a), toNumber(b)))),
    );
  arith("num.add", (a, b) => a + b);
  arith("num.sub", (a, b) => a - b);
  arith("num.mul", (a, b) => a * b);
  plain("num.div", (inv, [a = "", b = ""]) => {
    const d = toNumber(b);
    if (d === 0) throw bad("division by zero");
    return give(inv, fmtNumber(toNumber(a) / d));
  });
  plain("num.mod", (inv, [a = "", b = ""]) => {
    const d = toNumber(b);
    if (d === 0) throw bad("modulo by zero");
    return give(inv, fmtNumber(toNumber(a) % d));
  });
  plain("num.cmp", (inv, [a = "", b = ""]) => {
    const x = toNumber(a);
    const y = toNumber(b);
    return give(inv, x < y ? "-1" : x > y ? "1" : "0");
  });
  plain("bool.and", (inv, args) => give(inv, boolStr(args.every(truthy))));
  plain("bool.or", (inv, args) => give(inv, boolStr(args.some(truthy))));
  plain("bool.not", (inv, [a = ""]) => give(inv, boolStr(!truthy(a))));

  // 4. object & attribute — thin metered shims over the WorldAPI capability
  plain("obj.getAttr", (inv, [target = "", attr = ""]) => {
    const t = resolveTarget(inv, target);
    const v = unwrap(inv.world.getAttr(inv.actor, t, attr));
    return give(inv, v);
  });
  plain("obj.setAttr", (inv, [target = "", attr = "", value = ""]) => {
    const t = resolveTarget(inv, target);
    unwrap(inv.world.setAttr(inv.actor, t, attr, value));
    inv.mutations.push({ op: "setAttr", target: t, detail: `${attr}=${value}` });
    return "";
  });
  plain("obj.name", (inv, [target = ""]) =>
    give(inv, unwrap(inv.world.name(inv.actor, resolveTarget(inv, target)))),
  );
  plain("obj.location", (inv, [target = ""]) =>
    give(inv, unwrap(inv.world.location(inv.actor, resolveTarget(inv, target)))),
  );
  plain("obj.resolve", (inv, [name = ""]) => give(inv, resolveTarget(inv, name)));
  plain("obj.callAttr", (inv, [target = "", attr = "", ...args]) => {
    const t = resolveTarget(inv, target);
    const text = unwrap(inv.world.getAttr(inv.actor, t, attr));
    inv.meter.chargeAlloc(text.length);
    return evalAttrBody(inv, lib, text, args);
  });

  // 5. control
  special("ctl.if", (inv, nodes) => {
    if (nodes.length < 2) throw bad("ctl.if needs (cond, then, else?)");
    const cond = truthy(evaluate(inv, lib, nodes[0]));
    if (cond) return evaluate(inv, lib, nodes[1]);
    return nodes[2] ? evaluate(inv, lib, nodes[2]) : "";
  });
  special("ctl.switch", (inv, nodes) => {
    if (nodes.length < 1) throw bad("ctl.switch needs a value");
    const value = evaluate(inv, lib, nodes[0]);
    let i = 1;
    while (i + 1 < nodes.length) {
      const pattern = evaluate(inv, lib, nodes[i]);
      if (globMatch(pattern, value, inv.meter).matched)
        return evaluate(inv, lib, nodes[i + 1]); // results are lazy
      i += 2;
    }
    return i < nodes.length ? evaluate(inv, lib, nodes[i]) : "";
  });
  plain("ctl.iter", (inv, [l = "", body = "", d = " "]) => {
    const items = splitList(inv, l, d);
    const node = inv.parseCached(body);
    for (const item of items) {
      inv.meter.charge(1); // iteration unit
      inv.meter.enterFrame();
      try {
        inv.withRegisters([item], () => evaluate(inv, lib, node));
      } finally {
        inv.meter.exitFrame();
      }
    }
    return "";
  });
  plain("ctl.eval", (inv, [s = ""]) => {
    // THE deliberate re-evaluation path — a frame like any other call
    const node = inv.parseCached(s);
    inv.meter.enterFrame();
    try {
      return evaluate(inv, lib, node);
    } finally {
      inv.meter.exitFrame();
    }
  });

  // 6. output & styling
  plain("out.emit", (inv, [text = ""]) => {
    inv.meter.chargeAlloc(text.length);
    inv.output.push(text);
    inv.world.emit(inv.actor, text);
    return "";
  });
  plain("out.style", (inv, [text = "", spec = ""]) => {
    // markup tokens only — softcode can never emit raw escape bytes (GM-R13)
    if (!/^[a-z][a-z0-9:,-]*$/.test(spec)) throw bad(`bad style spec: ${spec}`);
    return give(inv, `[[${spec}]]${text}[[/]]`);
  });

  // 7. queue
  plain("queue.enqueue", (inv, [target = "", attr = "", ...args]) => {
    if (inv.enqueued.length + 1 > inv.budget.enqueuePerRun)
      throw new RefusalSignal("QUEUE_BUDGET_EXCEEDED", "per-run enqueue ceiling");
    if (inv.pendingCount(inv.actor) + inv.enqueued.length + 1 > inv.budget.queueDepthPerOwner)
      throw new RefusalSignal("QUEUE_BUDGET_EXCEEDED", "owner queue depth cap");
    const t = resolveTarget(inv, target);
    inv.enqueued.push({ owner: inv.actor, target: t, attr, args });
    return "";
  });

  // 8. test instrumentation — harness only, never in production
  if (instrumentation) {
    plain("t.burn", (inv, [n = "1"]) => {
      // convention: n is the TOTAL charge including this call's entry charge
      const rest = toCount(n) - 1;
      for (let i = 0; i < rest; i++) inv.meter.charge(1);
      return "";
    });
    plain("t.noop", () => "");
    plain("t.alloc", (inv, [n = "0"]) => {
      inv.meter.chargeAlloc(toCount(n));
      return "";
    });
  }

  // A frozen Map still honors .set — disable mutation for real, then freeze.
  const refuse = (): never => {
    throw new Error("the library table is frozen at engine construction");
  };
  table.set = refuse;
  table.delete = refuse;
  table.clear = refuse;
  return Object.freeze(table) as Library;
}
