import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/core/**/domain/**/*.ts"],
  exclude: [],
  allowImportPrefixes: ["src/core/types", "src/core/shared", "src/core/contracts"],
};

function normalizeOptions(options) {
  const merged = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
  };
  return {
    include: Array.isArray(merged.include) ? merged.include : DEFAULT_OPTIONS.include,
    exclude: Array.isArray(merged.exclude) ? merged.exclude : DEFAULT_OPTIONS.exclude,
    allowImportPrefixes: Array.isArray(merged.allowImportPrefixes)
      ? merged.allowImportPrefixes
      : DEFAULT_OPTIONS.allowImportPrefixes,
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

function sourceDomain(file) {
  const match = /^src\/core\/([^/]+)\/domain\//.exec(file);
  return match ? match[1] : null;
}

function resolveRelativeImport(file, specifier) {
  const baseDir = path.posix.dirname(file);
  return path.posix.normalize(path.posix.join(baseDir, specifier));
}

function normalizeImportTarget(resolved) {
  return resolved.replace(/\.(c|m)?(j|t)sx?$/i, "");
}

function isAllowedPrefix(targetPath, allowPrefixes) {
  return allowPrefixes.some((prefix) => targetPath === prefix || targetPath.startsWith(`${prefix}/`));
}

export const rule = {
  id: "ARC006",
  name: "domain-no-cross-domain",
  description: "Domain layer must not import other bounded contexts (except base/shared layers)",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      const domain = sourceDomain(file);
      if (!domain) {
        continue;
      }
      const content = helpers.readFile(file);
      const specifiers = extractModuleSpecifiers(content);

      for (const specifier of specifiers) {
        if (!specifier.startsWith(".")) {
          continue;
        }
        const resolved = normalizeImportTarget(resolveRelativeImport(file, specifier));
        if (!resolved.startsWith("src/core/")) {
          continue;
        }
        const match = /^src\/core\/([^/]+)\//.exec(`${resolved}/`);
        const targetDomain = match ? match[1] : null;
        if (!targetDomain || targetDomain === domain) {
          continue;
        }
        if (isAllowedPrefix(resolved, normalized.allowImportPrefixes)) {
          continue;
        }
        violations.push({
          ruleId: "ARC006",
          ruleName: "domain-no-cross-domain",
          severity: "error",
          file,
          message: `domain layer for "${domain}" must not import other core domain internals (${specifier})`,
          suggestion: "Move shared types into src/core/types or src/core/shared, or depend on a public entrypoint from app layer",
        });
      }
    }

    return violations;
  },
};

