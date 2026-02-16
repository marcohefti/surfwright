import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/**/*.ts"],
  exclude: [],
  mutationBindings: [
    "allocateArtifactId",
    "allocateCaptureId",
    "allocateSessionId",
    "updateState",
    "upsertTargetState",
    "writeState",
  ],
  allowMutationImportFromState: [
    "src/core/state/repo/**/*.ts",
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
    mutationBindings: Array.isArray(merged.mutationBindings) ? merged.mutationBindings : DEFAULT_OPTIONS.mutationBindings,
    allowMutationImportFromState: Array.isArray(merged.allowMutationImportFromState)
      ? merged.allowMutationImportFromState
      : DEFAULT_OPTIONS.allowMutationImportFromState,
  };
}

function extractImports(content) {
  const out = [];
  const pattern = /^\s*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/gm;
  let match;
  while ((match = pattern.exec(content)) !== null) {
    const clause = match[1];
    const specifier = match[2];
    if (typeof clause === "string" && typeof specifier === "string") {
      out.push({ clause: clause.trim(), specifier });
    }
  }
  return out;
}

function parseNamedBindings(clause) {
  const named = [];

  const braceStart = clause.indexOf("{");
  const braceEnd = clause.indexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    const body = clause.slice(braceStart + 1, braceEnd);
    for (const token of body.split(",")) {
      const part = token.trim();
      if (!part) {
        continue;
      }
      const [left] = part.split(/\s+as\s+/i);
      if (left && left.trim().length > 0) {
        named.push(left.trim());
      }
    }
  }

  const trimmed = clause.trim();
  const hasNamespace = trimmed.startsWith("*") || trimmed.includes(", * as ");
  const hasDefault =
    (braceStart === -1 && !trimmed.startsWith("*")) ||
    (braceStart > 0 && trimmed.slice(0, braceStart).replace(/,$/, "").trim().length > 0);

  return {
    named,
    hasNamespace,
    hasDefault,
  };
}

function resolveRelativeImport(file, specifier) {
  const baseDir = path.posix.dirname(file);
  return path.posix.normalize(path.posix.join(baseDir, specifier)).replace(/\.(c|m)?(j|t)sx?$/i, "");
}

function isAllowed(file, allowPatterns) {
  return allowPatterns.some((pattern) => path.posix.matchesGlob(file, pattern));
}

export const rule = {
  id: "ARC003",
  name: "state-boundaries",
  description: "State mutation primitives must be imported only from approved state repo boundaries",
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
        if (target !== "src/core/state" && target !== "src/core/state/infra/state-store") {
          continue;
        }

        const parsed = parseNamedBindings(statement.clause);
        const importedMutations = parsed.named.filter((name) => normalized.mutationBindings.includes(name));
        const hasUnsafeWildcard = parsed.hasNamespace || parsed.hasDefault;
        if (importedMutations.length === 0 && !hasUnsafeWildcard) {
          continue;
        }

        if (isAllowed(file, normalized.allowMutationImportFromState)) {
          continue;
        }

        violations.push({
          ruleId: "ARC003",
          ruleName: "state-boundaries",
          severity: "error",
          file,
          message:
            importedMutations.length > 0
              ? `direct state mutation import(s) from state store are restricted: ${importedMutations.join(", ")}`
              : "default/namespace import from state store is restricted outside approved mutation boundaries",
          suggestion: "Move state writes behind src/core/state/repo/* and import repo functions instead",
        });
      }
    }

    return violations;
  },
};
