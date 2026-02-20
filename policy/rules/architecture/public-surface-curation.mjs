import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/core/**/public.ts"],
  exclude: [],
  allowInfraInFiles: [],
};

function normalizeOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  return {
    include: Array.isArray(merged.include) ? merged.include : DEFAULT_OPTIONS.include,
    exclude: Array.isArray(merged.exclude) ? merged.exclude : DEFAULT_OPTIONS.exclude,
    allowInfraInFiles: Array.isArray(merged.allowInfraInFiles) ? merged.allowInfraInFiles : DEFAULT_OPTIONS.allowInfraInFiles,
  };
}

function extractModuleSpecifiers(content) {
  const imports = [];
  const pattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const specifier = match[1];
    if (typeof specifier === "string" && specifier.length > 0) {
      imports.push(specifier);
    }
  }
  return imports;
}

function resolveRelativeImport(file, specifier) {
  const baseDir = path.posix.dirname(file);
  return path.posix.normalize(path.posix.join(baseDir, specifier));
}

function normalizeImportTarget(resolved) {
  return resolved.replace(/\.(c|m)?(j|t)sx?$/i, "");
}

function domainForPath(file) {
  const match = /^src\/core\/([^/]+)\//.exec(file);
  return match ? match[1] : null;
}

function isAllowInfra(file, allowInfraInFiles) {
  return allowInfraInFiles.some((pattern) => path.matchesGlob(file, pattern));
}

export const rule = {
  id: "ARC015",
  name: "public-surface-curation",
  description: "Core public.ts should not couple callers to infra modules unless explicitly allowlisted",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      const sourceDomain = domainForPath(file);
      if (!sourceDomain || isAllowInfra(file, normalized.allowInfraInFiles)) {
        continue;
      }

      const content = helpers.readFile(file);
      const specifiers = extractModuleSpecifiers(content);

      for (const specifier of specifiers) {
        if (!specifier.startsWith(".")) {
          continue;
        }

        const target = normalizeImportTarget(resolveRelativeImport(file, specifier));
        const targetDomain = domainForPath(target);
        if (targetDomain !== sourceDomain) {
          continue;
        }

        if (!target.startsWith(`src/core/${sourceDomain}/infra/`)) {
          continue;
        }

        violations.push({
          ruleId: "ARC015",
          ruleName: "public-surface-curation",
          severity: "error",
          file,
          message: `public surface re-exports/imports infra module (${specifier})`,
          suggestion: "Promote boundary usecases to app/domain-facing modules and keep public.ts curated as stable surface",
        });
      }
    }

    return violations;
  },
};
