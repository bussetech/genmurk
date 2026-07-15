// Shared real-stack auth plumbing for the live acceptance gates (isolation,
// building, escalation, first-boot). GENMURK-EPIC1-08: the tests authenticate
// the SAME way a real client does — a per-run RANDOM secret (never a repo
// literal, so the credential leak-check stays green), a real Supabase Auth
// account per player, a real sign-in, and the resulting access-token JWT is
// what the gateway verifies. No shared/default password survives here.

import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface StackConfig {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}

export interface CastMember {
  name: string;
  email: string;
}

export interface Provisioned {
  /** a client scoped by the player's JWT (RLS applies to its reads/RPCs) */
  client: SupabaseClient;
  /** the raw access-token JWT — what a HELLO frame carries, what the gateway verifies */
  token: string;
  authUserId: string;
}

/** A fresh cryptographically random secret for a test run's accounts. */
export function randomSecret(): string {
  return randomBytes(24).toString("base64url");
}

function service(cfg: StackConfig): SupabaseClient {
  return createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Sign in and return a JWT-scoped client + the raw access token. */
export async function signIn(
  cfg: StackConfig,
  email: string,
  secret: string,
): Promise<{ client: SupabaseClient; token: string }> {
  const anon = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password: secret });
  if (error || !data.session) throw new Error(`sign-in failed for ${email}: ${error?.message}`);
  const token = data.session.access_token;
  const client = createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return { client, token };
}

/**
 * Create (or recreate) an auth account per cast member with a per-run random
 * secret, link it to the seeded player object by name, and sign in — returning
 * a JWT-scoped client and the raw JWT per player. Deleting a pre-existing
 * account first SET-NULLs its old link (schema FK), so this is idempotent
 * across re-runs against a non-reset stack.
 */
export async function provisionCast(
  cfg: StackConfig,
  cast: CastMember[],
  secret: string = randomSecret(),
): Promise<Record<string, Provisioned>> {
  const admin = service(cfg);
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 });
  const out: Record<string, Provisioned> = {};
  for (const p of cast) {
    const found = existing?.users.find((u) => u.email === p.email);
    if (found) await admin.auth.admin.deleteUser(found.id);
    const { data, error } = await admin.auth.admin.createUser({
      email: p.email,
      password: secret,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser ${p.email}: ${error?.message}`);
    const { error: linkErr } = await admin
      .from("objects")
      .update({ auth_user_id: data.user.id })
      .eq("name", p.name)
      .eq("type", "player");
    if (linkErr) throw new Error(`link ${p.name}: ${linkErr.message}`);
    const { client, token } = await signIn(cfg, p.email, secret);
    out[p.name] = { client, token, authUserId: data.user.id };
  }
  return out;
}
