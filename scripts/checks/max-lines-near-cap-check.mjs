#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT_DIR = process.cwd();
const TARGET_DIRS = ["src", "scripts", "test"];
const TARGET_EXTENSIONS = new Set([".ts", ".mjs"]);
const DEFAULT_MAX_LINES = 500;
const DEFAULT_WARN_RATIO = 0.9;

function loadLintConfig() {
  const configPath = path.join(ROOT_DIR, ".oxlintrc.json");
  const raw = fs.readFileSync(configPath, "utf8");
  return JSON.parse(raw);
}

function resolveMaxLines(config) {
  if (Array.isArray(config.overrides) === false) {
    return DEFAULT_MAX_LINES;
  }
  for (const override of config.overrides) {
    if (override && override.rules && Array.isArray(override.rules["max-lines"])) {
      const tuple = override.rules["max-lines"];
      if (tuple.length > 1 && tuple[1] && typeof tuple[1].max === "number") {
        return tuple[1].max;
      }
    }
  }
  return DEFAULT_MAX_LINES;
}

function resolveExemptFiles(config) {
  const exempt = new Set();
  if (Array.isArray(config.overrides) === false) {
    return exempt;
  }
  for (const override of config.overrides) {
    if (!override || !override.rules || override.rules["max-lines"] !== "off") {
      continue;
    }
    if (Array.isArray(override.files) === false) {
      continue;
    }
    for (const filePath of override.files) {
      if (typeof filePath === "string" && filePath.includes("*") === false) {
        exempt.add(filePath.replaceAll("\\", "/"));
      }
    }
  }
  return exempt;
}

function listFilesWithRipgrep() {
  const result = spawnSync("rg", ["--files", ...TARGET_DIRS], {
    cwd: ROOT_DIR,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((filePath) => TARGET_EXTENSIONS.has(path.extname(filePath)));
}

function listFilesByWalk() {
  const files = [];
  const stack = [...TARGET_DIRS.map((entry) => path.join(ROOT_DIR, entry))];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current !== "string") {
      continue;
    }
    if (fs.existsSync(current) === false) {
      continue;
    }
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        stack.push(path.join(current, entry.name));
      }
      continue;
    }
    if (stat.isFile() && TARGET_EXTENSIONS.has(path.extname(current))) {
      files.push(path.relative(ROOT_DIR, current).replaceAll("\\", "/"));
    }
  }
  files.sort();
  return files;
}

function readLineCount(filePath) {
  const text = fs.readFileSync(path.join(ROOT_DIR, filePath), "utf8");
  if (text.length === 0) {
    return 0;
  }
  return text.split("\n").length;
}

const jsonMode = process.argv.includes("--json");
const config = loadLintConfig();
const maxLines = resolveMaxLines(config);
const warnThreshold = Math.ceil(maxLines * DEFAULT_WARN_RATIO);
const exempt = resolveExemptFiles(config);
const files = listFilesWithRipgrep() ?? listFilesByWalk();

const nearCap = [];
for (const filePath of files) {
  if (exempt.has(filePath)) {
    continue;
  }
  const lineCount = readLineCount(filePath);
  if (lineCount < warnThreshold) {
    continue;
  }
  nearCap.push({
    filePath,
    lineCount,
    maxLines,
    percentOfCap: Number(((lineCount / maxLines) * 100).toFixed(1)),
  });
}

nearCap.sort((a, b) => {
  if (b.lineCount !== a.lineCount) {
    return b.lineCount - a.lineCount;
  }
  return a.filePath.localeCompare(b.filePath);
});

if (jsonMode) {
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        maxLines,
        warnThreshold,
        fileCount: files.length,
        nearCapCount: nearCap.length,
        nearCap,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

if (nearCap.length === 0) {
  process.stdout.write(
    `max-lines-near-cap-check: PASS (0 files at >= ${warnThreshold}/${maxLines} lines; exempt=${exempt.size})\n`,
  );
  process.exit(0);
}

process.stdout.write(
  `max-lines-near-cap-check: WARN ${nearCap.length} file(s) at >= ${warnThreshold}/${maxLines} lines (exempt=${exempt.size})\n`,
);
for (const entry of nearCap) {
  process.stdout.write(`- ${entry.filePath}: ${entry.lineCount} lines (${entry.percentOfCap}% of cap)\n`);
}
process.exit(0);
