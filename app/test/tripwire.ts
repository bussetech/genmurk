// The source-level tripwire the design record §4 promises: the evaluator
// never consults globalThis, never calls eval/Function/dynamic import, and
// no host I/O name appears anywhere in src/engine/. CI runs this on every
// PR (npm test); a hit is a hard failure. Comments are stripped before
// scanning so prose ABOUT the forbidden tokens stays legal.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ENGINE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../src/engine");

const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: "eval(", re: /\beval\s*\(/ },
  { name: "Function(", re: /\bFunction\s*\(/ },
  { name: "new Function", re: /\bnew\s+Function\b/ },
  { name: "dynamic import(", re: /\bimport\s*\(/ },
  { name: "globalThis", re: /\bglobalThis\b/ },
  { name: "process.", re: /\bprocess\s*\./ },
  { name: "require(", re: /\brequire\s*\(/ },
  { name: "fetch(", re: /\bfetch\s*\(/ },
  { name: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
  { name: "WebSocket", re: /\bWebSocket\b/ },
  { name: "setTimeout(", re: /\bsetTimeout\s*\(/ },
  { name: "setInterval(", re: /\bsetInterval\s*\(/ },
  { name: "child_process", re: /\bchild_process\b/ },
  { name: "node:fs import", re: /from\s+["']node:/ },
  { name: "Math.random", re: /\bMath\s*\.\s*random\b/ },
  { name: "Date.now", re: /\bDate\s*\.\s*now\b/ },
];

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

let hits = 0;
for (const file of readdirSync(ENGINE_DIR).filter((f) => f.endsWith(".ts")).sort()) {
  const code = stripComments(readFileSync(join(ENGINE_DIR, file), "utf8"));
  for (const { name, re } of FORBIDDEN) {
    if (re.test(code)) {
      console.error(`TRIPWIRE: forbidden token ${JSON.stringify(name)} in src/engine/${file}`);
      hits++;
    }
  }
}

if (hits > 0) {
  console.error(`\ntripwire: ${hits} hit(s) — the deny-by-construction invariant is broken.`);
  process.exit(1);
}
console.log("tripwire: src/engine/ is clean — no host-capability tokens.");
