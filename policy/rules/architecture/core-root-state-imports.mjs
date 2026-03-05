import path from "node:path";
import { extractImportsWithClauses, stripKnownSourceExtension } from "../import-utils.mjs";

const DEFAULT_OPTIONS = {
  include: ["src/**/*.ts"],
  exclude: [],
  allowImportFromCoreRootState: ["src/core/state/**/*.ts"],
};

function normalizeOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  return {
    include: Array.isArray(merged.include) ? merged.include : DEFAULT_OPTIONS.include,
    exclude: Array.isArray(merged.exclude) ? merged.exclude : DEFAULT_OPTIONS.exclude,
    allowImportFromCoreRootState: Array.isArray(merged.allowImportFromCoreRootState)
      ? merged.allowImportFromCoreRootState
      : DEFAULT_OPTIONS.allowImportFromCoreRootState,
  };
}

function extractImports(content) {
  return extractImportsWithClauses(content);
}

function resolveRelativeImport(file, specifier) {
  const baseDir = path.posix.dirname(file);
  const resolved = path.posix.normalize(path.posix.join(baseDir, specifier));
  return stripKnownSourceExtension(resolved);
}

function isAllowed(file, allowPatterns) {
  return allowPatterns.some((pattern) => path.posix.matchesGlob(file, pattern));
}

export const rule = {
  id: "ARC011",
  name: "core-root-state-imports",
  description: "Banned: importing the core-root src/core/state facade outside the state domain",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      const content = helpers.readFile(file);
      const imports = extractImports(content);

      for (const statement of imports) {
        if (!statement.specifier.startsWith(".")) {
          continue;
        }
        const target = resolveRelativeImport(file, statement.specifier);
        if (target !== "src/core/state") {
          continue;
        }

        if (isAllowed(file, normalized.allowImportFromCoreRootState)) {
          continue;
        }

        violations.push({
          ruleId: "ARC011",
          ruleName: "core-root-state-imports",
          severity: "error",
          file,
          message: "core-root state facade import is banned outside src/core/state/** (use src/core/state/index or public)",
          suggestion: "Replace imports from ../state.js or ../../state.js with ../state/index.js",
        });
      }
    }

    return violations;
  },
};
