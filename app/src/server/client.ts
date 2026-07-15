// A minimal terminal client for the local playable check (GENMURK-EPIC1-05).
// Localhost only, like everything at this stage. Rendering below is client
// cosmetics — the pre-capture caveat in verbs.ts covers these surfaces too.
//
//   node src/server/client.ts --token stub:Alice [--url ws://127.0.0.1:8787]

import process from "node:process";
import readline from "node:readline";
import { renderMarkup } from "./style.ts";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// GM-R13 styled output: markup tokens arrive on the wire; ANSI is produced
// HERE, from the renderer's fixed SGR table, and only on a real terminal.
const ansi = process.stdout.isTTY === true && process.env["NO_COLOR"] === undefined;
const styled = (text: string): string => renderMarkup(text, { ansi });

const token = arg("token");
const url = arg("url", "ws://127.0.0.1:8787")!;
if (!token) {
  console.error("usage: node src/server/client.ts --token stub:<PlayerName> [--url ws://…]");
  process.exit(1);
}

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
