// First-boot god provisioning (GM-R18/R19) — the operator command.
//
//   npm run first-boot            # over the local stack (5454x)
//
// Reads the service-role key and the god identity from the environment (the
// provider store), bootstraps the world if empty, and binds God #1 to a real
// auth account. NO default credential exists: the secret comes from
// GENMURK_GOD_SECRET (the provider store) or, if unset, is GENERATED here and
// printed ONCE for the operator to store — it is never written to disk. Safe
// to re-run: an already-provisioned world reports and exits 0.

import process from "node:process";
import { provisionFirstBoot } from "../src/server/auth.ts";

const url = process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54541";
const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "";
const email = process.env["GENMURK_GOD_EMAIL"] ?? "god@genmurk.invalid";
const secret = process.env["GENMURK_GOD_SECRET"]; // undefined ⇒ generate + emit once

if (!serviceRoleKey) {
  console.error("set SUPABASE_SERVICE_ROLE_KEY (from `supabase start`)");
  process.exit(1);
}

const result = await provisionFirstBoot({ url, serviceRoleKey }, { email, ...(secret ? { secret } : {}) });

if (!result.provisioned) {
  console.log(`God #${result.godDbref} is already provisioned (${result.godEmail}). Nothing to do.`);
} else {
  console.log(`Provisioned God #${result.godDbref} as ${result.godEmail}.`);
  if (result.generatedSecret) {
    console.log("");
    console.log("  === GOD SECRET (shown once — store it in the provider store now) ===");
    console.log(`  ${result.generatedSecret}`);
    console.log("  ===================================================================");
    console.log("");
    console.log("This secret is not saved anywhere. Losing it means re-provisioning.");
  } else {
    console.log("Used GENMURK_GOD_SECRET from the environment (provider store).");
  }
}
