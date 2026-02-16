import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/**/*.ts"],
  exclude: [],
  allowlist: ["src/cli.ts", "src/core/state.ts", "src/core/pipeline-support/plan.ts"],
};

function normalizeOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  return {
    include: Array.isArray(merged.include) ? merged.include : DEFAULT_OPTIONS.include,
    exclude: Array.isArray(merged.exclude) ? merged.exclude : DEFAULT_OPTIONS.exclude,
    allowlist: Array.isArray(merged.allowlist) ? merged.allowlist : DEFAULT_OPTIONS.allowlist,
  };
}

function matchesAny(file, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => path.matchesGlob(file, pattern));
}

export const rule = {
  id: "ARC007",
  name: "boundary-json-parse",
  description: "JSON.parse should happen only in explicit boundary modules (allowlist)",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      if (matchesAny(file, normalized.allowlist)) {
        continue;
      }
      const content = helpers.readFile(file);
      if (!/\bJSON\.parse\s*\(/.test(content)) {
        continue;
      }
      violations.push({
        ruleId: "ARC007",
        ruleName: "boundary-json-parse",
        severity: "error",
        file,
        message: "JSON.parse usage must be confined to explicit boundary modules (not allowed here)",
        suggestion: "Move parsing into a boundary adapter and pass normalized data inward",
      });
    }

    return violations;
  },
};

