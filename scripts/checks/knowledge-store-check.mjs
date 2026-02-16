#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function readJson(relPath) {
  const absPath = path.join(root, relPath);
  const raw = fs.readFileSync(absPath, "utf8");
  return JSON.parse(raw);
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

const failures = [];

try {
  const snapshot = readJson("test/fixtures/contract/contract.snapshot.json");
  const skill = readJson("skills/surfwright/skill.json");
  const lock = readJson("skills/surfwright.lock.json");

  const snapshotFingerprint = requireString(snapshot?.contractFingerprint, "contract.snapshot.json.contractFingerprint");
  const skillFingerprint = requireString(skill?.requires?.contractFingerprint, "skills/surfwright/skill.json.requires.contractFingerprint");
  const lockFingerprint = requireString(lock?.requires?.contractFingerprint, "skills/surfwright.lock.json.requires.contractFingerprint");

  const unique = new Set([snapshotFingerprint, skillFingerprint, lockFingerprint]);
  if (unique.size !== 1) {
    failures.push(
      [
        "contract fingerprint mismatch:",
        `test/fixtures/contract/contract.snapshot.json => ${snapshotFingerprint}`,
        `skills/surfwright/skill.json => ${skillFingerprint}`,
        `skills/surfwright.lock.json => ${lockFingerprint}`,
      ].join("\n"),
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  failures.push(`failed to read/parse knowledge store files: ${message}`);
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`knowledge-store-check: FAIL ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write("knowledge-store-check: PASS\n");

