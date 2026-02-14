#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const out = {
    version: null,
    changelog: "CHANGELOG.md",
    out: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--version") {
      out.version = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token === "--changelog") {
      out.changelog = argv[i + 1] ?? out.changelog;
      i += 1;
      continue;
    }
    if (token === "--out") {
      out.out = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  if (!out.version) {
    throw new Error("--version is required");
  }
  if (!out.out) {
    throw new Error("--out is required");
  }
  return out;
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

const args = parseArgs(process.argv.slice(2));
const changelogPath = path.resolve(args.changelog);
const outPath = path.resolve(args.out);
const changelog = fs.readFileSync(changelogPath, "utf8");

const versionHeading = `## [${args.version}]`;
const body = sectionBody(changelog, versionHeading);
if (!body || body.length === 0) {
  throw new Error(
    `Missing changelog section for ${args.version}. Add '## [${args.version}] - YYYY-MM-DD' before release/publish.`,
  );
}

const notes = [
  `## SurfWright v${args.version}`,
  "",
  "Generated from changelog (version section).",
  "",
  body,
  "",
  "## Verification",
  "- validate: pending",
  "- test: pending",
  "- skill:validate: pending",
].join("\n");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${notes}\n`, "utf8");
process.stdout.write(`release notes written: ${outPath}\n`);
