#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const out = {
    mode: null,
    version: null,
    out: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--mode") {
      out.mode = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--version") {
      out.version = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--out") {
      out.out = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (out.mode !== "local" && out.mode !== "registry") {
    throw new Error("--mode must be one of: local, registry");
  }
  if (out.mode === "registry" && (!out.version || out.version.length === 0)) {
    throw new Error("--version is required for --mode registry");
  }
  if (!out.out) {
    throw new Error("--out is required");
  }

  return out;
}

function run(cmd, args, cwd, capture = true) {
  return spawnSync(cmd, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
}

function readVersionFromPackage(root, key) {
  const pkgPath = path.join(root, "packages", key, "package.json");
  return JSON.parse(fs.readFileSync(pkgPath, "utf8")).version;
}

function runContractFromInstalledPackage(opts) {
  const { spec, outPath } = opts;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-smoke-"));
  const init = run("npm", ["init", "-y"], workDir);
  if (init.status !== 0) {
    return { ok: false, reason: "npm-init-failed", status: init.status ?? 1, stderr: init.stderr.trim() };
  }
  const install = run("npm", ["install", "--silent", "--no-audit", "--no-fund", spec], workDir);
  if (install.status !== 0) {
    return { ok: false, reason: "npm-install-failed", status: install.status ?? 1, stderr: install.stderr.trim() };
  }
  const cli = run("./node_modules/.bin/surfwright", ["--json", "contract"], workDir);
  if (cli.status !== 0) {
    return { ok: false, reason: "contract-run-failed", status: cli.status ?? 1, stderr: cli.stderr.trim() };
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, cli.stdout, "utf8");
  return { ok: true, reason: "ok", status: 0 };
}

function smokeLocal(root, outDir) {
  const checks = [];
  const versions = {
    canonical: readVersionFromPackage(root, "canonical"),
    guard: readVersionFromPackage(root, "guard"),
  };

  for (const key of ["canonical", "guard"]) {
    const prep = run("node", ["scripts/prepare-package-artifacts.mjs", "--package", key], root, false);
    if (prep.status !== 0) {
      checks.push({ check: `prepare-${key}`, ok: false, status: prep.status ?? 1 });
      continue;
    }

    const pkgDir = path.join(root, "packages", key);
    const pack = run("npm", ["pack", "--silent"], pkgDir);
    if (pack.status !== 0) {
      checks.push({ check: `pack-${key}`, ok: false, status: pack.status ?? 1, stderr: pack.stderr.trim() });
      continue;
    }

    const tarballName = pack.stdout.trim().split("\n").filter(Boolean).pop();
    if (!tarballName) {
      checks.push({ check: `pack-${key}`, ok: false, status: 1, stderr: "missing tarball output" });
      continue;
    }
    const tarballPath = path.join(pkgDir, tarballName);
    const contractOut = path.join(outDir, `${key}-contract.json`);
    const smoke = runContractFromInstalledPackage({
      spec: tarballPath,
      outPath: contractOut,
    });
    checks.push({ check: `contract-${key}`, ...smoke });
    fs.rmSync(tarballPath, { force: true });
  }

  return {
    ok: checks.every((item) => item.ok),
    mode: "local",
    version: versions.canonical,
    checks,
  };
}

function smokeRegistry(outDir, version) {
  const checks = [];
  const specs = [
    { name: "@marcohefti/surfwright", key: "canonical" },
    { name: "surfwright", key: "guard" },
  ];

  for (const entry of specs) {
    const outPath = path.join(outDir, `${entry.key}-contract.json`);
    const smoke = runContractFromInstalledPackage({
      spec: `${entry.name}@${version}`,
      outPath,
    });
    checks.push({ check: `contract-${entry.key}`, package: entry.name, ...smoke });
  }

  return {
    ok: checks.every((item) => item.ok),
    mode: "registry",
    version,
    checks,
  };
}

const args = parseArgs(process.argv.slice(2));
const root = process.cwd();
const outPath = path.resolve(args.out);
const outDir = path.dirname(outPath);
fs.mkdirSync(outDir, { recursive: true });

const report = args.mode === "local" ? smokeLocal(root, outDir) : smokeRegistry(outDir, args.version);
report.checkedAt = new Date().toISOString();

fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report)}\n`);
process.exit(report.ok ? 0 : 1);
