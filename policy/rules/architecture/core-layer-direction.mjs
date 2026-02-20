import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/core/**/app/**/*.ts", "src/core/**/domain/**/*.ts", "src/core/**/infra/**/*.ts"],
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

function layerInfo(file) {
  const match = /^src\/core\/([^/]+)\/(app|domain|infra)\//.exec(file);
  if (!match) {
    return null;
  }
  return {
    domain: match[1],
    layer: match[2],
  };
}

function isAllowlisted(opts) {
  const tokens = [`${opts.file}::${opts.specifier}`, `${opts.file}->${opts.target}`];
  return opts.allowlist.some((pattern) => tokens.some((token) => path.matchesGlob(token, pattern)));
}

function violatesDirection(opts) {
  if (opts.sourceLayer === "domain") {
    return opts.targetLayer !== "domain";
  }
  if (opts.sourceLayer === "app") {
    return opts.targetLayer === "infra";
  }
  return false;
}

export const rule = {
  id: "ARC013",
  name: "core-layer-direction",
  description: "Core layer imports must follow direction: app/domain stay inward; app must not import infra",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      const source = layerInfo(file);
      if (!source) {
        continue;
      }

      const content = helpers.readFile(file);
      const specifiers = extractModuleSpecifiers(content);

      for (const specifier of specifiers) {
        if (!specifier.startsWith(".")) {
          continue;
        }
        const target = normalizeImportTarget(resolveRelativeImport(file, specifier));
        const targetInfo = layerInfo(target);
        if (!targetInfo || targetInfo.domain !== source.domain) {
          continue;
        }
        if (!violatesDirection({ sourceLayer: source.layer, targetLayer: targetInfo.layer })) {
          continue;
        }
        if (isAllowlisted({ file, specifier, target, allowlist: normalized.allowlist })) {
          continue;
        }

        violations.push({
          ruleId: "ARC013",
          ruleName: "core-layer-direction",
          severity: "error",
          file,
          message: `core ${source.domain} ${source.layer} layer must not import ${targetInfo.layer} layer (${specifier})`,
          suggestion: "Move IO/adapters to infra and expose app/domain-facing entrypoints; keep app/domain inward-facing",
        });
      }
    }

    return violations;
  },
};
