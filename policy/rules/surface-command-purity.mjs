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

function isCommandModule(file) {
  return file.includes("/commands/");
}

export const rule = {
  id: "ARC005",
  name: "surface-command-purity",
  description: "Surface command modules should not do IO or depend on browser infra directly",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      const content = helpers.readFile(file);
      const specifiers = extractModuleSpecifiers(content);

      const forbidNode = isCommandModule(file);
      for (const specifier of specifiers) {
        if (specifier === "playwright-core") {
          violations.push({
            ruleId: "ARC005",
            ruleName: "surface-command-purity",
            severity: "error",
            file,
            message: 'features must not import "playwright-core" (keep browser infra in src/core/**)',
            suggestion: "Move browser integration behind core boundaries and call it from the surface",
          });
          continue;
        }

        if (forbidNode && specifier.startsWith("node:")) {
          violations.push({
            ruleId: "ARC005",
            ruleName: "surface-command-purity",
            severity: "error",
            file,
            message: `command module must not import Node builtins directly (${specifier})`,
            suggestion: "Move IO behind core boundaries and keep command modules as parse/dispatch only",
          });
        }
      }
    }

    return violations;
  },
};

