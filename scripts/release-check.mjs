#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outDir = path.join(root, "artifacts", "release-check");
fs.mkdirSync(outDir, { recursive: true });

const packageDirs = [
  { key: "canonical", dir: path.join(root, "packages", "canonical") },
  { key: "guard", dir: path.join(root, "packages", "guard") },
];

function run(cmd, args, cwd, capture = true) {
  const result = spawnSync(cmd, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  return result;
}

function parsePackJson(stdout) {
  const text = typeof stdout === "string" ? stdout : "";
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    return [];
  }
  const jsonSlice = text.slice(start, end + 1);
  return JSON.parse(jsonSlice);
}

for (const pkg of packageDirs) {
  const prep = run("node", ["scripts/prepare-package-artifacts.mjs", "--package", pkg.key], root, false);
  if (prep.status !== 0) {
    process.exit(prep.status ?? 1);
  }
}

const report = {
  ok: true,
  checkedAt: new Date().toISOString(),
  packages: [],
};

for (const pkg of packageDirs) {
  const manifestPath = path.join(pkg.dir, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  if (manifest.license !== "MIT") {
    report.ok = false;
  }
  if (manifest.private !== false) {
    report.ok = false;
  }

  const pack = run("npm", ["pack", "--dry-run", "--json"], pkg.dir);
  if (pack.status !== 0) {
    report.ok = false;
  }

  let packedFiles = null;
  try {
    const packJson = parsePackJson(pack.stdout);
    packedFiles = Array.isArray(packJson) ? packJson[0]?.files?.length ?? null : null;
  } catch {
    packedFiles = null;
  }

  const distPath = path.join(pkg.dir, "dist", "cli.js");
  const distHash = fs.existsSync(distPath)
    ? crypto.createHash("sha256").update(fs.readFileSync(distPath)).digest("hex")
    : null;

  report.packages.push({
    key: pkg.key,
    name: manifest.name,
    version: manifest.version,
    license: manifest.license,
    private: manifest.private,
    nodeEngine: manifest.engines?.node ?? null,
    distCliSha256: distHash,
    packOk: pack.status === 0,
    packedFiles,
  });
}

const reportPath = path.join(outDir, "report.json");
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(report.ok ? 0 : 1);
