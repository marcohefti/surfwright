#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { extractChangelogVersionSection } from "./changelog-sections.mjs";

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

const args = parseArgs(process.argv.slice(2));
const changelogPath = path.resolve(args.changelog);
const outPath = path.resolve(args.out);
const changelog = fs.readFileSync(changelogPath, "utf8");

const section = extractChangelogVersionSection(changelog, args.version);
const body = section?.body ?? null;
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
