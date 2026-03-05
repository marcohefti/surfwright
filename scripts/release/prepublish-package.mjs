#!/usr/bin/env node
import fs from "node:fs";
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

function resolveCorepackPnpmCli(nodeExecPath) {
  const nodeBinDir = path.dirname(nodeExecPath);
  const cliPath = path.resolve(nodeBinDir, "..", "lib", "node_modules", "corepack", "dist", "pnpm.js");
  if (!fs.existsSync(cliPath)) {
    throw new Error(`pnpm cli not found at ${cliPath}`);
  }
  return cliPath;
}

function resolveNpmCli(nodeExecPath) {
  const nodeBinDir = path.dirname(nodeExecPath);
  const cliPath = path.resolve(nodeBinDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  if (!fs.existsSync(cliPath)) {
    throw new Error(`npm cli not found at ${cliPath}`);
  }
  return cliPath;
}

const pnpmCli = resolveCorepackPnpmCli(process.execPath);
const npmCli = resolveNpmCli(process.execPath);

const verify = spawnSync(process.execPath, [pnpmCli, "-s", "verify"], {
  cwd: root,
  stdio: "inherit",
});
if (verify.status !== 0) {
  process.exit(verify.status ?? 1);
}

const packDryRun = spawnSync(process.execPath, [npmCli, "pack", "--dry-run", "--json"], {
  cwd: pkgDir,
  stdio: "inherit",
});
if (packDryRun.status !== 0) {
  process.exit(packDryRun.status ?? 1);
}

process.stdout.write(`prepublish gate passed for ${pkgKey}\n`);
