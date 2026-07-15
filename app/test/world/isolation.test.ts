// THE ISOLATION PROOF — a v1 acceptance gate (GENMURK-EPIC1-04, task 4).
// Authorization is enforced at the DATA layer and is provable: this signs in
// as players at every capability tier against a real local Supabase stack and
// asserts the EXACT rows each sees. A cross-room read returns ZERO ROWS, not
// an error; anonymous sees nothing anywhere; a non-visual attribute is a zero
// row to a co-located non-owner. It also proves the destroy→recover→
// recover-after-window lifecycle (task 4 / AC3) and the end-to-end engine +
// real world-API + Postgres commit loop (AC4, "budgets hold across real I/O").
//
// Run against a freshly seeded stack:
//   npm run db:reset
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
//     npm run test:isolation

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createEngine } from "../../src/engine/engine.ts";
import { createWorldModel } from "../../src/world/world-api.ts";
import { loadSnapshot, applyMutations } from "../../src/world/snapshot.ts";
import type { Budget } from "../../src/engine/types.ts";
import { provisionCast, type StackConfig } from "./auth-helpers.ts";

const url = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54541";
const anonKey = process.env["SUPABASE_ANON_KEY"] ?? "";
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const cfg: StackConfig = { url, anonKey, serviceRoleKey: serviceKey };

// player name -> { email, tier } (the seeded world; see supabase/seed.sql)
const PLAYERS = [
  { name: "God", email: "god@genmurk.invalid", tier: "god" },
  { name: "Merlin", email: "merlin@genmurk.invalid", tier: "wizard" },
  { name: "Alice", email: "alice@genmurk.invalid", tier: "builder" },
  { name: "Bob", email: "bob@genmurk.invalid", tier: "builder" },
  { name: "Cara", email: "cara@genmurk.invalid", tier: "player" },
];

function service(): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function count(db: SupabaseClient, table: string): Promise<number> {
  const { count: n, error } = await db.from(table).select("*", { count: "exact", head: true });
  assert.equal(error, null, `${table} must return rows, not an error: ${error?.message}`);
  return n ?? 0;
}

async function names(db: SupabaseClient, table = "objects"): Promise<string[]> {
  const { data, error } = await db.from(table).select("name").order("name");
  assert.equal(error, null, `${table}: ${error?.message}`);
  return (data ?? []).map((r) => (r as { name: string }).name).sort();
}

const clients: Record<string, SupabaseClient> = {};

before(async () => {
  assert.ok(anonKey && serviceKey, "set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (from `supabase start`)");
  // real accounts, real sign-ins, per-run random secret (auth-helpers.ts) —
  // the same JWT-scoped clients a real player would drive.
  const provisioned = await provisionCast(cfg, PLAYERS);
  for (const p of PLAYERS) clients[p.name] = provisioned[p.name]!.client;
}, { timeout: 60_000 });

// ---------------------------------------------------------------- anonymous

test("anonymous sees zero rows in every table — and zero errors", async () => {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  for (const table of [
    "objects", "object_attributes", "object_locks", "world_events", "object_audit", "app_settings",
  ]) {
    assert.equal(await count(anon, table), 0, table);
  }
});

// ---------------------------------------------------------- builder (Alice)

test("Alice (builder, Town Square) sees exactly her room, its occupants, and what she owns", async () => {
  const db = clients["Alice"]!;
  assert.equal(await count(db, "objects"), 6);
  assert.deepEqual(
    await names(db),
    ["Alice", "Merlin", "Town Square", "a brass lantern", "Cara", "north"].sort(),
  );
  // all four object types are represented in what she can see (task 4)
  const { data } = await db.from("objects").select("type");
  const types = new Set((data ?? []).map((r) => (r as { type: string }).type));
  assert.deepEqual([...types].sort(), ["exit", "player", "room", "thing"]);
});

test("Alice reads her lantern's visual AND non-visual attributes (she owns it)", async () => {
  const db = clients["Alice"]!;
  assert.equal(await count(db, "object_attributes"), 2); // DESC + SECRET on the lantern
  const { data } = await db.from("object_attributes").select("name").order("name");
  assert.deepEqual((data ?? []).map((r) => (r as { name: string }).name), ["DESC", "SECRET"]);
  assert.equal(await count(db, "object_locks"), 1); // her lantern's pickup lock
});

test("Alice cannot see the Cave, Bob, or the key — zero rows, not errors", async () => {
  const db = clients["Alice"]!;
  for (const name of ["Dark Cave", "Bob", "a rusty key"]) {
    const { data, error } = await db.from("objects").select("*").eq("name", name);
    assert.equal(error, null, name);
    assert.deepEqual(data, [], `${name} must be invisible (zero rows)`);
  }
  assert.equal(await count(db, "object_audit"), 0); // audit is wizard-only
  assert.equal(await count(db, "app_settings"), 0);
});

// ------------------------------------------------------------ player (Cara)

test("Cara (plain player, co-located with the lantern) reads its DESC but NOT its SECRET", async () => {
  const db = clients["Cara"]!;
  assert.equal(await count(db, "objects"), 6); // same room as Alice
  assert.equal(await count(db, "object_attributes"), 1); // visual DESC only
  const { data } = await db.from("object_attributes").select("name");
  assert.deepEqual((data ?? []).map((r) => (r as { name: string }).name), ["DESC"]);
  // the non-visual SECRET is a zero row to a co-located non-owner
  const { data: secret } = await db.from("object_attributes").select("*").eq("name", "SECRET");
  assert.deepEqual(secret, []);
  assert.equal(await count(db, "object_locks"), 0); // not the owner → no lock visibility
});

// ------------------------------------------------------------ builder (Bob)

test("Bob (builder, Dark Cave) sees the Cave and his key, not the Town", async () => {
  const db = clients["Bob"]!;
  assert.equal(await count(db, "objects"), 4); // Cave, self, south exit, his key
  assert.deepEqual(await names(db), ["Bob", "Dark Cave", "a rusty key", "south"].sort());
  assert.equal(await count(db, "object_attributes"), 1); // his key's DESC
});

// ------------------------------------------------------- wizard (Merlin) / god

test("Merlin (wizard) sees the whole world, including the destroyed lamp and the audit trail", async () => {
  const db = clients["Merlin"]!;
  assert.equal(await count(db, "objects"), 13); // all 13, incl. the destroyed #12
  const ns = await names(db);
  assert.ok(ns.includes("a broken lamp"), "wizard sees the bin");
  assert.equal(await count(db, "object_attributes"), 3); // every attribute
  assert.equal(await count(db, "object_locks"), 1);
  assert.ok((await count(db, "object_audit")) > 0, "wizard reads the audit trail");
  // recovery_window_seconds, default_quota (04) + registration_mode,
  // registration_passphrase_hash (08 open-registration migration)
  assert.equal(await count(db, "app_settings"), 4);
});

test("God (god tier) also sees the whole world", async () => {
  const db = clients["God"]!;
  assert.equal(await count(db, "objects"), 13);
});

// ------------------------------------------------ destroy → recover (AC3)

test("destroy → recover within window → recover-after-window refused", async () => {
  const alice = clients["Alice"]!;
  const admin = service();

  // Alice builds a throwaway thing and destroys it
  const { data: id, error: cErr } = await alice.rpc("world_create", { p_name: "a paper cup" });
  assert.equal(cErr, null, cErr?.message);
  const target = id as unknown as string;

  const { error: dErr } = await alice.rpc("world_destroy", { p_target: target });
  assert.equal(dErr, null, dErr?.message);
  // destroyed → Alice (non-wizard) can no longer see it
  const gone = await alice.from("objects").select("*").eq("id", target);
  assert.deepEqual(gone.data, []);

  // recover within the window → visible again
  const { error: rErr } = await alice.rpc("world_recover", { p_target: target });
  assert.equal(rErr, null, rErr?.message);
  const back = await alice.from("objects").select("id").eq("id", target);
  assert.equal(back.data?.length, 1);

  // destroy again, backdate past the window (service role), recover must refuse
  await alice.rpc("world_destroy", { p_target: target });
  await admin.from("objects").update({ destroyed_at: "2000-01-01T00:00:00Z" }).eq("id", target);
  const { error: lateErr } = await alice.rpc("world_recover", { p_target: target });
  assert.ok(lateErr, "recovery after the window must be refused");
  assert.match(lateErr!.message, /window/i);
});

// -------------------------------- end-to-end: engine + real world-API + DB

const BUDGET: Budget = {
  steps: 100000, recursionDepth: 32, enqueuePerRun: 8,
  queueDepthPerOwner: 16, allocationBytes: 1048576, wallClockMs: 2000,
};

test("engine runs a softcode program through the REAL world-API against Postgres, and it commits", async () => {
  const svc = service();
  const alice = clients["Alice"]!;

  // load Alice's neighborhood, run a program that sets an attribute on herself
  const { snapshot, refToUuid } = await loadSnapshot(svc, /* Alice dbref */ 5);
  const world = createWorldModel(snapshot);
  const engine = createEngine({ instrumentation: true });
  const outcome = engine.run(
    { actor: "#5", program: 'obj.setAttr(me, "MOOD", "cheerful")', budget: BUDGET },
    world,
  );
  assert.equal(outcome.status, "completed", outcome.detail ?? "");
  assert.deepEqual(world.mutations, [{ op: "setAttr", target: "#5", detail: "MOOD=cheerful" }]);

  // commit the buffered mutation through the audited RPC, as Alice
  await applyMutations(alice, refToUuid, world.mutations);

  // it persisted: Alice reads her own new attribute back from the database
  const { data } = await alice
    .from("object_attributes")
    .select("value")
    .eq("name", "MOOD")
    .eq("object_id", refToUuid.get("#5")!);
  assert.equal((data?.[0] as { value: string } | undefined)?.value, "cheerful");
});
