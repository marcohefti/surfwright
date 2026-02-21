#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const DEFAULT_SNAPSHOT_PATH = "test/fixtures/contract/contract.snapshot.json";

function parseArgs(argv) {
  const opts = {
    mode: "check",
    snapshotPath: DEFAULT_SNAPSHOT_PATH,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];

    if (token === "--update") {
      opts.mode = "update";
      continue;
    }
    if (token === "--check") {
      opts.mode = "check";
      continue;
    }
    if (token === "--snapshot") {
      const next = argv[i + 1];
      if (!next) {
        throw new Error("--snapshot requires a path");
      }
      opts.snapshotPath = next;
      i += 1;
      continue;
    }
    if (token === "-h" || token === "--help") {
      process.stdout.write(
        [
          "Usage: node scripts/checks/contract-snapshot.mjs [--check|--update] [--snapshot <path>]",
          "",
          "Checks or updates the contract snapshot generated from dist/cli.js contract.",
        ].join("\n") + "\n",
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return opts;
}

function readContractFromCli() {
  const result = spawnSync(process.execPath, ["dist/cli.js", "contract"], {
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`Failed to read contract from CLI: ${result.stdout || result.stderr}`);
  }

  const text = result.stdout.trim();
  if (!text) {
    throw new Error("Contract command returned empty output");
  }

  return JSON.parse(text);
}

function normalizeContract(contract) {
  const commands = Array.isArray(contract.commands)
    ? [...contract.commands]
        .map((entry) => ({
          id: typeof entry?.id === "string" ? entry.id : "",
          usage: typeof entry?.usage === "string" ? entry.usage : "",
          summary: typeof entry?.summary === "string" ? entry.summary : "",
        }))
        .sort((a, b) => a.id.localeCompare(b.id))
    : [];

  const errors = Array.isArray(contract.errors)
    ? [...contract.errors]
        .map((entry) => ({
          code: typeof entry?.code === "string" ? entry.code : "",
          retryable: entry?.retryable === true,
        }))
        .sort((a, b) => a.code.localeCompare(b.code))
    : [];

  return {
    name: typeof contract.name === "string" ? contract.name : "surfwright",
    contractSchemaVersion:
      typeof contract.contractSchemaVersion === "number" && Number.isFinite(contract.contractSchemaVersion)
        ? contract.contractSchemaVersion
        : 1,
    contractFingerprint:
      typeof contract.contractFingerprint === "string" && contract.contractFingerprint.length > 0
        ? contract.contractFingerprint
        : "",
    guarantees: Array.isArray(contract.guarantees) ? contract.guarantees : [],
    commands,
    errors,
  };
}

function writeSnapshot(snapshotPath, payload) {
  const absolutePath = path.resolve(snapshotPath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readSnapshot(snapshotPath) {
  const absolutePath = path.resolve(snapshotPath);
  const raw = fs.readFileSync(absolutePath, "utf8");
  return JSON.parse(raw);
}

function stableJson(value) {
  return JSON.stringify(value);
}

function summarizeDiff(expected, actual) {
  const expectedCommands = Array.isArray(expected.commands) ? expected.commands.length : 0;
  const actualCommands = Array.isArray(actual.commands) ? actual.commands.length : 0;
  const expectedErrors = Array.isArray(expected.errors) ? expected.errors.length : 0;
  const actualErrors = Array.isArray(actual.errors) ? actual.errors.length : 0;

  return [
    `commandCount expected=${expectedCommands} actual=${actualCommands}`,
    `errorCount expected=${expectedErrors} actual=${actualErrors}`,
  ].join(" ");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const normalized = normalizeContract(readContractFromCli());

  if (opts.mode === "update") {
    writeSnapshot(opts.snapshotPath, normalized);
    process.stdout.write(`contract snapshot updated: ${opts.snapshotPath}\n`);
    return;
  }

  let expected;
  try {
    expected = normalizeContract(readSnapshot(opts.snapshotPath));
  } catch {
    throw new Error(`Missing or invalid snapshot at ${opts.snapshotPath}; run with --update`);
  }

  if (stableJson(expected) !== stableJson(normalized)) {
    process.stderr.write(`contract snapshot mismatch (${summarizeDiff(expected, normalized)})\n`);
    process.stderr.write(`run: node scripts/checks/contract-snapshot.mjs --update --snapshot ${opts.snapshotPath}\n`);
    process.exit(1);
  }

  process.stdout.write(`contract snapshot check passed: ${opts.snapshotPath}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown contract snapshot error";
  process.stderr.write(`contract-snapshot: ERROR ${message}\n`);
  process.exit(2);
}
