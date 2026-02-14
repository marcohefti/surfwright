#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredDocs = [
  "CHANGELOG.md",
  "docs/release-notes-process.md",
  "docs/release-governance.md",
  "docs/contributor-release-routing.md",
  "docs/update-lifecycle.md",
  "docs/skills-lifecycle.md",
];

function readText(relPath) {
  return fs.readFileSync(path.join(root, relPath), "utf8");
}

function exists(relPath) {
  return fs.existsSync(path.join(root, relPath));
}

const failures = [];

for (const relPath of requiredDocs) {
  if (!exists(relPath)) {
    failures.push(`missing required doc: ${relPath}`);
  }
}

if (exists("CHANGELOG.md")) {
  const changelog = readText("CHANGELOG.md");
  if (!changelog.includes("## [Unreleased]")) {
    failures.push("CHANGELOG.md missing '## [Unreleased]' section");
  }
}

if (exists("AGENTS.md")) {
  const agents = readText("AGENTS.md");
  if (!agents.includes("docs/release-governance.md")) {
    failures.push("AGENTS.md must reference docs/release-governance.md");
  }
  if (!agents.includes("docs/contributor-release-routing.md")) {
    failures.push("AGENTS.md must reference docs/contributor-release-routing.md");
  }
}

if (exists("README.md")) {
  const readme = readText("README.md");
  if (!readme.includes("## Availability")) {
    failures.push("README.md missing '## Availability' section");
  }
  if (!readme.includes("## Commands (Current)")) {
    failures.push("README.md missing '## Commands (Current)' section");
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`docs-check: FAIL ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write("docs-check: PASS\n");
