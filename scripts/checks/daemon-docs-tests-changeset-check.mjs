#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const BEHAVIOR_PREFIXES = [
  "src/cli.ts",
  "src/core/daemon/",
  "src/core/session/infra/runtime-pool.ts",
  "src/core/session/infra/runtime-access.ts",
];

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
  return [...changed];
}

function isBehaviorFile(filePath) {
  return BEHAVIOR_PREFIXES.some((prefix) => filePath === prefix || filePath.startsWith(prefix));
}

function isTestFile(filePath) {
  return filePath.startsWith("test/") && filePath.endsWith(".test.mjs");
}

function isDocFile(filePath) {
  return (
    filePath === "README.md" ||
    filePath === "CHANGELOG.md" ||
    filePath === "AGENTS.md" ||
    filePath === "skills/surfwright/SKILL.md" ||
    filePath.startsWith("docs/") ||
    filePath.startsWith("tmp/daemon-concept/")
  );
}

function fail(message) {
  process.stderr.write(`daemon-docs-tests-changeset-check: FAIL ${message}\n`);
  process.exit(1);
}

const changedFiles = changedFilesFromWorkingTree();
if (changedFiles.length === 0) {
  process.stdout.write("daemon-docs-tests-changeset-check: PASS (no pending changes)\n");
  process.exit(0);
}

const behaviorChanged = changedFiles.some(isBehaviorFile);
if (!behaviorChanged) {
  process.stdout.write("daemon-docs-tests-changeset-check: PASS (daemon behavior surface unchanged)\n");
  process.exit(0);
}

const hasTest = changedFiles.some(isTestFile);
const hasDoc = changedFiles.some(isDocFile);

if (!hasTest || !hasDoc) {
  fail(
    `daemon behavior files changed without required same-change-set updates (tests=${hasTest ? "yes" : "no"}, docs=${hasDoc ? "yes" : "no"})`,
  );
}

process.stdout.write("daemon-docs-tests-changeset-check: PASS\n");
