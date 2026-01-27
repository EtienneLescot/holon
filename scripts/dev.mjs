#!/usr/bin/env node

import { spawn } from "node:child_process";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function shQuote(value) {
  const s = String(value);
  // Wrap in single quotes; escape embedded single quotes.
  return `'${s.replaceAll("'", `'"'"'`)}'`;
}

function shellPreamble() {
  // Ensure common user env is loaded (nvm/pyenv often live in ~/.bashrc).
  return "set -e; " +
    "if [ -f ~/.profile ]; then . ~/.profile; fi; " +
    "if [ -f ~/.bashrc ]; then . ~/.bashrc; fi; ";
}

function parseArgs(argv) {
  const args = { workflow: "core/examples/demo.holon.py", host: "127.0.0.1", apiPort: "8787", uiPort: "5173" };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--workflow" && argv[i + 1]) {
      args.workflow = argv[++i];
      continue;
    }
    if (a === "--host" && argv[i + 1]) {
      args.host = argv[++i];
      continue;
    }
    if ((a === "--api-port" || a === "--apiPort") && argv[i + 1]) {
      args.apiPort = argv[++i];
      continue;
    }
    if ((a === "--ui-port" || a === "--uiPort") && argv[i + 1]) {
      args.uiPort = argv[++i];
      continue;
    }
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const workflowAbs = path.resolve(repoRoot, args.workflow);

const children = [];

function runBash(label, cmd, cwd) {
  const child = spawn("bash", ["-lc", `${shellPreamble()} ${cmd}`], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.exitCode = 1;
      return;
    }
    if (typeof code === "number" && code !== 0) {
      process.exitCode = code;
    }
  });
  children.push({ label, child });
  return child;
}

function shutdown() {
  for (const { child } of children) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

console.log(`Workflow: ${workflowAbs}`);
console.log(`API: http://${args.host}:${args.apiPort}`);
console.log(`UI:  http://${args.host}:${args.uiPort}`);

// 1) Python API devserver (file-backed)
const coreCwd = path.join(repoRoot, "core");
runBash(
  "api",
  [
    "if command -v poetry >/dev/null 2>&1; then",
    "  poetry run python -m holon.devserver",
    `    --host ${shQuote(args.host)}`,
    `    --port ${shQuote(args.apiPort)}`,
    `    --file ${shQuote(workflowAbs)};`,
    "else",
    "  python -m holon.devserver",
    `    --host ${shQuote(args.host)}`,
    `    --port ${shQuote(args.apiPort)}`,
    `    --file ${shQuote(workflowAbs)};`,
    "fi",
  ].join(" "),
  coreCwd,
);

// 2) UI dev server (Vite)
const uiCwd = path.join(repoRoot, "ui");
runBash(
  "ui",
  [
    "if command -v npm >/dev/null 2>&1; then",
    "  npm run dev --",
    `    --host ${shQuote(args.host)}`,
    `    --port ${shQuote(args.uiPort)};`,
    "elif command -v pnpm >/dev/null 2>&1; then",
    "  pnpm dev --",
    `    --host ${shQuote(args.host)}`,
    `    --port ${shQuote(args.uiPort)};`,
    "elif command -v yarn >/dev/null 2>&1; then",
    "  yarn dev --",
    `    --host ${shQuote(args.host)}`,
    `    --port ${shQuote(args.uiPort)};`,
    "else",
    "  echo 'Missing npm/pnpm/yarn on PATH' >&2;",
    "  exit 1;",
    "fi",
  ].join(" "),
  uiCwd,
);
