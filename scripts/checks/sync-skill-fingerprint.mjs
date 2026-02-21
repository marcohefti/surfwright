#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SNAPSHOT_PATH = "test/fixtures/contract/contract.snapshot.json";
const TARGETS = ["skills/surfwright/skill.json", "skills/surfwright.lock.json"];

function readJson(relPath) {
  const absPath = path.resolve(ROOT, relPath);
  const raw = fs.readFileSync(absPath, "utf8");
  return JSON.parse(raw);
}

function writeJson(relPath, value) {
  const absPath = path.resolve(ROOT, relPath);
  fs.writeFileSync(absPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function main() {
  const snapshot = readJson(SNAPSHOT_PATH);
  const fingerprint = requireNonEmptyString(snapshot?.contractFingerprint, `${SNAPSHOT_PATH}.contractFingerprint`);

  let updated = 0;
  for (const relPath of TARGETS) {
    const parsed = readJson(relPath);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(`${relPath} must be a JSON object`);
    }
    const next = parsed;
    if (typeof next.requires !== "object" || next.requires === null) {
      throw new Error(`${relPath}.requires must be an object`);
    }
    if (next.requires.contractFingerprint === fingerprint) {
      continue;
    }
    next.requires.contractFingerprint = fingerprint;
    writeJson(relPath, next);
    process.stdout.write(`sync-skill-fingerprint: updated ${relPath}\n`);
    updated += 1;
  }

  if (updated === 0) {
    process.stdout.write("sync-skill-fingerprint: no changes\n");
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`sync-skill-fingerprint: ERROR ${message}\n`);
  process.exit(2);
}
