// GM-R18 authentication & provisioning — the server plane's half of the auth
// story. The era's fixed-salt DES hashing and shipped default god/wizard
// credentials are replaced by today's standard: Supabase Auth (the sanctioned
// KDF, argon2/bcrypt-class per ADR-0048) holds every credential; the studio
// never ships one. This is the state of the art advancing on what the
// reference taught — not the reference being wrong (GD-0025).
//
// Two provisioning acts live here, both server-plane (service_role): FIRST-BOOT
// GOD PROVISIONING (GM-R18: no default credentials — the god account is minted
// on first boot with a ROTATED secret sourced from the provider store) and
// closed-signup PLAYER REGISTRATION (the ruled v1 posture — decisions.md).
// The auth ACCOUNT (its hashed secret) lives only in Supabase Auth; the SQL
// half (world_bind_auth) links the principal to a player object and never sees
// a password (GM-R19). The plaintext secret exists in this process for exactly
// as long as it takes to hand to Supabase Auth, and — when generated rather
// than supplied — is returned to the caller to emit ONCE and store in the
// provider store; it is never written to the repo, a fixture, or a log.

import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface AdminConfig {
  url: string;
  serviceRoleKey: string;
}

/** A cryptographically random secret for a provisioned account, when the
 *  provider store did not supply one. 32 bytes base64url ≈ 256 bits. */
export function generateSecret(): string {
  return randomBytes(32).toString("base64url");
}

function admin(cfg: AdminConfig): SupabaseClient {
  return createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Find an existing auth user by email (idempotent provisioning), or null. */
async function findAuthUser(svc: SupabaseClient, email: string): Promise<{ id: string } | null> {
  const wanted = email.toLowerCase();
  // page through — dev worlds are small; a real directory would filter server-side.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers: ${error.message}`);
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === wanted);
    if (found) return { id: found.id };
    if (data.users.length < 200) break;
  }
  return null;
}

/** Create the auth account for a provisioned identity, or reuse an existing
 *  one with the same email (idempotent). The secret is NEVER logged. */
async function ensureAuthUser(
  svc: SupabaseClient,
  email: string,
  secret: string,
): Promise<{ id: string; created: boolean }> {
  const existing = await findAuthUser(svc, email);
  if (existing) return { id: existing.id, created: false };
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: secret,
    email_confirm: true, // no email round-trip in v1 (closed signup) — abuse note in decisions.md
  });
  if (error || !data.user) throw new Error(`createUser ${email}: ${error?.message}`);
  return { id: data.user.id, created: true };
}

export interface FirstBootResult {
  /** true when THIS call performed the god binding (fresh stack); false when
   *  the world was already provisioned (idempotent no-op). */
  provisioned: boolean;
  godDbref: number;
  godEmail: string;
  authUserId: string;
  /** the secret to emit ONCE and store in the provider store — present ONLY
   *  when this call generated it (no `secret` was supplied). Never persisted. */
  generatedSecret?: string;
}

export interface FirstBootOptions {
  /** the god account's login identity (provider store / GENMURK_GOD_EMAIL). */
  email: string;
  /** the rotated secret from the provider store (GENMURK_GOD_SECRET). When
   *  omitted, a random one is generated and returned for the operator to
   *  store — first boot NEVER falls back to a fixed default (GM-R18). */
  secret?: string;
}

/**
 * GM-R18 first-boot god provisioning. Idempotent, automated, and default-free:
 *   1. bootstrap the world (Limbo #0 + God #1) if empty — the RPC no-ops on a
 *      populated world.
 *   2. if God #1 is already bound to an auth principal, return (nothing to do).
 *   3. otherwise mint (or reuse) the god auth account with the provider-stored
 *      or freshly generated secret, and bind it via the audited SQL RPC.
 * A fresh stack thus ends with god reachable ONLY through a real credential
 * that never shipped in the repo — the acceptance gate 08 must clear.
 */
export async function provisionFirstBoot(
  cfg: AdminConfig,
  opts: FirstBootOptions,
): Promise<FirstBootResult> {
  const svc = admin(cfg);

  const { error: bootErr } = await svc.rpc("world_bootstrap");
  if (bootErr) throw new Error(`world_bootstrap: ${bootErr.message}`);

  const { data: god, error: godErr } = await svc
    .from("objects")
    .select("id, dbref, auth_user_id")
    .eq("dbref", 1)
    .eq("type", "player")
    .single();
  if (godErr || !god) throw new Error(`god #1 not found after bootstrap: ${godErr?.message}`);

  if (god.auth_user_id) {
    return {
      provisioned: false,
      godDbref: 1,
      godEmail: opts.email,
      authUserId: god.auth_user_id as string,
    };
  }

  const generated = opts.secret ? undefined : generateSecret();
  const secret = opts.secret ?? generated!;
  const authUser = await ensureAuthUser(svc, opts.email, secret);

  const { error: bindErr } = await svc.rpc("world_bind_auth", {
    p_player: god.id as string,
    p_auth: authUser.id,
  });
  if (bindErr) throw new Error(`world_bind_auth (god): ${bindErr.message}`);

  return {
    provisioned: true,
    godDbref: 1,
    godEmail: opts.email,
    authUserId: authUser.id,
    ...(generated ? { generatedSecret: generated } : {}),
  };
}

// ------------------------------------------------------- open registration

export interface RegistrationMode {
  mode: "closed" | "open" | "passphrase";
  requiresPassphrase: boolean;
}

/** The instance's current registration posture — safe to show anyone (it never
 *  reveals the passphrase), so a client can prompt correctly before any login. */
export async function getRegistrationMode(cfg: AdminConfig): Promise<RegistrationMode> {
  const { data, error } = await admin(cfg).rpc("world_registration_mode");
  if (error) throw new Error(`registration mode: ${error.message}`);
  const row = data as { mode: RegistrationMode["mode"]; requires_passphrase: boolean };
  return { mode: row.mode, requiresPassphrase: row.requires_passphrase };
}

export interface RegisterOpenOptions {
  name: string;
  email: string;
  /** the new player's chosen secret; generated + returned if omitted */
  secret?: string;
  /** the instance passphrase, when the instance is in `passphrase` mode */
  passphrase?: string;
}

/** Raised when the registration gate refuses (closed instance / wrong
 *  passphrase). A distinct type so the transport can map it to a clean
 *  client error without leaking which it was beyond what the mode already tells. */
export class RegistrationRefused extends Error {}

/**
 * Self-service registration (GM-R18; the ruled open-signup posture). Checks the
 * instance gate FIRST — nothing is minted for a closed instance or a wrong
 * passphrase — then creates the auth account (Supabase Auth's KDF) and a
 * BASE-TIER player bound to it, in one shot. On any failure after the account
 * is created, the orphan account is removed. Self-registration never yields
 * elevated power.
 */
export async function registerOpen(
  cfg: AdminConfig,
  opts: RegisterOpenOptions,
): Promise<RegisterPlayerResult> {
  const svc = admin(cfg);

  const { data: ok, error: checkErr } = await svc.rpc("_world_check_registration", {
    p_passphrase: opts.passphrase ?? null,
  });
  if (checkErr) throw new Error(`registration check: ${checkErr.message}`);
  if (!ok) {
    const { mode } = await getRegistrationMode(cfg);
    throw new RegistrationRefused(
      mode === "closed" ? "registration is closed on this instance" : "incorrect registration passphrase",
    );
  }

  const generated = opts.secret ? undefined : generateSecret();
  const secret = opts.secret ?? generated!;
  const authUser = await ensureAuthUser(svc, opts.email, secret);

  let uuid: string;
  try {
    const { data: newUuid, error: regErr } = await svc.rpc("world_register_player", {
      p_name: opts.name,
      p_auth: authUser.id,
    });
    if (regErr || !newUuid) throw new RegistrationRefused(regErr?.message ?? "registration failed");
    uuid = newUuid as unknown as string;
  } catch (err) {
    // roll back the just-created account if it was new to us and the player
    // could not be created (duplicate name, already-registered account, …)
    if (authUser.created) await svc.auth.admin.deleteUser(authUser.id).catch(() => {});
    throw err;
  }

  const { data: row } = await svc.from("objects").select("dbref").eq("id", uuid).single();
  return {
    dbref: (row?.dbref as number) ?? -1,
    uuid,
    authUserId: authUser.id,
    ...(generated ? { generatedSecret: generated } : {}),
  };
}

export interface RegisterPlayerOptions {
  name: string;
  email: string;
  /** the new player's initial secret; when omitted a random one is generated
   *  and returned (closed signup — the operator conveys it out of band). */
  secret?: string;
  power?: "player" | "builder" | "wizard" | "god";
  quota?: number | null;
  /** starting room uuid; defaults to Limbo #0. */
  locationUuid?: string;
}

export interface RegisterPlayerResult {
  dbref: number;
  uuid: string;
  authUserId: string;
  generatedSecret?: string;
}

/**
 * Closed-signup registration (the ruled v1 posture — decisions.md): the server
 * plane, acting as God #1, creates a player object AND its auth account, then
 * binds them. Player-initiated open registration is deferred (abuse controls
 * are ops-tail) — this is the ONLY way a new identity enters the world in v1,
 * and it runs through the god-gated `_world_create_player` RPC so the tier
 * check (GM-R15) is exercised, not bypassed.
 */
export async function registerPlayer(
  cfg: AdminConfig,
  opts: RegisterPlayerOptions,
): Promise<RegisterPlayerResult> {
  const svc = admin(cfg);

  const { data: god, error: godErr } = await svc
    .from("objects")
    .select("id, location_id")
    .eq("dbref", 1)
    .eq("type", "player")
    .single();
  if (godErr || !god) throw new Error(`god #1 not found (run first-boot first): ${godErr?.message}`);

  const location = opts.locationUuid ?? (god.location_id as string);
  const { data: newUuid, error: createErr } = await svc.rpc("_world_create_player", {
    p_actor: god.id as string,
    p_name: opts.name,
    p_power: opts.power ?? "player",
    p_location: location,
    p_quota: opts.quota === undefined ? 50 : opts.quota,
  });
  if (createErr || !newUuid) throw new Error(`create player ${opts.name}: ${createErr?.message}`);
  const uuid = newUuid as unknown as string;

  const generated = opts.secret ? undefined : generateSecret();
  const secret = opts.secret ?? generated!;
  const authUser = await ensureAuthUser(svc, opts.email, secret);

  const { error: bindErr } = await svc.rpc("world_bind_auth", {
    p_player: uuid,
    p_auth: authUser.id,
  });
  if (bindErr) throw new Error(`world_bind_auth (${opts.name}): ${bindErr.message}`);

  const { data: row } = await svc.from("objects").select("dbref").eq("id", uuid).single();
  return {
    dbref: (row?.dbref as number) ?? -1,
    uuid,
    authUserId: authUser.id,
    ...(generated ? { generatedSecret: generated } : {}),
  };
}
