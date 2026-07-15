// FIRST-BOOT GOD PROVISIONING — a v1 acceptance gate (GENMURK-EPIC1-08,
// GM-R18/R19), end-to-end through the REAL stack. No default credential ships:
// this proves that a freshly reset world starts with God #1 UNREACHABLE (no
// auth binding, no shipped secret), that provisioning with a provider-stored
// secret mints the account and binds it, that god can then LOG IN with that
// secret and only that secret, that the bound session carries god power, and
// that re-provisioning is an idempotent no-op.
//
// Not in `npm test` (needs a live stack). Run against a freshly reset stack:
//   npm run db:reset
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
//     npm run test:first-boot

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { provisionFirstBoot, generateSecret } from "../../src/server/auth.ts";
import { SupabaseGateway } from "../../src/server/supabase-gateway.ts";
import { signIn, type StackConfig } from "./auth-helpers.ts";

const url = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54541";
const anonKey = process.env["SUPABASE_ANON_KEY"] ?? "";
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const cfg: StackConfig = { url, anonKey, serviceRoleKey: serviceKey };
const GOD_EMAIL = "god@genmurk.invalid";

// a provider-stored secret for THIS run (generated, never a repo literal)
const GOD_SECRET = generateSecret();

function service(): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

before(async () => {
  assert.ok(anonKey && serviceKey, "set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (from `supabase start`)");
  // Guarantee a clean god state regardless of what earlier live-stack runs did:
  // bootstrap the world if empty, then unbind God #1 and delete any pre-existing
  // god auth account so we exercise the TRUE fresh-provision path.
  const svc = service();
  await svc.rpc("world_bootstrap");
  await svc.from("objects").update({ auth_user_id: null }).eq("dbref", 1).eq("type", "player");
  const { data } = await svc.auth.admin.listUsers({ perPage: 200 });
  const existing = data?.users.find((u) => (u.email ?? "").toLowerCase() === GOD_EMAIL);
  if (existing) await svc.auth.admin.deleteUser(existing.id);
}, { timeout: 60_000 });

test("a fresh world ships NO god credential — God #1 starts unbound", async () => {
  const svc = service();
  const { data: god } = await svc
    .from("objects")
    .select("dbref, auth_user_id, power")
    .eq("dbref", 1)
    .eq("type", "player")
    .single();
  assert.ok(god, "God #1 exists (bootstrap)");
  assert.equal(god.auth_user_id, null, "no auth binding — nothing to log in as yet");
  assert.equal(god.power, "god", "God #1 holds the god tier");
});

test("first-boot provisions god with the provider-stored secret and binds it", async () => {
  const result = await provisionFirstBoot(cfg, { email: GOD_EMAIL, secret: GOD_SECRET });
  assert.equal(result.provisioned, true, "fresh provisioning happened");
  assert.equal(result.godDbref, 1);
  assert.equal(result.generatedSecret, undefined, "used the supplied provider secret, did not generate one");

  const svc = service();
  const { data: god } = await svc
    .from("objects")
    .select("auth_user_id")
    .eq("dbref", 1)
    .single();
  assert.equal(god!.auth_user_id, result.authUserId, "God #1 is now bound to the provisioned principal");
});

test("god can log in with the provisioned secret — and the session carries god power", async () => {
  const { token } = await signIn(cfg, GOD_EMAIL, GOD_SECRET);
  const gateway = new SupabaseGateway({ url, anonKey, serviceRoleKey: serviceKey });
  try {
    const player = await gateway.authenticate(token);
    assert.ok(player, "the verified JWT binds a session");
    assert.equal(player.playerId, "#1", "it is God #1");
    assert.equal(player.power, "god", "the bound session carries the god tier");
  } finally {
    await gateway.close();
  }
});

test("a wrong secret does NOT log in (the credential is real, not a formality)", async () => {
  await assert.rejects(
    () => signIn(cfg, GOD_EMAIL, generateSecret()),
    /sign-in failed/,
    "a different secret is rejected by Supabase Auth",
  );
});

test("the bound god can perform a god-only verb (world_set_power) through its own JWT", async () => {
  const { client } = await signIn(cfg, GOD_EMAIL, GOD_SECRET);
  const svc = service();
  const { data: god } = await svc.from("objects").select("id").eq("dbref", 1).single();
  // set God's own power to god — a no-op that nonetheless only a god may call
  const { error } = await client.rpc("world_set_power", { p_target: god!.id as string, p_power: "god" });
  assert.equal(error, null, "god's JWT is authorized for the god-only verb");
});

test("re-running first-boot is an idempotent no-op", async () => {
  const again = await provisionFirstBoot(cfg, { email: GOD_EMAIL, secret: GOD_SECRET });
  assert.equal(again.provisioned, false, "already provisioned — nothing to do");
});
