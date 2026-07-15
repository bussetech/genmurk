// A minimal terminal client for the local playable check (GENMURK-EPIC1-05,
// auth wired in 08). Localhost only, like everything at this stage. Rendering
// below is client cosmetics — the pre-capture caveat in verbs.ts covers these
// surfaces too.
//
// The client authenticates against Supabase Auth (GM-R18: the sanctioned KDF)
// and presents the resulting access-token JWT at HELLO — the server verifies
// it. Credentials are supplied by the player, never shipped:
//
//   node src/server/client.ts --email alice@genmurk.invalid --password '…' \
//     [--url ws://127.0.0.1:8787]
//     [--supabase-url http://127.0.0.1:54541] [--anon-key <key>]
//
// `--password` may be omitted to read GENMURK_PASSWORD from the environment
// (so the secret is not in your shell history). `--token <jwt>` skips sign-in
// for an already-held token.

import process from "node:process";
import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";
import { renderMarkup } from "./style.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// GM-R13 styled output: markup tokens arrive on the wire; ANSI is produced
// HERE, from the renderer's fixed SGR table, and only on a real terminal.
const ansi = process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;
const styled = (text: string): string => renderMarkup(text, { ansi });

const url = arg("url", "ws://127.0.0.1:8787")!;

/** Obtain the HELLO token: an explicit `--token`, or sign in to Supabase Auth
 *  with the player's own credentials and use the access-token JWT. */
async function resolveToken(): Promise<string> {
  const explicit = arg("token");
  if (explicit) return explicit;

  const email = arg("email");
  const password = arg("password") ?? process.env["GENMURK_PASSWORD"];
  if (!email || !password) {
    console.error(
      "usage: node src/server/client.ts --email <you@…> --password <…> [--url ws://…]\n" +
        "  (or --token <jwt>; password may come from GENMURK_PASSWORD)",
    );
    process.exit(1);
  }
  const supabaseUrl = arg("supabase-url", process.env["SUPABASE_URL"] ?? "http://127.0.0.1:54541")!;
  const anonKey = arg("anon-key", process.env["SUPABASE_ANON_KEY"] ?? "")!;
  if (!anonKey) {
    console.error("set --anon-key or SUPABASE_ANON_KEY (from `supabase start`)");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    console.error(`sign-in failed: ${error?.message ?? "no session"}`);
    process.exit(1);
  }
  return data.session.access_token;
}

/** Self-service registration (GM-R18 open-signup), when `--register` is passed:
 *  send a register frame on a throwaway connection, then fall through to the
 *  normal sign-in + hello with the same credentials. */
async function registerIfRequested(): Promise<void> {
  if (process.argv.indexOf("--register") === -1) return;
  const name = arg("name");
  const email = arg("email");
  const password = arg("password") ?? process.env["GENMURK_PASSWORD"];
  const passphrase = arg("passphrase");
  if (!name || !email || !password) {
    console.error("register needs: --register --name <name> --email <you@…> --password <…> [--passphrase <…>]");
    process.exit(1);
  }
  await new Promise<void>((resolve) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () =>
      ws.send(JSON.stringify({ type: "register", name, email, password, ...(passphrase ? { passphrase } : {}) })),
    );
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.type === "registered") {
        console.log(`— registered as ${msg.player.name} —`);
        ws.close();
        resolve();
      } else if (msg.type === "error") {
        console.error(`registration failed: ${msg.code}: ${msg.text}`);
        process.exit(1);
      }
    });
    ws.addEventListener("error", () => {
      console.error(`! cannot reach ${url} — is the dev server running?`);
      process.exit(1);
    });
  });
}

await registerIfRequested();
const token = await resolveToken();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let rlClosed = false;
const print = (line: string): void => {
  readline.cursorTo(process.stdout, 0);
  readline.clearLine(process.stdout, 0);
  console.log(line);
  if (!rlClosed) rl.prompt(true);
};

const ws = new WebSocket(url);

ws.addEventListener("open", () => {
  ws.send(JSON.stringify({ type: "hello", token }));
});

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(String(ev.data));
  switch (msg.type) {
    case "welcome":
      print(`— connected as ${msg.player.name} —`);
      print(`${msg.room.name} — here: ${msg.occupants.join(", ")}`);
      break;
    case "event":
      switch (msg.kind) {
        case "arrive":
          print(`>> ${msg.actorName} arrives.`);
          break;
        case "depart":
          print(`>> ${msg.actorName} leaves.`);
          break;
        case "say":
          print(`${msg.actorName}: ${styled(msg.text)}`);
          break;
        case "emote":
          print(`* ${msg.actorName} ${styled(msg.text)}`);
          break;
        case "announce":
          print(`[announce] ${msg.actorName}: ${styled(msg.text)}`);
          break;
        case "emit":
          print(`(${msg.actorName}) ${styled(msg.text)}`);
          break;
      }
      break;
    case "message":
      print(`[${msg.kind} from ${msg.fromName}] ${styled(msg.text)}`);
      break;
    case "info":
      print(styled(msg.text));
      break;
    case "error":
      print(`! ${msg.code}: ${msg.text}`);
      break;
  }
});

ws.addEventListener("close", () => {
  print("— disconnected —");
  process.exit(0);
});

ws.addEventListener("error", () => {
  print(`! cannot reach ${url} — is the dev server running?`);
  process.exit(1);
});

rl.setPrompt("> ");
rl.prompt();
rl.on("line", (line) => {
  if (line.trim() !== "") ws.send(JSON.stringify({ type: "command", line }));
  rl.prompt();
});
rl.on("close", () => {
  rlClosed = true;
  ws.close();
});
