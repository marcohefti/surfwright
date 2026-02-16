import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/core/**/*.ts"],
  exclude: [],
  allowPatterns: ["src/core/**/infra/**/*.ts", "src/core/providers/**/*.ts"],
};

function normalizeOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  return {
    include: Array.isArray(merged.include) ? merged.include : DEFAULT_OPTIONS.include,
    exclude: Array.isArray(merged.exclude) ? merged.exclude : DEFAULT_OPTIONS.exclude,
    allowPatterns: Array.isArray(merged.allowPatterns) ? merged.allowPatterns : DEFAULT_OPTIONS.allowPatterns,
  };
}

function matchesAny(file, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => path.matchesGlob(file, pattern));
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

export const rule = {
  id: "ARC011",
  name: "core-providers-imports",
  description: "Only infra may import src/core/providers; keep providers usage out of app/domain and stable entrypoints",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      if (matchesAny(file, normalized.allowPatterns)) {
        continue;
      }
      const content = helpers.readFile(file);
      const specifiers = extractModuleSpecifiers(content);
      for (const specifier of specifiers) {
        if (!specifier.startsWith(".")) {
          continue;
        }
        const resolved = normalizeImportTarget(resolveRelativeImport(file, specifier));
        if (resolved !== "src/core/providers/index") {
          continue;
        }
        violations.push({
          ruleId: "ARC011",
          ruleName: "core-providers-imports",
          severity: "error",
          file,
          message: "providers() must only be imported from infra (or providers itself)",
          suggestion: "Move provider usage into infra adapters and pass normalized values inward",
        });
      }
    }

    return violations;
  },
};

