#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argIndex = process.argv.indexOf("--package");
if (argIndex === -1 || !process.argv[argIndex + 1]) {
  throw new Error("Usage: node scripts/release/prepublish-package.mjs --package <canonical|guard>");
}

const pkgKey = process.argv[argIndex + 1];
const pkgDir = path.join(root, "packages", pkgKey);

const verify = spawnSync("pnpm", ["-s", "verify"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (verify.status !== 0) {
  process.exit(verify.status ?? 1);
}

const packDryRun = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  cwd: pkgDir,
  stdio: "inherit",
  env: process.env,
});
if (packDryRun.status !== 0) {
  process.exit(packDryRun.status ?? 1);
}

process.stdout.write(`prepublish gate passed for ${pkgKey}\n`);
