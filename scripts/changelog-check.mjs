#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// This check is intentionally narrow: changelog structure only.
// Avoid turning this into a repo-wide "docs wiring" linter.

const CHANGELOG_PATH = "CHANGELOG.md";

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

if (!exists(CHANGELOG_PATH)) {
  failures.push(`Missing ${CHANGELOG_PATH}`);
} else {
  const changelog = readText(CHANGELOG_PATH);
  if (!changelog.includes("## [Unreleased]")) {
    failures.push(`${CHANGELOG_PATH} missing '## [Unreleased]' section`);
  }
  const unreleasedBody = sectionBody(changelog, "## [Unreleased]");
  if (!unreleasedBody || unreleasedBody.length === 0) {
    failures.push(`${CHANGELOG_PATH} missing body for '## [Unreleased]'`);
  } else {
    const requiredBuckets = ["Added", "Changed", "Fixed", "Transition Notes", "Removed"];
    for (const bucket of requiredBuckets) {
      const heading = `### ${bucket}`;
      if (!unreleasedBody.includes(heading)) {
        failures.push(`${CHANGELOG_PATH} Unreleased missing '${heading}'`);
        continue;
      }
      const bucketPattern = new RegExp(`### ${bucket}\\n([\\s\\S]*?)(?=\\n### |$)`);
      const match = unreleasedBody.match(bucketPattern);
      const bucketBody = match?.[1] ?? "";
      if (!/\n-\s+/.test(`\n${bucketBody}`)) {
        failures.push(`${CHANGELOG_PATH} Unreleased '${heading}' must include at least one list item`);
      }
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`changelog-check: FAIL ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write("changelog-check: PASS\n");
