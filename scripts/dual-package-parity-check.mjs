#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outDir = path.join(root, "artifacts", "dual-package-parity");
fs.mkdirSync(outDir, { recursive: true });

function run(cmd, args, cwd, capture = true) {
  return spawnSync(cmd, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
}

for (const key of ["canonical", "guard"]) {
  const prep = run("node", ["scripts/prepare-package-artifacts.mjs", "--package", key], root, false);
  if (prep.status !== 0) {
    process.exit(prep.status ?? 1);
  }
}

const canonicalDir = path.join(root, "packages", "canonical");
const guardDir = path.join(root, "packages", "guard");
const canonicalManifest = JSON.parse(fs.readFileSync(path.join(canonicalDir, "package.json"), "utf8"));
const guardManifest = JSON.parse(fs.readFileSync(path.join(guardDir, "package.json"), "utf8"));

function expectedLifecycleScripts(pkgKey) {
  return {
    prepack: `node ../../scripts/prepare-package-artifacts.mjs --package ${pkgKey}`,
    prepublishOnly: `node ../../scripts/release/prepublish-package.mjs --package ${pkgKey}`,
  };
}

function lifecycleScriptsOk(manifest, pkgKey) {
  const scripts = manifest?.scripts ?? {};
  const expected = expectedLifecycleScripts(pkgKey);
  return {
    ok: scripts.prepack === expected.prepack && scripts.prepublishOnly === expected.prepublishOnly,
    expected,
    actual: {
      prepack: typeof scripts.prepack === "string" ? scripts.prepack : null,
      prepublishOnly: typeof scripts.prepublishOnly === "string" ? scripts.prepublishOnly : null,
    },
  };
}

const parity = {
  ok: true,
  checkedAt: new Date().toISOString(),
  checks: {
    versionEqual: canonicalManifest.version === guardManifest.version,
    binEqual: JSON.stringify(canonicalManifest.bin) === JSON.stringify(guardManifest.bin),
    engineEqual: JSON.stringify(canonicalManifest.engines) === JSON.stringify(guardManifest.engines),
    dependenciesEqual: JSON.stringify(canonicalManifest.dependencies) === JSON.stringify(guardManifest.dependencies),
    filesEqual: JSON.stringify(canonicalManifest.files) === JSON.stringify(guardManifest.files),
    publishConfigEqual: JSON.stringify(canonicalManifest.publishConfig) === JSON.stringify(guardManifest.publishConfig),
    lifecycleScriptsOk: false,
    distCliEqual: false,
    contractEqual: false,
  },
};

const scriptsCanonical = lifecycleScriptsOk(canonicalManifest, "canonical");
const scriptsGuard = lifecycleScriptsOk(guardManifest, "guard");
parity.checks.lifecycleScriptsOk = scriptsCanonical.ok && scriptsGuard.ok;
parity.scripts = {
  canonical: scriptsCanonical,
  guard: scriptsGuard,
};

const canonicalDist = fs.readFileSync(path.join(canonicalDir, "dist", "cli.js"));
const guardDist = fs.readFileSync(path.join(guardDir, "dist", "cli.js"));
const canonicalSha = crypto.createHash("sha256").update(canonicalDist).digest("hex");
const guardSha = crypto.createHash("sha256").update(guardDist).digest("hex");
parity.checks.distCliEqual = canonicalSha === guardSha;

const canonicalContract = run("node", ["dist/cli.js", "contract"], canonicalDir);
const guardContract = run("node", ["dist/cli.js", "contract"], guardDir);
if (canonicalContract.status === 0 && guardContract.status === 0) {
  parity.checks.contractEqual = canonicalContract.stdout.trim() === guardContract.stdout.trim();
}

parity.ok = Object.values(parity.checks).every((flag) => flag === true);
parity.hashes = { canonicalCliSha256: canonicalSha, guardCliSha256: guardSha };

const reportPath = path.join(outDir, "report.json");
fs.writeFileSync(reportPath, `${JSON.stringify(parity, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(parity)}\n`);
process.exit(parity.ok ? 0 : 1);
