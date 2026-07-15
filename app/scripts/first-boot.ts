// First-boot god provisioning (GM-R18/R19) — the operator command.
//
//   npm run first-boot            # over the local stack (5454x)
//
// Reads the service-role key and the god identity from the environment (the
// provider store), bootstraps the world if empty, binds God #1 to a real auth
// account, and sets the out-of-the-box registration posture: `passphrase`-gated
// open registration. NO default credential exists — the god secret and the
// instance registration passphrase come from GENMURK_GOD_SECRET /
// GENMURK_REGISTRATION_PASSPHRASE (the provider store) or, if unset, are
// GENERATED here and printed ONCE for the operator to store; neither is written
// to disk. Safe to re-run: an already-provisioned world reports and exits 0.

import process from "node:process";
import { provisionFirstBoot } from "../src/server/auth.ts";

const url = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54541";
const anonKey = process.env["SUPABASE_ANON_KEY"] ?? "";
const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const email = process.env["GENMURK_GOD_EMAIL"] ?? "god@genmurk.invalid";
const secret = process.env["GENMURK_GOD_SECRET"]; // undefined ⇒ generate + emit once
const registrationPassphrase = process.env["GENMURK_REGISTRATION_PASSPHRASE"]; // undefined ⇒ generate + emit once

if (!serviceRoleKey || !anonKey) {
  console.error("set SUPABASE_SERVICE_ROLE_KEY and SUPABASE_ANON_KEY (from `supabase start`)");
  process.exit(1);
}

function emitOnce(label: string, value: string): void {
  const bar = "=".repeat(label.length + 40);
  console.log("");
  console.log(`  === ${label} (shown once — store it in the provider store now) ===`);
  console.log(`  ${value}`);
  console.log(`  ${bar}`);
}

const result = await provisionFirstBoot(
  { url, serviceRoleKey, anonKey },
  { email, ...(secret ? { secret } : {}), ...(registrationPassphrase ? { registrationPassphrase } : {}) },
);

if (!result.provisioned) {
  console.log(`God #${result.godDbref} is already provisioned (${result.godEmail}). Nothing to do.`);
} else {
  console.log(`Provisioned God #${result.godDbref} as ${result.godEmail}.`);
  if (result.generatedSecret) emitOnce("GOD SECRET", result.generatedSecret);
  else console.log("Used GENMURK_GOD_SECRET from the environment (provider store).");

  console.log("");
  console.log(`Registration defaults to "${result.registrationMode ?? "closed"}" mode.`);
  if (result.generatedRegistrationPassphrase) {
    emitOnce("REGISTRATION PASSPHRASE", result.generatedRegistrationPassphrase);
    console.log("Share this passphrase with people you want to let register.");
  } else if (result.registrationMode === "passphrase") {
    console.log("Used GENMURK_REGISTRATION_PASSPHRASE from the environment (provider store).");
  }
  console.log("");
  console.log('Change it anytime: npm run set-registration -- --mode <closed|open|passphrase>');
  console.log("Neither secret is saved anywhere. Losing one means re-setting it.");
}
