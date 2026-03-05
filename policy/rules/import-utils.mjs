const KNOWN_SOURCE_EXTENSIONS = [".cts", ".mts", ".tsx", ".ts", ".cjs", ".mjs", ".jsx", ".js"];

function normalizeStatementWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function readQuotedSpecifier(value) {
  const singleQuoteIndex = value.indexOf("'");
  const doubleQuoteIndex = value.indexOf("\"");
  if (singleQuoteIndex < 0 && doubleQuoteIndex < 0) {
    return null;
  }

  const useSingleQuote = singleQuoteIndex >= 0 && (doubleQuoteIndex < 0 || singleQuoteIndex < doubleQuoteIndex);
  const quote = useSingleQuote ? "'" : "\"";
  const start = useSingleQuote ? singleQuoteIndex : doubleQuoteIndex;
  const end = value.indexOf(quote, start + 1);
  if (end <= start + 1) {
    return null;
  }
  return value.slice(start + 1, end);
}

function splitStatements(content) {
  return String(content ?? "")
    .split(";")
    .map((entry) => normalizeStatementWhitespace(entry))
    .filter((entry) => entry.length > 0);
}

function parseImportExportStatement(statement) {
  if (!statement.startsWith("import ") && !statement.startsWith("export ")) {
    return null;
  }

  const fromIndex = statement.lastIndexOf(" from ");
  if (fromIndex >= 0) {
    const prefix = statement.slice(0, fromIndex);
    const source = statement.slice(fromIndex + 6);
    const specifier = readQuotedSpecifier(source);
    if (!specifier) {
      return null;
    }
    if (statement.startsWith("import ")) {
      return {
        clause: prefix.slice("import ".length).trim(),
        specifier,
      };
    }
    return {
      clause: null,
      specifier,
    };
  }

  if (statement.startsWith("import ")) {
    const specifier = readQuotedSpecifier(statement.slice("import ".length));
    if (!specifier) {
      return null;
    }
    return {
      clause: "",
      specifier,
    };
  }

  return null;
}

export function extractModuleSpecifiers(content) {
  const out = [];
  for (const statement of splitStatements(content)) {
    const parsed = parseImportExportStatement(statement);
    if (parsed?.specifier) {
      out.push(parsed.specifier);
    }
  }
  return out;
}

export function extractImportsWithClauses(content) {
  const out = [];
  for (const statement of splitStatements(content)) {
    const parsed = parseImportExportStatement(statement);
    if (typeof parsed?.clause === "string" && parsed.specifier) {
      out.push({
        clause: parsed.clause,
        specifier: parsed.specifier,
      });
    }
  }
  return out;
}

export function stripKnownSourceExtension(resolvedPath) {
  const lower = resolvedPath.toLowerCase();
  for (const extension of KNOWN_SOURCE_EXTENSIONS) {
    if (lower.endsWith(extension)) {
      return resolvedPath.slice(0, -extension.length);
    }
  }
  return resolvedPath;
}
