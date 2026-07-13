// The proof harness. Runs every adversarial fixture against the current
// engine build (app/engine-status.json) in an isolated worker with an
// external wall-clock watchdog, and emits a pass/fail table.
//
// Two modes, keyed off engine-status.json:
//   status "stub"      — PLUMBING proof. Every run must refuse with
//                        ENGINE_NOT_IMPLEMENTED; prints "SANDBOX NOT PROVEN".
//                        Exit 0 while the stub behaves, so the epic can land
//                        the harness before the engine.
//   "candidate"/"proven" — the HARD GATE. Every fixture must meet its
//                        `expect`. Any miss, hang, or crash fails the run
//                        (exit 1). A green run here is the recorded evidence
//                        for hosted exposure (GM-R14; design record §5).
//
// Regardless of mode, a WATCHDOG SELF-TEST runs first: the deliberately
// hanging engine must be detected and killed from outside. If the watchdog
// can't catch a hang, "never a hang" is untested and the harness fails.

import { Worker } from "node:worker_threads";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { RunOutcome } from "../../src/engine/types.js";
import type {
  EngineStatus,
  Fixture,
  FixtureExpect,
} from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "../..");
const FIXTURE_DIR = join(APP_ROOT, "test/softcode-adversarial/fixtures");
const WORKER = join(HERE, "run-fixture.ts");

// AC4: with GENMURK_REAL_WORLD=1 the same pack runs against the production
// world model (src/world) in place of the toy recording world — proving
// budgets and refusals hold across the real permission/inheritance machinery.
const REAL_WORLD = process.env["GENMURK_REAL_WORLD"] === "1";

interface WorkerResult {
  outcomes: RunOutcome[];
  mutations: { op: string; target: string; detail: string }[];
  integrity?: RunOutcome;
  error?: string;
}

type RunReport =
  | { kind: "result"; result: WorkerResult; ms: number }
  | { kind: "hang"; ms: number };

/** Spawn the worker for one fixture; kill and report a hang on timeout. */
function runInWorker(fixture: Fixture, engineModulePath: string): Promise<RunReport> {
  const timeoutMs = Math.max(fixture.budget.wallClockMs * 2, fixture.budget.wallClockMs + 4000);
  const started = Date.now();
  return new Promise((resolvePromise) => {
    const worker = new Worker(WORKER, {
      workerData: { fixture, engineModulePath, realWorld: REAL_WORLD },
    });
    let settled = false;
    const finish = (r: RunReport) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolvePromise(r);
    };
    const timer = setTimeout(
      () => finish({ kind: "hang", ms: Date.now() - started }),
      timeoutMs,
    );
    worker.on("message", (result: WorkerResult) =>
      finish({ kind: "result", result, ms: Date.now() - started }),
    );
    worker.on("error", (err) =>
      finish({
        kind: "result",
        result: { outcomes: [], mutations: [], error: `worker error: ${err.message}` },
        ms: Date.now() - started,
      }),
    );
    // A worker that exits WITHOUT posting a result and without an 'error'
    // event (an engine that calls process.exit, or drains the event loop
    // silently) would otherwise only settle via the watchdog and be
    // mislabelled a HANG. Report it as the crash it is — precise failure
    // diagnosis is the point of a proof harness. Normal completion posts a
    // 'message' first, so this handler no-ops there via the settled guard.
    worker.on("exit", (code) =>
      finish({
        kind: "result",
        result: {
          outcomes: [],
          mutations: [],
          error: `worker exited (code ${code}) before returning a result`,
        },
        ms: Date.now() - started,
      }),
    );
  });
}

function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf8")) as Fixture);
}

function loadStatus(): EngineStatus {
  return JSON.parse(
    readFileSync(join(APP_ROOT, "engine-status.json"), "utf8"),
  ) as EngineStatus;
}

// ── expectation checking ─────────────────────────────────────────────────

function checkOne(outcome: RunOutcome, expect: FixtureExpect): string | null {
  if (!expect.statusAnyOf.includes(outcome.status))
    return `status ${outcome.status} not in [${expect.statusAnyOf.join(",")}]`;
  if (outcome.status === "refused") {
    const allowed = expect.refusalCodesAnyOf ?? [];
    if (allowed.length && !allowed.includes(outcome.refusalCode!))
      return `refusal ${outcome.refusalCode} not in [${allowed.join(",")}]`;
  }
  if (expect.output && !arraysEqual(outcome.output, expect.output))
    return `output ${JSON.stringify(outcome.output)} != ${JSON.stringify(expect.output)}`;
  if (expect.outputMustNotContain) {
    const joined = outcome.output.join("\n");
    for (const forbidden of expect.outputMustNotContain)
      if (joined.includes(forbidden)) return `output leaked forbidden substring ${JSON.stringify(forbidden)}`;
  }
  return null;
}

function checkMutations(
  actual: { op: string; target: string; detail: string }[],
  expect: FixtureExpect[],
): string | null {
  const wanted = expect.flatMap((e) => e.mutations);
  if (actual.length !== wanted.length)
    return `mutations count ${actual.length} != ${wanted.length} (${JSON.stringify(actual)})`;
  for (let i = 0; i < wanted.length; i++) {
    const a = actual[i];
    const w = wanted[i];
    if (a.op !== w.op || a.target !== w.target || a.detail !== w.detail)
      return `mutation[${i}] ${JSON.stringify(a)} != ${JSON.stringify(w)}`;
  }
  return null;
}

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Gate mode: does the worker result satisfy the fixture's declared expectations? */
function evaluateGate(fixture: Fixture, report: RunReport): string | null {
  if (report.kind === "hang")
    return `HANG — engine did not return within watchdog window (${report.ms}ms)`;
  const { result } = report;
  if (result.error) return `CRASH — ${result.error}`;
  if (result.outcomes.length !== fixture.expect.length)
    return `run count ${result.outcomes.length} != expect count ${fixture.expect.length}`;
  for (let i = 0; i < fixture.expect.length; i++) {
    const err = checkOne(result.outcomes[i], fixture.expect[i]);
    if (err) return `run[${i}]: ${err}`;
  }
  const mutErr = checkMutations(result.mutations, fixture.expect);
  if (mutErr) return mutErr;
  if (fixture.integrityProbe) {
    const p = result.integrity;
    if (!p) return "integrity probe missing";
    if (p.status !== "completed" || !arraysEqual(p.output, ["2"]))
      return `integrity probe: expected completed ["2"], got ${p.status} ${JSON.stringify(p.output)}`;
  }
  return null;
}

/** Stub mode: every run must refuse with ENGINE_NOT_IMPLEMENTED (plumbing). */
function evaluateStub(fixture: Fixture, report: RunReport): string | null {
  if (report.kind === "hang") return `HANG — stub should return immediately (${report.ms}ms)`;
  const { result } = report;
  if (result.error) return `CRASH — ${result.error}`;
  for (const o of result.outcomes)
    if (o.status !== "refused" || o.refusalCode !== "ENGINE_NOT_IMPLEMENTED")
      return `stub returned ${o.status}/${o.refusalCode ?? "-"}, expected refused/ENGINE_NOT_IMPLEMENTED`;
  if (result.mutations.length)
    return `stub mutated the world (${result.mutations.length} writes)`;
  return null;
}

// ── watchdog self-test ───────────────────────────────────────────────────

async function watchdogSelfTest(): Promise<boolean> {
  const hangEngine = join(APP_ROOT, "src/engine/hang-stub.ts");
  const probe: Fixture = {
    name: "watchdog-self-test",
    attackClass: "harness",
    description: "the hanging engine must be caught from outside",
    budget: { steps: 100, recursionDepth: 4, enqueuePerRun: 1, queueDepthPerOwner: 1, allocationBytes: 1024, wallClockMs: 200 },
    runs: [{ actor: "#1", program: "t.noop()" }],
    expect: [{ statusAnyOf: ["completed"], mutations: [] }],
  };
  const report = await runInWorker(probe, hangEngine);
  const caught = report.kind === "hang";
  console.log(
    caught
      ? `  watchdog self-test: PASS (hang caught in ${report.ms}ms)`
      : `  watchdog self-test: FAIL (hang not caught — "never a hang" is untested)`,
  );
  return caught;
}

// ── main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const status = loadStatus();
  const fixtures = loadFixtures();
  const engineModulePath = resolve(APP_ROOT, status.engineModule);

  console.log(`\nGenMURK softcode adversarial proof harness`);
  console.log(`engine: ${status.engineModule}  (status: ${status.status})`);
  console.log(`world:  ${REAL_WORLD ? "REAL (src/world) — AC4 swap" : "toy recording world"}`);
  console.log(`fixtures: ${fixtures.length}\n`);

  const watchdogOk = await watchdogSelfTest();
  console.log("");

  const isGate = status.status !== "stub";
  const rows: { name: string; cls: string; ok: boolean; note: string; ms: number }[] = [];

  for (const fx of fixtures) {
    const report = await runInWorker(fx, engineModulePath);
    const err = isGate ? evaluateGate(fx, report) : evaluateStub(fx, report);
    rows.push({
      name: fx.name,
      cls: fx.attackClass,
      ok: err === null,
      note: err ?? "ok",
      ms: report.ms,
    });
  }

  const nameW = Math.max(...rows.map((r) => r.name.length), 4);
  const clsW = Math.max(...rows.map((r) => r.cls.length), 5);
  console.log(`  ${"FIXTURE".padEnd(nameW)}  ${"CLASS".padEnd(clsW)}  RESULT   ${"TIME".padStart(6)}  NOTE`);
  console.log(`  ${"-".repeat(nameW)}  ${"-".repeat(clsW)}  ------   ${"----".padStart(6)}  ----`);
  for (const r of rows) {
    const mark = r.ok ? "PASS" : "FAIL";
    console.log(`  ${r.name.padEnd(nameW)}  ${r.cls.padEnd(clsW)}  ${mark.padEnd(7)}  ${`${r.ms}ms`.padStart(6)}  ${r.note}`);
  }

  const passed = rows.filter((r) => r.ok).length;
  const failed = rows.length - passed;
  const byClass = [...new Set(rows.map((r) => r.cls))].sort();
  console.log(`\n  attack classes: ${byClass.length} — ${byClass.join(", ")}`);
  console.log(`  fixtures: ${passed}/${rows.length} passed, ${failed} failed`);

  if (!isGate) {
    console.log(`\n  ===================================================`);
    console.log(`  SANDBOX NOT PROVEN — engine is a stub.`);
    console.log(`  This run proves the harness plumbing only. The GM-R14`);
    console.log(`  gate is unmet until a real engine flips engine-status`);
    console.log(`  to "candidate" and this table is all-green under it.`);
    console.log(`  ===================================================`);
    // Plumbing proof: stub must behave AND the watchdog must catch a hang.
    process.exit(watchdogOk && failed === 0 ? 0 : 1);
  }

  console.log(
    failed === 0 && watchdogOk
      ? `\n  SANDBOX PROOF: GREEN — this table is the GM-R14 gate evidence.`
      : `\n  SANDBOX PROOF: RED — hosted exposure is blocked.`,
  );
  process.exit(failed === 0 && watchdogOk ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error("harness crashed:", err);
  process.exit(1);
});
