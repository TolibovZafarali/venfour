import { spawnSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prepared = spawnSync(path.join(root, ".venv/bin/python"), ["scripts/prepare_local_showcase.py"], { cwd: root, stdio: "inherit" });
if (prepared.status !== 0) process.exit(prepared.status ?? 1);
console.log("Open http://127.0.0.1:4187/_local/showcase — use Reset walkthrough to replay. Ctrl+C stops this server.");
const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "preview/showcase/vite.config.ts"], { cwd: path.join(root, "frontend"), stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => process.exit(code ?? 0));
