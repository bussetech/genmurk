// OPEN REGISTRATION + THE INSTANCE PASSPHRASE — a v1 acceptance gate
// (GENMURK-EPIC1-08 follow-on, GM-R18), end-to-end through the REAL stack.
// Proves the three-mode posture: closed refuses; open self-registers a
// BASE-TIER player who can then log in; passphrase mode refuses a wrong
// passphrase and admits the right one. Also proves the guards: one player per
// account, no duplicate names, self-registration never yields elevated power,
// and only a god may change the policy.
//
// Not in `npm test` (needs a live stack). Run against a freshly reset stack:
//   npm run db:reset
//   SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… \
//     npm run test:registration

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  provisionFirstBoot,
  registerOpen,
  getRegistrationMode,
  generateSecret,
  RegistrationRefused,
} from "../../src/server/auth.ts";
import { SupabaseGateway } from "../../src/server/supabase-gateway.ts";
import { signIn, type StackConfig } from "./auth-helpers.ts";

const url = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54541";
const anonKey = process.env["SUPABASE_ANON_KEY"] ?? "";
const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const cfg: StackConfig = { url, anonKey, serviceRoleKey: serviceKey };
const GOD_EMAIL = "god@genmurk.invalid";
const GOD_SECRET = generateSecret();
const PASSPHRASE = "open-sesame-" + randomBytes(4).toString("hex");
const TAG = randomBytes(3).toString("hex"); // fresh names/emails per run

let god: SupabaseClient;

const email = (who: string) => `reg-${TAG}-${who}@genmurk.invalid`;
const pname = (who: string) => `Reg_${TAG}_${who}`;

async function setMode(mode: "closed" | "open" | "passphrase", passphrase?: string): Promise<void> {
  const { error } = await god.rpc("world_set_registration", { p_mode: mode, p_passphrase: passphrase ?? null });
  assert.equal(error, null, `set mode ${mode}: ${error?.message}`);
}

before(async () => {
  assert.ok(anonKey && serviceKey, "set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (from `supabase start`)");
  // ensure a god exists and is bound with a known secret, so we can set policy
  const svc = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await svc.from("objects").update({ auth_user_id: null }).eq("dbref", 1).eq("type", "player");
  const { data } = await svc.auth.admin.listUsers({ perPage: 200 });
  const g = data?.users.find((u) => (u.email ?? "").toLowerCase() === GOD_EMAIL);
  if (g) await svc.auth.admin.deleteUser(g.id);
  await provisionFirstBoot(cfg, { email: GOD_EMAIL, secret: GOD_SECRET });
  const s = await signIn(cfg, GOD_EMAIL, GOD_SECRET);
  god = s.client;
}, { timeout: 60_000 });

test("default posture is closed — self-registration is refused", async () => {
  await setMode("closed");
  const mode = await getRegistrationMode(cfg);
  assert.equal(mode.mode, "closed");
  await assert.rejects(
    () => registerOpen(cfg, { name: pname("nope"), email: email("nope"), secret: generateSecret() }),
    (e: unknown) => e instanceof RegistrationRefused && /closed/i.test((e as Error).message),
  );
});

test("open mode: anyone self-registers a BASE-TIER player, and can then log in", async () => {
  await setMode("open");
  assert.equal((await getRegistrationMode(cfg)).mode, "open");
  const secret = generateSecret();
  const r = await registerOpen(cfg, { name: pname("newbie"), email: email("newbie"), secret });
  assert.ok(r.dbref > 1, "a new player object was created");

  // it is a base-tier player in Limbo #0 — no elevated power from registering
  const svc = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: row } = await svc.from("objects").select("power, dbref, location_id").eq("id", r.uuid).single();
  assert.equal(row!.power, "player", "self-registration never grants elevated power");
  const { data: limbo } = await svc.from("objects").select("id").eq("dbref", 0).single();
  assert.equal(row!.location_id, limbo!.id, "new player lands in Limbo #0");

  // and the credential actually works: sign in → the gateway binds the session
  const { token } = await signIn(cfg, email("newbie"), secret);
  const gw = new SupabaseGateway({ url, anonKey, serviceRoleKey: serviceKey });
  try {
    const player = await gw.authenticate(token);
    assert.ok(player, "the new player can authenticate");
    assert.equal(player.playerName, pname("newbie"));
    assert.equal(player.power, "player");
  } finally {
    await gw.close();
  }
});

test("passphrase mode: a wrong passphrase is refused, the right one admits", async () => {
  await setMode("passphrase", PASSPHRASE);
  const mode = await getRegistrationMode(cfg);
  assert.equal(mode.mode, "passphrase");
  assert.equal(mode.requiresPassphrase, true);

  await assert.rejects(
    () => registerOpen(cfg, { name: pname("wrong"), email: email("wrong"), secret: generateSecret(), passphrase: "not-it" }),
    (e: unknown) => e instanceof RegistrationRefused && /passphrase/i.test((e as Error).message),
  );
  await assert.rejects(
    () => registerOpen(cfg, { name: pname("none"), email: email("none"), secret: generateSecret() }),
    RegistrationRefused,
    "no passphrase at all is refused too",
  );
  const r = await registerOpen(cfg, {
    name: pname("right"),
    email: email("right"),
    secret: generateSecret(),
    passphrase: PASSPHRASE,
  });
  assert.ok(r.dbref > 1, "the correct passphrase admits");
});

test("one player per account, and no duplicate names", async () => {
  await setMode("open");
  const first = await registerOpen(cfg, { name: pname("acct"), email: email("acct"), secret: generateSecret() });
  assert.ok(first.dbref > 1);
  // same account (email) again → refused
  await assert.rejects(
    () => registerOpen(cfg, { name: pname("acct2"), email: email("acct"), secret: generateSecret() }),
    /already has a player/i,
  );
  // a different account taking the SAME name → refused
  await assert.rejects(
    () => registerOpen(cfg, { name: pname("acct"), email: email("acct-other"), secret: generateSecret() }),
    /already taken/i,
  );
});

test("registered players cannot change the registration policy — only god may", async () => {
  await setMode("open");
  const secret = generateSecret();
  await registerOpen(cfg, { name: pname("meddler"), email: email("meddler"), secret });
  const { client } = await signIn(cfg, email("meddler"), secret);
  const { error } = await client.rpc("world_set_registration", { p_mode: "closed" });
  assert.ok(error, "a base-tier player may not re-set the registration policy");
});

test("the mode probe is public and never carries the passphrase", async () => {
  await setMode("passphrase", PASSPHRASE);
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.rpc("world_registration_mode");
  assert.equal(error, null, "anon may read the mode");
  assert.equal((data as { mode: string }).mode, "passphrase");
  assert.ok(!JSON.stringify(data).toLowerCase().includes(PASSPHRASE.toLowerCase()), "the passphrase is never revealed");
});
