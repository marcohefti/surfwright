import path from "node:path";

const DEFAULT_OPTIONS = {
  include: ["src/features/**/commands/**/*.ts"],
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

function findOptionCallSpans(content) {
  const spans = [];
  const needle = ".option(";

  let i = 0;
  while (i < content.length) {
    const start = content.indexOf(needle, i);
    if (start === -1) {
      break;
    }

    const openParen = start + needle.length - 1;
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inTemplate = false;
    let escaped = false;

    let j = openParen;
    for (; j < content.length; j += 1) {
      const ch = content[j];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\\\") {
        escaped = true;
        continue;
      }

      if (inSingle) {
        if (ch === "'") {
          inSingle = false;
        }
        continue;
      }
      if (inDouble) {
        if (ch === '"') {
          inDouble = false;
        }
        continue;
      }
      if (inTemplate) {
        if (ch === "`") {
          inTemplate = false;
        }
        continue;
      }

      if (ch === "'") {
        inSingle = true;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        continue;
      }
      if (ch === "`") {
        inTemplate = true;
        continue;
      }

      if (ch === "(") {
        depth += 1;
        continue;
      }
      if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          spans.push({ start, end: j + 1 });
          break;
        }
      }
    }

    i = j > start ? j : start + needle.length;
  }

  return spans;
}

function hasNegatedBooleanDefaultFalse(callText) {
  if (!/\.option\(\s*["']--no-[^"']+["']/.test(callText)) {
    return false;
  }

  // Commander already implies the default for --no-* is true, and sets the *positive*
  // property name (e.g. `options.persist`). Passing a default value is a footgun.
  const trimmed = callText.trim().replace(/\s+/g, " ");
  return /,\s*false\s*\)$/.test(trimmed);
}

function findNoXReads(content) {
  return content.match(/\boptions\.no[A-Z][A-Za-z0-9_]*\b/g) ?? [];
}

export const rule = {
  id: "CLI001",
  name: "cli-commander-options",
  description: "Reject Commander negated-boolean footguns in command modules",
  defaultOptions: DEFAULT_OPTIONS,
  check: async ({ files, options, helpers }) => {
    const normalized = normalizeOptions(options);
    const selected = helpers.filterFiles(files, normalized.include, normalized.exclude);
    const violations = [];

    for (const file of selected) {
      const normalizedPath = file.replace(/\\/g, "/");
      const content = helpers.readFile(file);

      for (const span of findOptionCallSpans(content)) {
        const callText = content.slice(span.start, span.end);
        if (!hasNegatedBooleanDefaultFalse(callText)) {
          continue;
        }

        violations.push({
          ruleId: "CLI001",
          ruleName: "cli-commander-options",
          severity: "error",
          file: path.posix.normalize(normalizedPath),
          message: 'Commander .option("--no-*", ..., false) is a footgun and must not be used',
          suggestion: 'Remove the explicit default value (Commander already handles --no- flags); read the positive option name',
        });
      }

      const noXReads = findNoXReads(content);
      if (noXReads.length > 0) {
        violations.push({
          ruleId: "CLI001",
          ruleName: "cli-commander-options",
          severity: "error",
          file: path.posix.normalize(normalizedPath),
          message: `Commander negated options must not be read as "options.noX" (${noXReads[0]}...)`,
          suggestion: "Read the positive property name (e.g. `options.persist`, `options.touch`) and treat omitted flags as undefined when needed",
        });
      }
    }

    return violations;
  },
};
