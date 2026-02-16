const DEFAULT_OPTIONS = {
  max: 500,
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
    throw new Error("max-loc: options.max must be a positive integer");
  }

  return {
    max,
    include: Array.isArray(merged.include) ? merged.include : DEFAULT_OPTIONS.include,
    exclude: Array.isArray(merged.exclude) ? merged.exclude : DEFAULT_OPTIONS.exclude,
  };
}

function countLines(text) {
  if (text.length === 0) {
    return 0;
  }
  const newlineCount = text.match(/\n/g)?.length ?? 0;
  return text.endsWith("\n") ? newlineCount : newlineCount + 1;
}

export const rule = {
  id: "LOC001",
  name: "max-loc",
  description: "File must not exceed a configured line count limit",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      const content = helpers.readFile(file);
      const actual = countLines(content);
      if (actual <= normalized.max) {
        continue;
      }
      violations.push({
        ruleId: "LOC001",
        ruleName: "max-loc",
        severity: "error",
        file,
        message: `${actual} > ${normalized.max} (+${actual - normalized.max})`,
        actual,
        limit: normalized.max,
        overBy: actual - normalized.max,
        suggestion: "Split file by concern to reduce file size and review scope",
      });
    }

    return violations;
  },
};
