// The command queue and its fair scheduler. Round-robin across owners, one
// entry per turn, every entry under its own fresh per-invocation budget —
// a hostile owner's flood cannot delay another owner's turn (GM-R14; the
// starvation fixture holds its victim-completes assertion over this path).
//
// Termination is arithmetic, not intent, via three mechanisms:
//   1. per-run enqueue ceiling + per-owner pending cap (charged at the
//      enqueue site, inside the invocation);
//   2. TRANSACTIONAL enqueues — follow-on entries are committed only when
//      the run that enqueued them COMPLETES; a refused run schedules nothing;
//   3. a per-owner drain quota — pending caps alone cannot terminate a
//      self-replicating chain (it can oscillate at the cap: each completed
//      entry replaces itself), so each drain cycle bounds how many entries
//      one owner may EXECUTE. Quota-refused entries are typed refusals.
//   (design record §9 delta — found while building, not in the spike design)

import { Meter } from "./meter.ts";
import { RefusalSignal } from "./refusal.ts";
import { parse } from "./parse.ts";
import {
  Invocation,
  evaluate,
  type Library,
  type PendingEntry,
} from "./interpreter.ts";
import type {
  Budget,
  RunOutcome,
  RunRequest,
  WorldAPI,
} from "./types.js";

/** How many entries one owner may execute per drain cycle, per unit of depth cap. */
const DRAIN_EXECUTIONS_PER_DEPTH_UNIT = 4;

interface QueueEntry {
  /** the principal the entry runs as */
  actor: string;
  /** the budget/fairness attribution principal (queues + quotas key on this) */
  owner: string;
  budget: Budget;
  /** a submitted request (program) or a committed follow-on (target attr) */
  work:
    | { kind: "program"; program: string; args: string[] }
    | { kind: "attr"; target: string; attr: string; args: string[] };
  /** where the outcome goes for submitted requests; follow-ons report nowhere */
  resultIndex?: number;
}

const refusedOutcome = (
  code: RunOutcome["refusalCode"],
  inv: Invocation | null,
  meter: Meter | null,
  detail?: string,
): RunOutcome => ({
  status: "refused",
  refusalCode: code,
  ...(detail ? { detail } : {}),
  output: inv ? [...inv.output] : [],
  mutations: inv ? [...inv.mutations] : [],
  stepsUsed: meter ? meter.stepsUsed : 0,
});

export class Scheduler {
  private readonly lib: Library;

  constructor(lib: Library) {
    this.lib = lib;
  }

  run(request: RunRequest, world: WorldAPI): RunOutcome {
    const queues = new Map<string, QueueEntry[]>();
    const outcome = this.executeProgram(request, world, queues);
    this.drain(world, queues, request.budget, []);
    return outcome;
  }

  runMany(requests: RunRequest[], world: WorldAPI): RunOutcome[] {
    const results: RunOutcome[] = new Array(requests.length);
    const queues = new Map<string, QueueEntry[]>();
    for (let i = 0; i < requests.length; i++) {
      const r = requests[i];
      this.push(queues, {
        actor: r.actor,
        owner: r.owner ?? r.actor,
        budget: r.budget,
        work: { kind: "program", program: r.program, args: r.args ?? [] },
        resultIndex: i,
      });
    }
    this.drain(world, queues, requests[0]?.budget, results);
    return results;
  }

  // ── the drain cycle ────────────────────────────────────────────────────

  private drain(
    world: WorldAPI,
    queues: Map<string, QueueEntry[]>,
    _defaultBudget: Budget | undefined,
    results: RunOutcome[],
  ): void {
    const executed = new Map<string, number>();
    for (;;) {
      // round-robin: one entry per owner per pass, in first-seen owner order
      let ranAny = false;
      for (const owner of [...queues.keys()]) {
        const q = queues.get(owner);
        if (!q || q.length === 0) continue;
        const entry = q.shift()!;
        ranAny = true;

        const quota =
          entry.budget.queueDepthPerOwner * DRAIN_EXECUTIONS_PER_DEPTH_UNIT;
        const done = executed.get(owner) ?? 0;
        let outcome: RunOutcome;
        if (done >= quota) {
          outcome = refusedOutcome(
            "QUEUE_BUDGET_EXCEEDED",
            null,
            null,
            "owner drain quota exhausted",
          );
        } else {
          executed.set(owner, done + 1);
          outcome = this.executeEntry(entry, world, queues);
        }
        if (entry.resultIndex !== undefined) results[entry.resultIndex] = outcome;
      }
      if (!ranAny) return;
    }
  }

  private push(queues: Map<string, QueueEntry[]>, entry: QueueEntry): void {
    const q = queues.get(entry.owner);
    if (q) q.push(entry);
    else queues.set(entry.owner, [entry]);
  }

  private commit(
    queues: Map<string, QueueEntry[]>,
    pending: PendingEntry[],
    budget: Budget,
  ): void {
    for (const p of pending)
      this.push(queues, {
        actor: p.actor,
        owner: p.owner,
        budget,
        work: { kind: "attr", target: p.target, attr: p.attr, args: p.args },
      });
  }

  // ── executing one entry ────────────────────────────────────────────────

  private executeEntry(
    entry: QueueEntry,
    world: WorldAPI,
    queues: Map<string, QueueEntry[]>,
  ): RunOutcome {
    if (entry.work.kind === "program")
      return this.executeProgram(
        {
          actor: entry.actor,
          owner: entry.owner,
          program: entry.work.program,
          args: entry.work.args,
          budget: entry.budget,
        },
        world,
        queues,
      );

    // a committed follow-on: the attribute text is re-read AND
    // permission-re-checked at execution time (as the entry's ACTOR), never
    // captured at enqueue time
    const { target, attr, args } = entry.work;
    const meter = new Meter(entry.budget);
    const inv = new Invocation(
      entry.actor,
      meter,
      world,
      entry.budget,
      (owner) => queues.get(owner)?.length ?? 0,
      args,
      entry.owner,
    );
    return this.invoke(inv, meter, entry.budget, queues, () => {
      const text = inv.world.getAttr(entry.owner, target, attr);
      if (typeof text === "object") throw new RefusalSignal(text.refused);
      meter.chargeAlloc(text.length);
      const node = inv.parseCached(text);
      evaluate(inv, this.lib, node);
    });
  }

  private executeProgram(
    request: RunRequest,
    world: WorldAPI,
    queues: Map<string, QueueEntry[]>,
  ): RunOutcome {
    const meter = new Meter(request.budget);
    const inv = new Invocation(
      request.actor,
      meter,
      world,
      request.budget,
      (owner) => queues.get(owner)?.length ?? 0,
      request.args ?? [],
      request.owner,
    );
    return this.invoke(inv, meter, request.budget, queues, () => {
      const node = parse(request.program, meter);
      evaluate(inv, this.lib, node);
    });
  }

  /** The run boundary: refusals become values here; nothing throws across it. */
  private invoke(
    inv: Invocation,
    meter: Meter,
    budget: Budget,
    queues: Map<string, QueueEntry[]>,
    body: () => void,
  ): RunOutcome {
    try {
      body();
    } catch (err) {
      if (err instanceof RefusalSignal)
        return refusedOutcome(err.code, inv, meter, err.message);
      // defense in depth: an unexpected host exception is a typed refusal at
      // the boundary (never a crash into the server), surfaced via detail so
      // tests and logs still see the defect
      return refusedOutcome(
        "INVALID_PROGRAM",
        inv,
        meter,
        `internal: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // transactional commit — follow-on work survives only a COMPLETED run
    this.commit(queues, inv.enqueued, budget);
    return {
      status: "completed",
      output: [...inv.output],
      mutations: [...inv.mutations],
      stepsUsed: meter.stepsUsed,
    };
  }
}
