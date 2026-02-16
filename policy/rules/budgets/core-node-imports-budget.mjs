import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/core/**/*.ts"],
  exclude: [],
  allowPatterns: ["src/core/**/infra/**/*.ts", "src/core/providers/**/*.ts", "src/core/browser.ts", "src/core/cli-contract.ts"],
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
  id: "BUDG002",
  name: "core-node-imports-budget",
  description: "Budget: node: imports outside infra/providers must not exceed threshold (forces layering adoption)",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);

    const nodeImportRe = /^\s*import\s+[\s\S]*?\s+from\s+["']node:[^"']+["']/m;
    const violations = [];

    for (const file of selected) {
      if (isAllowed(file, normalized.allowPatterns)) {
        continue;
      }
      const content = helpers.readFile(file);
      if (!nodeImportRe.test(content)) {
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
        ruleId: "BUDG002",
        ruleName: "core-node-imports-budget",
        severity: "error",
        file: "src/core",
        message: `node: imports outside allowed patterns (sample): ${violations.slice(0, normalized.sampleLimit).join(", ")}`,
        actual,
        limit,
        overBy: actual - limit,
        suggestion:
          "Move node: imports into src/core/<domain>/infra/** (or providers), and keep app/domain layers pure; ratchet this budget down over time",
      },
    ];
  },
};

