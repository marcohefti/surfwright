#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, env: process.env, encoding: "utf8" });
}

const report = {
  ok: true,
  checkedAt: new Date().toISOString(),
  checks: [],
};

for (const key of ["canonical", "guard"]) {
  const prep = run("node", ["scripts/prepare-package-artifacts.mjs", "--package", key], root);
  if (prep.status !== 0) {
    report.ok = false;
    report.checks.push({ check: `prepare-${key}`, ok: false, stderr: prep.stderr.trim() });
    continue;
  }

  const pkgDir = path.join(root, "packages", key);
  const pack = run("npm", ["pack"], pkgDir);
  if (pack.status !== 0) {
    report.ok = false;
    report.checks.push({ check: `pack-${key}`, ok: false, stderr: pack.stderr.trim() });
    continue;
  }

  const tgz = pack.stdout.trim().split("\n").filter(Boolean).pop();
  if (!tgz) {
    report.ok = false;
    report.checks.push({ check: `pack-${key}`, ok: false, stderr: "missing tarball output" });
    continue;
  }

  const tgzPath = path.join(pkgDir, tgz);
  const exec = run("npx", ["-y", "--package", tgzPath, "surfwright", "--json", "contract"], root);
  report.checks.push({
    check: `npx-${key}`,
    ok: exec.status === 0,
    status: exec.status,
  });

  try {
    fs.rmSync(tgzPath, { force: true });
  } catch {
    // ignore
  }
}

report.ok = report.ok && report.checks.every((item) => item.ok === true);
const outPath = path.join(root, "artifacts", "dual-package-smoke.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(report.ok ? 0 : 1);
