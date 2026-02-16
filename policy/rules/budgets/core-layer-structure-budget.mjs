const DEFAULT_OPTIONS = {
  // List of bounded core domains we expect to eventually be layered.
  // Set budgets/allowlists in config to ratchet adoption without regressions.
  boundedDomains: [],
  requiredDirs: ["app", "domain", "infra"],
  excludeDomains: [],
  maxMissingDomains: 0,
};

function normalizeOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  return {
    boundedDomains: Array.isArray(merged.boundedDomains) ? merged.boundedDomains : DEFAULT_OPTIONS.boundedDomains,
    requiredDirs: Array.isArray(merged.requiredDirs) ? merged.requiredDirs : DEFAULT_OPTIONS.requiredDirs,
    excludeDomains: Array.isArray(merged.excludeDomains) ? merged.excludeDomains : DEFAULT_OPTIONS.excludeDomains,
    maxMissingDomains: Number.isFinite(Number(merged.maxMissingDomains)) ? Number(merged.maxMissingDomains) : 0,
  };
}

function hasAnyFileWithPrefix(files, prefix) {
  return files.some((file) => file.startsWith(prefix));
}

export const rule = {
  id: "BUDG001",
  name: "core-layer-structure-budget",
  description: "Budget: core bounded domains missing app/domain/infra layering must not exceed threshold",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options }) => {
    const normalized = normalizeOptions(options);

    const requiredDirs = normalized.requiredDirs.filter((dir) => typeof dir === "string" && dir.length > 0);
    const excluded = new Set(normalized.excludeDomains);

    const missingDomains = [];
    for (const domain of normalized.boundedDomains) {
      if (excluded.has(domain)) {
        continue;
      }
      const base = `src/core/${domain}/`;
      const ok = requiredDirs.every((dir) => hasAnyFileWithPrefix(files, `${base}${dir}/`));
      if (!ok) {
        missingDomains.push(domain);
      }
    }

    const actual = missingDomains.length;
    const limit = normalized.maxMissingDomains;
    if (actual <= limit) {
      return [];
    }

    return [
      {
        ruleId: "BUDG001",
        ruleName: "core-layer-structure-budget",
        severity: "error",
        file: "src/core",
        message: `layering missing in core domains: ${missingDomains.join(", ")}`,
        actual,
        limit,
        overBy: actual - limit,
        suggestion: "Add src/core/<domain>/{app,domain,infra} and migrate modules behind stable entrypoints; ratchet this budget down over time",
      },
    ];
  },
};

