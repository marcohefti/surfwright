import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/features/**/*.ts"],
  exclude: [],
};

function normalizeOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  return {
    include: Array.isArray(merged.include) ? merged.include : DEFAULT_OPTIONS.include,
    exclude: Array.isArray(merged.exclude) ? merged.exclude : DEFAULT_OPTIONS.exclude,
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

function sourceFeature(file) {
  const match = /^src\/features\/([^/]+)\//.exec(file);
  return match ? match[1] : null;
}

function resolveRelativeImport(file, specifier) {
  const baseDir = path.posix.dirname(file);
  const resolved = path.posix.normalize(path.posix.join(baseDir, specifier));
  return resolved;
}

function normalizeImportTarget(resolved) {
  return resolved.replace(/\.(c|m)?(j|t)sx?$/i, "");
}

function isFeatureIndexPath(targetPath, featureName) {
  return targetPath === `src/features/${featureName}` || targetPath === `src/features/${featureName}/index`;
}

export const rule = {
  id: "ARC001",
  name: "feature-boundaries",
  description: "Cross-feature imports must go through feature public index",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      const fromFeature = sourceFeature(file);
      if (!fromFeature) {
        continue;
      }
      const content = helpers.readFile(file);
      const specifiers = extractModuleSpecifiers(content);

      for (const specifier of specifiers) {
        if (!specifier.startsWith(".")) {
          continue;
        }
        const resolved = resolveRelativeImport(file, specifier);
        if (!resolved.startsWith("src/features/")) {
          continue;
        }
        const targetFeature = sourceFeature(`${resolved}/`);
        if (!targetFeature || targetFeature === fromFeature) {
          continue;
        }
        const targetWithoutExt = normalizeImportTarget(resolved);
        if (isFeatureIndexPath(targetWithoutExt, targetFeature)) {
          continue;
        }
        violations.push({
          ruleId: "ARC001",
          ruleName: "feature-boundaries",
          severity: "error",
          file,
          message: `cross-feature import "${specifier}" must target src/features/${targetFeature}/index`,
          suggestion: "Import via the other feature's public index to keep internals encapsulated",
        });
      }
    }

    return violations;
  },
};
