import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT_PATH = path.resolve("scripts", "release", "release-notes-from-changelog.mjs");

function runScript(args) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: "utf8",
    env: process.env,
  });
}

test("release notes generator succeeds when changelog has explicit version section", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-release-notes-ok-"));
  const changelogPath = path.join(tempRoot, "CHANGELOG.md");
  const outPath = path.join(tempRoot, "release-notes.md");
  fs.writeFileSync(
    changelogPath,
    `# Changelog

## [Unreleased]

### Added
- [docs] None.

### Changed
- [docs] None.

### Fixed
- [docs] None.

### Deprecated
- [docs] None.

### Removed
- [docs] None.

## [1.2.3] - 2026-02-14

### Added
- [cli] Something shipped.
`,
    "utf8",
  );

  const result = runScript(["--version", "1.2.3", "--changelog", changelogPath, "--out", outPath]);
  assert.equal(result.status, 0);
  const notes = fs.readFileSync(outPath, "utf8");
  assert.equal(notes.includes("## SurfWright v1.2.3"), true);
  assert.equal(notes.includes("Something shipped"), true);
});

test("release notes generator fails when changelog version section is missing", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-release-notes-fail-"));
  const changelogPath = path.join(tempRoot, "CHANGELOG.md");
  const outPath = path.join(tempRoot, "release-notes.md");
  fs.writeFileSync(
    changelogPath,
    `# Changelog

## [Unreleased]

### Added
- [docs] None.
`,
    "utf8",
  );

  const result = runScript(["--version", "9.9.9", "--changelog", changelogPath, "--out", outPath]);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.includes("Missing changelog section for 9.9.9"), true);
});

test("release notes generator does not match version strings outside headings", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-release-notes-false-positive-"));
  const changelogPath = path.join(tempRoot, "CHANGELOG.md");
  const outPath = path.join(tempRoot, "release-notes.md");
  fs.writeFileSync(
    changelogPath,
    `# Changelog

## [Unreleased]

### Added
- [docs] Mentioned string that looks like a heading: ## [1.2.3] - 2026-02-14
`,
    "utf8",
  );

  const result = runScript(["--version", "1.2.3", "--changelog", changelogPath, "--out", outPath]);
  assert.notEqual(result.status, 0);
  assert.equal(result.stderr.includes("Missing changelog section for 1.2.3"), true);
});
