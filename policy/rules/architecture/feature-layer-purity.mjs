import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/features/**/domain/**/*.ts", "src/features/**/usecases/**/*.ts"],
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

function featureRootForFile(file) {
  const match = /^src\/features\/([^/]+)\//.exec(file);
  if (!match) {
    return null;
  }
  return `src/features/${match[1]}`;
}

export const rule = {
  id: "ARC010",
  name: "feature-layer-purity",
  description: "Feature domain/usecases layers must remain IO-free and must not depend on commands/infra layers",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      const featureRoot = featureRootForFile(file);
      if (!featureRoot) {
        continue;
      }
      const isDomain = file.includes("/domain/");
      const isUsecases = file.includes("/usecases/");

      const content = helpers.readFile(file);
      const specifiers = extractModuleSpecifiers(content);

      for (const specifier of specifiers) {
        if (specifier === "playwright-core") {
          violations.push({
            ruleId: "ARC010",
            ruleName: "feature-layer-purity",
            severity: "error",
            file,
            message: 'feature domain/usecases must not import "playwright-core"',
            suggestion: "Move browser integration into feature infra (or core) and call it via an explicit boundary",
          });
          continue;
        }
        if (specifier.startsWith("node:")) {
          violations.push({
            ruleId: "ARC010",
            ruleName: "feature-layer-purity",
            severity: "error",
            file,
            message: `feature domain/usecases must not import Node builtins directly (${specifier})`,
            suggestion: "Move IO behind an infra adapter and pass normalized values in",
          });
          continue;
        }

        if (!specifier.startsWith(".")) {
          continue;
        }
        const resolved = normalizeImportTarget(resolveRelativeImport(file, specifier));
        if (!resolved.startsWith(`${featureRoot}/`)) {
          continue;
        }

        if (
          isDomain &&
          (resolved.startsWith(`${featureRoot}/commands/`) ||
            resolved.startsWith(`${featureRoot}/infra/`) ||
            resolved.startsWith(`${featureRoot}/usecases/`))
        ) {
          violations.push({
            ruleId: "ARC010",
            ruleName: "feature-layer-purity",
            severity: "error",
            file,
            message: `feature domain must not import outer layers (${specifier})`,
            suggestion: "Keep feature commands/usecases calling inward; domain should stay dependency-free",
          });
          continue;
        }

        if (isUsecases && resolved.startsWith(`${featureRoot}/commands/`)) {
          violations.push({
            ruleId: "ARC010",
            ruleName: "feature-layer-purity",
            severity: "error",
            file,
            message: `feature usecases must not import command modules (${specifier})`,
            suggestion: "Move shared logic to usecases/domain and keep commands as wiring only",
          });
        }
      }
    }

    return violations;
  },
};

