// The softcode engine seam (design record: app/docs/engine-design.md).
// Everything outside the engine — server, harness, future implementations —
// sees only these types. GM-R14: budgets are values, refusals are values,
// and the only capability an engine ever holds is the WorldAPI it is handed.

export interface Budget {
  /** fuel: max interpreter steps per invocation */
  steps: number;
  /** max user-function / attribute-evaluation frame depth */
  recursionDepth: number;
  /** max follow-on entries one run may enqueue */
  enqueuePerRun: number;
  /** max pending queue entries per owner */
  queueDepthPerOwner: number;
  /** allocation account, in bytes of constructed strings/lists */
  allocationBytes: number;
  /** wall-clock backstop; fuel is the primary mechanism */
  wallClockMs: number;
}

export type RefusalCode =
  | "STEP_BUDGET_EXCEEDED"
  | "RECURSION_LIMIT_EXCEEDED"
  | "QUEUE_BUDGET_EXCEEDED"
  | "ALLOCATION_BUDGET_EXCEEDED"
  | "WALL_CLOCK_EXCEEDED"
  | "UNKNOWN_FUNCTION"
  | "PERMISSION_DENIED"
  | "INVALID_PROGRAM"
  | "ENGINE_NOT_IMPLEMENTED";

export interface WorldMutation {
  op: "setAttr" | "create" | "move" | "destroy";
  target: string;
  detail: string;
}

export interface RunOutcome {
  status: "completed" | "refused";
  refusalCode?: RefusalCode;
  /** diagnostic detail for logs and tests; never load-bearing for callers */
  detail?: string;
  /** lines the run emitted (softcode values are strings, GM-R11) */
  output: string[];
  /** journaled world writes this run performed before completing/refusing */
  mutations: WorldMutation[];
  stepsUsed: number;
}

/** A permission-refused world call is a value, never a throw. */
export type WorldRefusal = { refused: RefusalCode };

/**
 * The capability handle — the ONLY I/O in an engine's world. The world
 * model re-checks the actor's permissions (GM-R15) on every call; the
 * engine's sandbox is the first wall, this is the second.
 */
export interface WorldAPI {
  getAttr(actor: string, target: string, attr: string): string | WorldRefusal;
  setAttr(
    actor: string,
    target: string,
    attr: string,
    value: string,
  ): true | WorldRefusal;
  emit(actor: string, text: string): void;
  /** display name of a target (obj.name — GM-R12 name surfaces) */
  name(actor: string, target: string): string | WorldRefusal;
  /** location of a target (obj.location, and `here` resolution) */
  location(actor: string, target: string): string | WorldRefusal;
  /**
   * candidates for GM-R12 partial-name matching, already filtered to what
   * the actor may see. The MATCHING over these is the engine's (fuel-charged)
   * — the world only supplies visibility.
   */
  visibleObjects(actor: string): { id: string; name: string }[];
}

export interface RunRequest {
  /** principal (object id) the program runs as */
  actor: string;
  /** the softcode text — untrusted input, always */
  program: string;
  /** substitution registers %0..%9 — untrusted input, expanded once (never re-scanned) */
  args?: string[];
  budget: Budget;
}

export interface EngineOptions {
  /** registers the t.* test-instrumentation functions; harness only */
  instrumentation?: boolean;
}

export interface SoftcodeEngine {
  /** one metered invocation */
  run(request: RunRequest, world: WorldAPI): RunOutcome;
  /**
   * submit several runs through the fair scheduler (round-robin across
   * owners, quantum-bounded turns) and drain the queue to completion or
   * refusal. Outcomes are returned in submission order. The starvation
   * fixtures hold their victim-completes assertion over this path, so a
   * real engine must implement fairness here, not in run().
   */
  runMany(requests: RunRequest[], world: WorldAPI): RunOutcome[];
}

export type CreateEngine = (options?: EngineOptions) => SoftcodeEngine;
