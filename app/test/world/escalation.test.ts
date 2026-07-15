// THE ESCALATION MATRIX — a v1 acceptance gate (GENMURK-EPIC1-08, GM-R15),
// end-to-end through the REAL stack. For each capability tier × privileged-verb
// class, the audited RPC — the FINAL wall under RLS — must allow exactly the
// right callers and refuse the rest, checked as the ACTOR (a verified JWT), not
// asserted in the abstract. It also proves the softcode-privilege case at the
// RPC wall: a builder's mutation, applied under the builder-owner's JWT (the
// exact path softcode writes take, snapshot.applyMutations), cannot touch a
// god-owned object — the escalation the stack-free test closes at the engine
// wall is closed again here at the data wall.
//
// Not in `npm test` (needs a live stack). Run against a freshly seeded stack:
//   npm run db:reset
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
//     npm run test:escalation

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { provisionCast, type Provisioned, type StackConfig } from "./auth-helpers.ts";

const url = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54541";
const anonKey = process.env["SUPABASE_ANON_KEY"] ?? "";
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const cfg: StackConfig = { url, anonKey, serviceRoleKey: serviceKey };

// the seeded tiers (supabase/seed.sql)
const CAST = [
  { name: "God", email: "god@genmurk.invalid" }, // god
  { name: "Merlin", email: "merlin@genmurk.invalid" }, // wizard
  { name: "Alice", email: "alice@genmurk.invalid" }, // builder (owns the lantern)
  { name: "Bob", email: "bob@genmurk.invalid" }, // builder (Cave)
  { name: "Cara", email: "cara@genmurk.invalid" }, // plain player
];

let seats: Record<string, Provisioned>;

function service(): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function uuidOf(name: string, type = "player"): Promise<string> {
  const { data, error } = await service()
    .from("objects")
    .select("id")
    .eq("name", name)
    .eq("type", type)
    .is("destroyed_at", null)
    .single();
  if (error || !data) throw new Error(`uuidOf ${type} ${name}: ${error?.message}`);
  return data.id as string;
}

/** Run a privileged RPC as a tier and report allowed/denied — allowed = no error. */
async function attempt(
  tier: string,
  rpc: string,
  params: Record<string, unknown>,
): Promise<{ allowed: boolean; message?: string }> {
  const { error } = await seats[tier]!.client.rpc(rpc, params);
  return { allowed: error === null, message: error?.message };
}

before(async () => {
  assert.ok(anonKey && serviceKey, "set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (from `supabase start`)");
  seats = await provisionCast(cfg, CAST);
}, { timeout: 60_000 });

// ------------------------------------------------------- build (builder+)

test("world_create (build): player DENIED; builder/wizard/god ALLOWED", async () => {
  assert.equal((await attempt("Cara", "world_create", { p_name: "cara junk" })).allowed, false, "player cannot build");
  assert.equal((await attempt("Alice", "world_create", { p_name: "alice box" })).allowed, true, "builder builds");
  assert.equal((await attempt("Merlin", "world_create", { p_name: "merlin box" })).allowed, true, "wizard builds");
  assert.equal((await attempt("God", "world_create", { p_name: "god box" })).allowed, true, "god builds");
});

// --------------------------------------------------- set_power (god only)

test("world_set_power (re-grade a tier): ONLY god may; player/builder/wizard DENIED", async () => {
  const cara = await uuidOf("Cara");
  assert.equal((await attempt("Cara", "world_set_power", { p_target: cara, p_power: "wizard" })).allowed, false, "player denied");
  assert.equal((await attempt("Alice", "world_set_power", { p_target: cara, p_power: "wizard" })).allowed, false, "builder denied");
  assert.equal((await attempt("Merlin", "world_set_power", { p_target: cara, p_power: "wizard" })).allowed, false, "WIZARD denied (not god)");
  assert.equal((await attempt("God", "world_set_power", { p_target: cara, p_power: "builder" })).allowed, true, "god may re-grade");
});

test("God #1 may never be demoted (root authority is never lost)", async () => {
  const god = await uuidOf("God");
  const r = await attempt("God", "world_set_power", { p_target: god, p_power: "player" });
  assert.equal(r.allowed, false, "even god cannot demote God #1");
  assert.match(r.message ?? "", /demoted|root/i);
});

// ------------------------------------ control / moderation (own or wizard+)

test("world_destroy (moderation prelude): non-owner player DENIED; owner ALLOWED; wizard ALLOWED over another's", async () => {
  // Alice builds two throwaways she owns
  const svc = service();
  const { data: t1 } = await seats["Alice"]!.client.rpc("world_create", { p_name: "alice throwaway 1" });
  const { data: t2 } = await seats["Alice"]!.client.rpc("world_create", { p_name: "alice throwaway 2" });
  // move them into Town so co-located Cara/Merlin can reference (service role)
  const town = await uuidOf("Town Square", "room");
  await svc.from("objects").update({ location_id: town }).in("id", [t1 as string, t2 as string]);

  assert.equal((await attempt("Cara", "world_destroy", { p_target: t1 as string })).allowed, false, "co-located non-owner cannot destroy");
  assert.equal((await attempt("Alice", "world_destroy", { p_target: t1 as string })).allowed, true, "owner destroys her own");
  assert.equal((await attempt("Merlin", "world_destroy", { p_target: t2 as string })).allowed, true, "wizard destroys another's (moderation)");
});

// -------------------------------------------- forced movement (wizard+)

test("world_move (forced movement of another player): plain player DENIED; wizard ALLOWED", async () => {
  const bob = await uuidOf("Bob");
  const cara = await uuidOf("Cara");
  const cave = await uuidOf("Dark Cave", "room");
  assert.equal((await attempt("Cara", "world_move", { p_what: bob, p_dest: cave })).allowed, false, "a player cannot shove another player");
  assert.equal((await attempt("Merlin", "world_move", { p_what: cara, p_dest: cave })).allowed, true, "a wizard may force-move (controls all)");
});

// ------------------ softcode-privilege at the RPC wall (owner attribution)

test("softcode-privilege: a builder-owner's mutation cannot write a GOD-OWNED object — but CAN write its own", async () => {
  // Softcode journals writes and applies them under its OBJECT'S OWNER's JWT
  // (snapshot.applyMutations). This is that exact call: Alice (builder) is the
  // owner-principal. A god-owned target is refused; her own lantern is allowed.
  const town = await uuidOf("Town Square", "room"); // owned by God
  const lantern = await uuidOf("a brass lantern", "thing"); // owned by Alice

  const denied = await attempt("Alice", "world_set_attr", { p_target: town, p_name: "PWNED", p_value: "1" });
  assert.equal(denied.allowed, false, "the builder-owner cannot write a god-owned object — the escalation wall holds");

  const allowed = await attempt("Alice", "world_set_attr", { p_target: lantern, p_name: "POLISH", p_value: "high" });
  assert.equal(allowed.allowed, true, "she CAN write her own object — the deny is about ownership, not a dead path");
});
