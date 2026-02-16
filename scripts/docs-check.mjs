#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const requiredDocs = [
  "AGENTS.md",
  "README.md",
  "CHANGELOG.md",
  "docs/agent-guidance-architecture.md",
  "docs/agent-dev-flow.md",
  "docs/policy-harness.md",
  "docs/maintaining-agent-surface.md",
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

function sectionBody(changelog, heading) {
  const headingIndex = changelog.indexOf(heading);
  if (headingIndex === -1) {
    return null;
  }
  const afterHeading = changelog.slice(headingIndex + heading.length);
  const nextHeadingIndex = afterHeading.search(/\n##\s+\[/);
  if (nextHeadingIndex === -1) {
    return afterHeading.trim();
  }
  return afterHeading.slice(0, nextHeadingIndex).trim();
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
  const unreleasedBody = sectionBody(changelog, "## [Unreleased]");
  if (!unreleasedBody || unreleasedBody.length === 0) {
    failures.push("CHANGELOG.md missing body for '## [Unreleased]'");
  } else {
    const requiredBuckets = ["Added", "Changed", "Fixed", "Deprecated", "Removed"];
    for (const bucket of requiredBuckets) {
      const heading = `### ${bucket}`;
      if (!unreleasedBody.includes(heading)) {
        failures.push(`CHANGELOG.md Unreleased missing '${heading}'`);
        continue;
      }
      const bucketPattern = new RegExp(`### ${bucket}\\n([\\s\\S]*?)(?=\\n### |$)`);
      const match = unreleasedBody.match(bucketPattern);
      const bucketBody = match?.[1] ?? "";
      if (!/\n-\s+/.test(`\n${bucketBody}`)) {
        failures.push(`CHANGELOG.md Unreleased '${heading}' must include at least one list item`);
      }
    }
  }
}

if (exists("AGENTS.md")) {
  const agents = readText("AGENTS.md");
  const requiredRefs = [
    "README.md",
    "docs/agent-guidance-architecture.md",
    "docs/agent-dev-flow.md",
    "docs/policy-harness.md",
    "docs/maintaining-agent-surface.md",
    "docs/release-governance.md",
    "docs/contributor-release-routing.md",
  ];
  for (const ref of requiredRefs) {
    if (!agents.includes(ref)) {
      failures.push(`AGENTS.md must reference ${ref}`);
    }
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
