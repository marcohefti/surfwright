import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/core/**/domain/**/*.ts", "src/core/**/app/**/*.ts"],
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

function resolveRelativeImport(file, specifier) {
  const baseDir = path.posix.dirname(file);
  return path.posix.normalize(path.posix.join(baseDir, specifier));
}

function normalizeImportTarget(resolved) {
  return resolved.replace(/\.(c|m)?(j|t)sx?$/i, "");
}

export const rule = {
  id: "ARC008",
  name: "core-layer-purity",
  description: "Core app/domain layers must not import infra/surface dependencies",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      const content = helpers.readFile(file);
      const specifiers = extractModuleSpecifiers(content);

      for (const specifier of specifiers) {
        if (specifier === "playwright-core") {
          violations.push({
            ruleId: "ARC008",
            ruleName: "core-layer-purity",
            severity: "error",
            file,
            message: 'core app/domain must not import "playwright-core"',
            suggestion: "Move browser integration into infra and call it via an explicit boundary",
          });
          continue;
        }
        if (specifier.startsWith("node:")) {
          violations.push({
            ruleId: "ARC008",
            ruleName: "core-layer-purity",
            severity: "error",
            file,
            message: `core app/domain must not import Node builtins directly (${specifier})`,
            suggestion: "Move IO behind providers/infra adapters and pass in normalized values",
          });
          continue;
        }

        if (!specifier.startsWith(".")) {
          continue;
        }
        const resolved = normalizeImportTarget(resolveRelativeImport(file, specifier));
        if (resolved.startsWith("src/features/")) {
          violations.push({
            ruleId: "ARC008",
            ruleName: "core-layer-purity",
            severity: "error",
            file,
            message: `core app/domain must not import surface modules (${specifier})`,
            suggestion: "Keep surface calling inward; do not import features from core",
          });
        }
      }
    }

    return violations;
  },
};

