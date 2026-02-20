import path from "node:path";

const DEFAULT_OPTIONS = {
  boundedDomains: [],
  excludeDomains: [],
  allowedRootFiles: ["index.ts", "public.ts"],
};

function normalizeOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  return {
    boundedDomains: Array.isArray(merged.boundedDomains) ? merged.boundedDomains : DEFAULT_OPTIONS.boundedDomains,
    excludeDomains: Array.isArray(merged.excludeDomains) ? merged.excludeDomains : DEFAULT_OPTIONS.excludeDomains,
    allowedRootFiles: Array.isArray(merged.allowedRootFiles) ? merged.allowedRootFiles : DEFAULT_OPTIONS.allowedRootFiles,
  };
}

export const rule = {
  id: "ARC012",
  name: "core-domain-root-freeze",
  description: "Core domain roots may only contain stable entrypoints (index.ts/public.ts); move implementation into app/domain/infra",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options }) => {
    const normalized = normalizeOptions(options);
    const violations = [];

    const domains = normalized.boundedDomains
      .filter((d) => typeof d === "string" && d.length > 0)
      .filter((d) => !normalized.excludeDomains.includes(d));

    for (const domain of domains) {
      const pattern = `src/core/${domain}/*.ts`;
      for (const file of files) {
        if (!path.matchesGlob(file, pattern)) {
          continue;
        }
        const base = path.posix.basename(file);
        if (normalized.allowedRootFiles.includes(base)) {
          continue;
        }
        violations.push({
          ruleId: "ARC010",
          ruleName: "core-domain-root-freeze",
          severity: "error",
          file,
          message: `core domain root is frozen; ${domain} root may only contain ${normalized.allowedRootFiles.join(", ")}`,
          suggestion: `Move ${base} under src/core/${domain}/{app,domain,infra}/ and re-export via index/public if needed`,
        });
      }
    }

    return violations;
  },
};
