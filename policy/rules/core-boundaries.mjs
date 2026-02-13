import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/core/**/*.ts"],
  exclude: [],
  boundedDomains: ["session", "state", "shared", "target", "daemon"],
  allowCrossDomainInternal: ["src/core/session/index", "src/core/shared/index"],
};

function normalizeOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  return {
    include: Array.isArray(merged.include) ? merged.include : DEFAULT_OPTIONS.include,
    exclude: Array.isArray(merged.exclude) ? merged.exclude : DEFAULT_OPTIONS.exclude,
    boundedDomains: Array.isArray(merged.boundedDomains) ? merged.boundedDomains : DEFAULT_OPTIONS.boundedDomains,
    allowCrossDomainInternal: Array.isArray(merged.allowCrossDomainInternal)
      ? merged.allowCrossDomainInternal
      : DEFAULT_OPTIONS.allowCrossDomainInternal,
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

function fileDomain(file, boundedDomains) {
  const match = /^src\/core\/([^/]+)\/.+/.exec(file);
  if (!match) {
    return null;
  }
  const domain = match[1];
  return boundedDomains.includes(domain) ? domain : null;
}

function isAllowed(targetPath, allowPatterns) {
  return allowPatterns.some((pattern) => path.posix.matchesGlob(targetPath, pattern));
}

export const rule = {
  id: "ARC004",
  name: "core-boundaries",
  description: "Core bounded-domain internals must not directly import another domain internals",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      const sourceDomain = fileDomain(file, normalized.boundedDomains);
      if (!sourceDomain) {
        continue;
      }
      const content = helpers.readFile(file);
      const specifiers = extractModuleSpecifiers(content);

      for (const specifier of specifiers) {
        if (!specifier.startsWith(".")) {
          continue;
        }
        const resolved = resolveRelativeImport(file, specifier);
        if (!resolved.startsWith("src/core/")) {
          continue;
        }
        const target = normalizeImportTarget(resolved);
        if (isAllowed(target, normalized.allowCrossDomainInternal)) {
          continue;
        }
        const targetDomain = fileDomain(target, normalized.boundedDomains);
        if (!targetDomain || targetDomain === sourceDomain) {
          continue;
        }
        violations.push({
          ruleId: "ARC004",
          ruleName: "core-boundaries",
          severity: "error",
          file,
          message: `core domain import "${specifier}" crosses from ${sourceDomain} to ${targetDomain} internals (${target})`,
          suggestion: `Import through a stable core facade (for example src/core/${targetDomain}-*.ts) instead of direct internal coupling`,
        });
      }
    }

    return violations;
  },
};
