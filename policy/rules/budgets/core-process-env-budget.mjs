import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/**/*.ts"],
  exclude: [],
  allowPatterns: ["src/core/providers/**/*.ts", "src/cli.ts", "src/core/state/infra/state-store.ts"],
  maxViolations: 0,
  sampleLimit: 12,
};

function normalizeOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  return {
    include: Array.isArray(merged.include) ? merged.include : DEFAULT_OPTIONS.include,
    exclude: Array.isArray(merged.exclude) ? merged.exclude : DEFAULT_OPTIONS.exclude,
    allowPatterns: Array.isArray(merged.allowPatterns) ? merged.allowPatterns : DEFAULT_OPTIONS.allowPatterns,
    maxViolations: Number.isFinite(Number(merged.maxViolations)) ? Number(merged.maxViolations) : 0,
    sampleLimit: Number.isFinite(Number(merged.sampleLimit)) ? Number(merged.sampleLimit) : DEFAULT_OPTIONS.sampleLimit,
  };
}

function isAllowed(file, allowPatterns) {
  return allowPatterns.some((pattern) => path.posix.matchesGlob(file, pattern));
}

export const rule = {
  id: "BUDG003",
  name: "core-process-env-budget",
  description: "Budget: process.env access must be confined to providers/boundaries over time",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);

    const envRe = /\bprocess\.env\b/;
    const violations = [];

    for (const file of selected) {
      if (isAllowed(file, normalized.allowPatterns)) {
        continue;
      }
      const content = helpers.readFile(file);
      if (!envRe.test(content)) {
        continue;
      }
      violations.push(file);
    }

    const actual = violations.length;
    const limit = normalized.maxViolations;
    if (actual <= limit) {
      return [];
    }

    return [
      {
        ruleId: "BUDG003",
        ruleName: "core-process-env-budget",
        severity: "error",
        file: "src",
        message: `process.env access outside allowed patterns (sample): ${violations.slice(0, normalized.sampleLimit).join(", ")}`,
        actual,
        limit,
        overBy: actual - limit,
        suggestion:
          "Route env reads through src/core/providers and pass values inward; ratchet this budget down over time",
      },
    ];
  },
};

