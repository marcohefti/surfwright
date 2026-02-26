#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const CONTRACT_SNAPSHOT_PATH = "test/fixtures/contract/contract.snapshot.json";
const APPROVAL_DOC_PATH = "docs/architecture/contract-diff-approvals.md";

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout;
}

function changedFilesFromWorkingTree() {
  const changed = new Set();
  for (const args of [["diff", "--name-only"], ["diff", "--cached", "--name-only"], ["ls-files", "--others", "--exclude-standard"]]) {
    const output = runGit(args);
    if (output === null) {
      continue;
    }
    for (const line of output.split("\n")) {
      const file = line.trim();
      if (file.length > 0) {
        changed.add(file);
      }
    }
  }
  return changed;
}

function fail(message) {
  process.stderr.write(`contract-diff-approval-check: FAIL ${message}\n`);
  process.exit(1);
}

const changedFiles = changedFilesFromWorkingTree();
if (changedFiles.size === 0) {
  process.stdout.write("contract-diff-approval-check: PASS (no pending changes)\n");
  process.exit(0);
}

if (!changedFiles.has(CONTRACT_SNAPSHOT_PATH)) {
  process.stdout.write("contract-diff-approval-check: PASS (contract snapshot unchanged)\n");
  process.exit(0);
}

if (!changedFiles.has(APPROVAL_DOC_PATH)) {
  fail(`contract snapshot changed without approval doc update (${APPROVAL_DOC_PATH})`);
}

if (!fs.existsSync(APPROVAL_DOC_PATH)) {
  fail(`missing approval doc at ${APPROVAL_DOC_PATH}`);
}

const approvalBody = fs.readFileSync(APPROVAL_DOC_PATH, "utf8");
if (!/##\s+\d{4}-\d{2}-\d{2}/.test(approvalBody)) {
  fail("approval doc must contain a date heading in format '## YYYY-MM-DD'");
}
if (!/Rationale:/i.test(approvalBody)) {
  fail("approval doc must include a 'Rationale:' section");
}

process.stdout.write("contract-diff-approval-check: PASS\n");
