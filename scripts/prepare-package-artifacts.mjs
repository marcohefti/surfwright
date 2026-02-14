#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argIndex = process.argv.indexOf("--package");
if (argIndex === -1 || !process.argv[argIndex + 1]) {
  throw new Error("Usage: node scripts/prepare-package-artifacts.mjs --package <canonical|guard>");
}

const pkgKey = process.argv[argIndex + 1];
const allowed = new Set(["canonical", "guard"]);
if (!allowed.has(pkgKey)) {
  throw new Error(`Unknown package key: ${pkgKey}`);
}

const pkgDir = path.join(root, "packages", pkgKey);
if (!fs.existsSync(pkgDir)) {
  throw new Error(`Package directory does not exist: ${pkgDir}`);
}

const build = spawnSync("pnpm", ["-s", "build"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const rootDist = path.join(root, "dist");
const pkgDist = path.join(pkgDir, "dist");
const readmeSrc = path.join(root, "README.md");
const licenseSrc = path.join(root, "LICENSE");

if (!fs.existsSync(rootDist)) {
  throw new Error("Missing root dist/ directory; build did not produce output");
}
if (!fs.existsSync(licenseSrc)) {
  throw new Error("Missing LICENSE file");
}

fs.rmSync(pkgDist, { recursive: true, force: true });
fs.mkdirSync(pkgDist, { recursive: true });
fs.cpSync(rootDist, pkgDist, { recursive: true });
fs.copyFileSync(readmeSrc, path.join(pkgDir, "README.md"));
fs.copyFileSync(licenseSrc, path.join(pkgDir, "LICENSE"));

process.stdout.write(`prepared package artifacts for ${pkgKey}\n`);
