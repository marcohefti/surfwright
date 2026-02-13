#!/usr/bin/env node
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ruleRegistry } from "../policy/rules/index.mjs";

function parseArgs(argv) {
  const args = {
    json: false,
    configPath: "policy/config.json",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "--config") {
      const value = argv[i + 1];
      if (!value) {
        throw new Error("--config requires a path");
      }
      args.configPath = value;
      i += 1;
      continue;
    }
    if (token === "-h" || token === "--help") {
      process.stdout.write(
        [
          "Usage: node scripts/policy-check.mjs [--json] [--config <path>]",
          "",
          "Checks repository policy rules and exits non-zero on violations.",
        ].join("\n") + "\n",
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

function normalizeRelative(filePath) {
  return filePath.replace(/\\/g, "/");
}

function listFilesWithRipgrep(rootDir) {
  const rg = spawnSync("rg", ["--files"], {
    cwd: rootDir,
    encoding: "utf8",
  });

  if (rg.status !== 0 || typeof rg.stdout !== "string") {
    return null;
  }

  return rg.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => normalizeRelative(line));
}

function listFilesByWalking(rootDir) {
  const out = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      const rel = normalizeRelative(path.relative(rootDir, abs));
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (entry.isFile()) {
        out.push(rel);
      }
    }
  }

  return out;
}

function matchesAny(file, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => path.matchesGlob(file, pattern));
}

function filterFiles(files, include, exclude) {
  const includePatterns = Array.isArray(include) && include.length > 0 ? include : ["**/*"];
  const excludePatterns = Array.isArray(exclude) ? exclude : [];

  return files.filter((file) => {
    if (!matchesAny(file, includePatterns)) {
      return false;
    }
    if (matchesAny(file, excludePatterns)) {
      return false;
    }
    return true;
  });
}

function sortViolations(violations) {
  return [...violations].sort((a, b) => {
    const severityRank = { error: 0, warn: 1, info: 2 };
    const sa = severityRank[a.severity] ?? 9;
    const sb = severityRank[b.severity] ?? 9;
    if (sa !== sb) {
      return sa - sb;
    }
    const oa = typeof a.overBy === "number" ? a.overBy : 0;
    const ob = typeof b.overBy === "number" ? b.overBy : 0;
    if (oa !== ob) {
      return ob - oa;
    }
    if (a.file !== b.file) {
      return a.file.localeCompare(b.file);
    }
    return a.ruleId.localeCompare(b.ruleId);
  });
}

function loadConfig(rootDir, configPath) {
  const abs = path.resolve(rootDir, configPath);
  const raw = fs.readFileSync(abs, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid config at ${configPath}`);
  }
  if (!Array.isArray(parsed.rules)) {
    throw new Error(`Config ${configPath} must contain a rules array`);
  }
  return parsed;
}

function readFileUtf8(rootDir, relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function printText(report) {
  if (report.ok) {
    process.stdout.write(
      `policy-check: PASS (${report.summary.rulesRun} rules, ${report.summary.filesScanned} files scanned)\n`,
    );
    return;
  }

  process.stdout.write(`policy-check: FAIL (${report.summary.violations} violations)\n\n`);
  for (const violation of report.violations) {
    const suffix =
      typeof violation.actual === "number" && typeof violation.limit === "number"
        ? `  ${violation.actual} > ${violation.limit}  (+${violation.overBy})`
        : "";
    process.stdout.write(`[${violation.ruleId}] ${violation.file}${suffix}\n`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, "..");

  const config = loadConfig(rootDir, args.configPath);
  const allFiles = listFilesWithRipgrep(rootDir) ?? listFilesByWalking(rootDir);
  const globalFiles = filterFiles(allFiles, config.files?.include, config.files?.exclude);

  const violations = [];
  let rulesRun = 0;

  for (const ruleConfig of config.rules) {
    const enabled = ruleConfig?.enabled !== false;
    if (!enabled) {
      continue;
    }

    const ruleName = ruleConfig?.name;
    if (typeof ruleName !== "string" || ruleName.length === 0) {
      throw new Error("Each enabled rule must define a non-empty name");
    }

    const rule = ruleRegistry.get(ruleName);
    if (!rule) {
      throw new Error(`Unknown policy rule: ${ruleName}`);
    }

    rulesRun += 1;
    const ruleViolations = await rule.check({
      files: globalFiles,
      options: ruleConfig.options ?? rule.defaultOptions ?? {},
      helpers: {
        filterFiles,
        readFile: (file) => readFileUtf8(rootDir, file),
      },
    });

    if (!Array.isArray(ruleViolations)) {
      throw new Error(`Rule ${ruleName} must return an array of violations`);
    }
    violations.push(...ruleViolations);
  }

  const sortedViolations = sortViolations(violations);
  const report = {
    ok: sortedViolations.length === 0,
    summary: {
      filesScanned: globalFiles.length,
      rulesRun,
      violations: sortedViolations.length,
    },
    violations: sortedViolations,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printText(report);
  }

  process.exit(report.ok ? 0 : 1);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown policy-check error";
  process.stderr.write(`policy-check: ERROR ${message}\n`);
  process.exit(2);
}
