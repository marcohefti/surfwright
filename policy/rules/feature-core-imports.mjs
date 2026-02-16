import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/features/**/*.ts"],
  exclude: [],
  allowCoreImports: [
    "src/core/cli-contract",
    "src/core/daemon/public",
    "src/core/extensions/public",
    "src/core/network/public",
    "src/core/network-types",
    "src/core/pipeline/public",
    "src/core/session/public",
    "src/core/state/public",
    "src/core/target/public",
    "src/core/types",
    "src/core/update/public",
    "src/core/*/public",
  ],
};

function normalizeOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  return {
    include: Array.isArray(merged.include) ? merged.include : DEFAULT_OPTIONS.include,
    exclude: Array.isArray(merged.exclude) ? merged.exclude : DEFAULT_OPTIONS.exclude,
    allowCoreImports: Array.isArray(merged.allowCoreImports) ? merged.allowCoreImports : DEFAULT_OPTIONS.allowCoreImports,
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

function isAllowed(targetPath, allowPatterns) {
  return allowPatterns.some((pattern) => path.posix.matchesGlob(targetPath, pattern));
}

export const rule = {
  id: "ARC002",
  name: "feature-core-imports",
  description: "Feature modules may only import approved core boundaries",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
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
        if (isAllowed(target, normalized.allowCoreImports)) {
          continue;
        }
        violations.push({
          ruleId: "ARC002",
          ruleName: "feature-core-imports",
          severity: "error",
          file,
          message: `feature import "${specifier}" crosses into non-approved core module ${target}`,
          suggestion: "Use approved core boundary modules or promote a stable feature-facing facade",
        });
      }
    }

    return violations;
  },
};
