import path from "node:path";
import ts from "typescript";

const DEFAULT_OPTIONS = {
  include: ["src/**/*.ts"],
  exclude: [],
  allowlist: [],
};

function normalizeOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  return {
    include: Array.isArray(merged.include) ? merged.include : DEFAULT_OPTIONS.include,
    exclude: Array.isArray(merged.exclude) ? merged.exclude : DEFAULT_OPTIONS.exclude,
    allowlist: Array.isArray(merged.allowlist) ? merged.allowlist : DEFAULT_OPTIONS.allowlist,
  };
}

function matchesAny(file, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => path.matchesGlob(file, pattern));
}

function collectExplicitAnyDiagnostics(content, file) {
  const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let count = 0;
  let firstLine = null;
  let firstColumn = null;

  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      count += 1;
      if (firstLine === null || firstColumn === null) {
        const lc = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        firstLine = lc.line + 1;
        firstColumn = lc.character + 1;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return {
    count,
    firstLine,
    firstColumn,
  };
}

export const rule = {
  id: "TS001",
  name: "typescript-no-explicit-any",
  description: "Disallow explicit TypeScript `any` type usage",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      if (matchesAny(file, normalized.allowlist)) {
        continue;
      }
      const content = helpers.readFile(file);
      const diag = collectExplicitAnyDiagnostics(content, file);
      if (diag.count === 0) {
        continue;
      }
      const location =
        typeof diag.firstLine === "number" && typeof diag.firstColumn === "number"
          ? `first at ${diag.firstLine}:${diag.firstColumn}`
          : "location unknown";
      violations.push({
        ruleId: "TS001",
        ruleName: "typescript-no-explicit-any",
        severity: "error",
        file,
        message: `Explicit \`any\` is forbidden (${diag.count} occurrence(s), ${location})`,
        suggestion: "Replace `any` with concrete types, generics, or `unknown` plus narrowing",
      });
    }

    return violations;
  },
};
