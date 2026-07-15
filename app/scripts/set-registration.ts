// Set the instance registration policy (GM-R18 open-signup) — an operator/god
// act. Signs in as god (from the provider store) and sets the mode; in
// `passphrase` mode the passphrase is stored bcrypt-hashed by the RPC and never
// travels to disk here.
//
//   GENMURK_GOD_SECRET=… npm run set-registration -- --mode open
//   GENMURK_GOD_SECRET=… GENMURK_REGISTRATION_PASSPHRASE=… \
//     npm run set-registration -- --mode passphrase
//   GENMURK_GOD_SECRET=… npm run set-registration -- --mode closed

import process from "node:process";
import { createClient } from "@supabase/supabase-js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : undefined;
}

const url = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54541";
const anonKey = process.env["SUPABASE_ANON_KEY"] ?? "";
const godEmail = process.env["GENMURK_GOD_EMAIL"] ?? "god@genmurk.invalid";
const godSecret = process.env["GENMURK_GOD_SECRET"] ?? "";
const mode = arg("mode");
const passphrase = arg("passphrase") ?? process.env["GENMURK_REGISTRATION_PASSPHRASE"];

if (!anonKey || !godSecret) {
  console.error("set SUPABASE_ANON_KEY and GENMURK_GOD_SECRET (the provisioned god secret)");
  process.exit(1);
}
if (!mode || !["closed", "open", "passphrase"].includes(mode)) {
  console.error("usage: npm run set-registration -- --mode <closed|open|passphrase> [--passphrase <…>]");
  process.exit(1);
}
if (mode === "passphrase" && !passphrase) {
  console.error("passphrase mode needs --passphrase or GENMURK_REGISTRATION_PASSPHRASE");
  process.exit(1);
}

const supabase = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await supabase.auth.signInWithPassword({ email: godEmail, password: godSecret });
if (error || !data.session) {
  console.error(`god sign-in failed: ${error?.message ?? "no session"} (provision god first?)`);
  process.exit(1);
}
const god = createClient(url, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
});
const { error: rpcErr } = await god.rpc("world_set_registration", {
  p_mode: mode,
  p_passphrase: passphrase ?? null,
});
if (rpcErr) {
  console.error(`set registration failed: ${rpcErr.message}`);
  process.exit(1);
}
console.log(`registration mode set to "${mode}"${mode === "passphrase" ? " (passphrase required)" : ""}.`);
