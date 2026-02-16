import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/core/*.ts"],
  exclude: [],
  allowlist: [],
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
  id: "ARC009",
  name: "core-root-freeze",
  description: "Prevent new src/core/*.ts modules; core root is reserved for stable facades only",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      if (matchesAny(file, normalized.allowlist)) {
        continue;
      }
      violations.push({
        ruleId: "ARC009",
        ruleName: "core-root-freeze",
        severity: "error",
        file,
        message: "new src/core/*.ts modules are forbidden (core root is frozen)",
        suggestion: "Place new implementation under a bounded core subfolder (e.g. src/core/<domain>/*) and expose it via a stable public entrypoint",
      });
    }

    return violations;
  },
};

