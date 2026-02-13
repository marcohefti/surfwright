import path from "node:path";

const DEFAULT_OPTIONS = {
  max: 12,
  include: ["**/*"],
  exclude: [],
};

function normalizeOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  const max = Number.parseInt(String(merged.max), 10);
  if (!Number.isFinite(max) || max <= 0) {
    throw new Error("max-files-per-directory: options.max must be a positive integer");
  }
  return {
    max,
    include: Array.isArray(merged.include) ? merged.include : DEFAULT_OPTIONS.include,
    exclude: Array.isArray(merged.exclude) ? merged.exclude : DEFAULT_OPTIONS.exclude,
  };
}

export const rule = {
  id: "DIR001",
  name: "max-files-per-directory",
  description: "Directory must not exceed configured direct file count",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const counts = new Map();

    for (const file of selected) {
      const dir = path.posix.dirname(file);
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }

    const violations = [];
    for (const [dir, actual] of counts.entries()) {
      if (actual <= normalized.max) {
        continue;
      }
      violations.push({
        ruleId: "DIR001",
        ruleName: "max-files-per-directory",
        severity: "error",
        file: dir,
        message: `${actual} > ${normalized.max} (+${actual - normalized.max})`,
        actual,
        limit: normalized.max,
        overBy: actual - normalized.max,
        suggestion: "Split the folder by concern before adding more files",
      });
    }

    return violations;
  },
};
