import { CliError } from "../../../errors.js";
import { providers } from "../../../providers/index.js";

export function parseEvalExpression(
  opts: {
    expression?: string;
    expr?: string;
    scriptFile?: string;
    exprB64?: string;
    scriptB64?: string;
    mode?: "expr" | "script";
  },
  limits: { maxInlineChars: number; maxScriptFileBytes: number },
): { expression: string; evaluatorBody: string } {
  const stripTrailingEquals = (input: string): string => {
    let end = input.length;
    while (end > 0 && input.charCodeAt(end - 1) === 61) {
      end -= 1;
    }
    return input.slice(0, end);
  };
  const hasUnsafeControlChars = (input: string): boolean => {
    for (let idx = 0; idx < input.length; idx += 1) {
      const code = input.charCodeAt(idx);
      if (code === 9 || code === 10 || code === 13) {
        continue;
      }
      if (code < 32 || code === 127) {
        return true;
      }
    }
    return false;
  };
  const enforceEvalGuardrails = (sourceText: string, sourceLabel: string): void => {
    if (hasUnsafeControlChars(sourceText)) {
      throw new CliError("E_QUERY_INVALID", `${sourceLabel} contains unsupported control characters`);
    }
  };
  const ensureEvaluable = (evaluatorBody: string, sourceLabel: string) => {
    enforceEvalGuardrails(evaluatorBody, sourceLabel);
    try {
      // Fail fast before browser/session work when JS syntax is invalid.
      // This is an explicit trust boundary before dynamic compilation.
      new Function("arg", evaluatorBody);
    } catch {
      throw new CliError("E_QUERY_INVALID", `${sourceLabel} contains invalid JavaScript syntax`);
    }
  };
  const parseBase64Source = (
    input: string,
    sourceLabel: "expr-b64" | "script-b64",
  ): { text: string; decodedBytes: number } => {
    const normalized = input.trim();
    if (normalized.length === 0) {
      throw new CliError("E_QUERY_INVALID", `${sourceLabel} must be non-empty base64 text`);
    }
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
      throw new CliError("E_QUERY_INVALID", `${sourceLabel} must be valid base64`);
    }
    let decoded: Buffer;
    try {
      decoded = Buffer.from(normalized, "base64");
    } catch {
      throw new CliError("E_QUERY_INVALID", `${sourceLabel} must be valid base64`);
    }
    const canonical = decoded.toString("base64");
    if (stripTrailingEquals(canonical) !== stripTrailingEquals(normalized)) {
      throw new CliError("E_QUERY_INVALID", `${sourceLabel} must be valid base64`);
    }
    const text = decoded.toString("utf8");
    if (text.trim().length === 0) {
      throw new CliError("E_QUERY_INVALID", `${sourceLabel} decodes to empty JavaScript`);
    }
    enforceEvalGuardrails(text, sourceLabel);
    return { text, decodedBytes: decoded.length };
  };

  const expression = typeof opts.expression === "string" ? opts.expression : "";
  const expr = typeof opts.expr === "string" ? opts.expr : "";
  const scriptFile = typeof opts.scriptFile === "string" ? opts.scriptFile.trim() : "";
  const exprB64 = typeof opts.exprB64 === "string" ? opts.exprB64 : "";
  const scriptB64 = typeof opts.scriptB64 === "string" ? opts.scriptB64 : "";
  const hasExpression = expression.trim().length > 0;
  const hasExpr = expr.trim().length > 0;
  const hasScriptFile = scriptFile.length > 0;
  const hasExprB64 = exprB64.trim().length > 0;
  const hasScriptB64 = scriptB64.trim().length > 0;
  const selectedCount = Number(hasExpression) + Number(hasExpr) + Number(hasScriptFile) + Number(hasExprB64) + Number(hasScriptB64);
  if (selectedCount === 0) {
    throw new CliError("E_QUERY_INVALID", "expr, expr-b64, expression, script-file, or script-b64 is required");
  }
  if (selectedCount > 1) {
    throw new CliError("E_QUERY_INVALID", "choose exactly one of expr, expr-b64, expression, script-file, or script-b64");
  }

  if (hasScriptFile) {
    const { fs } = providers();
    let stat: { isFile(): boolean; size: number };
    try {
      stat = fs.statSync(scriptFile);
    } catch {
      throw new CliError("E_QUERY_INVALID", "script-file is not readable");
    }
    if (!stat.isFile()) {
      throw new CliError("E_QUERY_INVALID", "script-file must point to a file");
    }
    if (stat.size > limits.maxScriptFileBytes) {
      throw new CliError("E_EVAL_SCRIPT_TOO_LARGE", `script-file must be at most ${limits.maxScriptFileBytes} bytes`);
    }
    let scriptText: string;
    try {
      scriptText = fs.readFileSync(scriptFile, "utf8");
    } catch {
      throw new CliError("E_QUERY_INVALID", "script-file is not readable");
    }
    if (scriptText.trim().length === 0) {
      throw new CliError("E_QUERY_INVALID", "script-file is empty");
    }
    enforceEvalGuardrails(scriptText, "script-file");
    const mode = opts.mode === "expr" || opts.mode === "script" ? opts.mode : "script";
    if (mode === "expr") {
      if (scriptText.length > limits.maxInlineChars) {
        throw new CliError("E_EVAL_SCRIPT_TOO_LARGE", `script-file must be at most ${limits.maxInlineChars} characters in expr mode`);
      }
      const evaluatorBody = `return (${scriptText});`;
      ensureEvaluable(evaluatorBody, "script-file");
      return { expression: scriptText, evaluatorBody };
    }
    ensureEvaluable(scriptText, "script-file");
    return { expression: scriptText, evaluatorBody: scriptText };
  }

  if (hasScriptB64) {
    const decoded = parseBase64Source(scriptB64, "script-b64");
    if (decoded.decodedBytes > limits.maxScriptFileBytes) {
      throw new CliError("E_EVAL_SCRIPT_TOO_LARGE", `script-b64 must decode to at most ${limits.maxScriptFileBytes} bytes`);
    }
    const mode = opts.mode === "expr" || opts.mode === "script" ? opts.mode : "script";
    if (mode === "expr") {
      if (decoded.text.length > limits.maxInlineChars) {
        throw new CliError("E_EVAL_SCRIPT_TOO_LARGE", `script-b64 must decode to at most ${limits.maxInlineChars} characters in expr mode`);
      }
      const evaluatorBody = `return (${decoded.text});`;
      ensureEvaluable(evaluatorBody, "script-b64");
      return { expression: decoded.text, evaluatorBody };
    }
    ensureEvaluable(decoded.text, "script-b64");
    return { expression: decoded.text, evaluatorBody: decoded.text };
  }

  if (hasExprB64) {
    const decoded = parseBase64Source(exprB64, "expr-b64");
    if (decoded.text.length > limits.maxInlineChars) {
      throw new CliError("E_EVAL_SCRIPT_TOO_LARGE", `expr-b64 must decode to at most ${limits.maxInlineChars} characters`);
    }
    const evaluatorBody = `return (${decoded.text});`;
    ensureEvaluable(evaluatorBody, "expr-b64");
    return { expression: decoded.text, evaluatorBody };
  }

  if (hasExpr) {
    if (expr.length > limits.maxInlineChars) {
      throw new CliError("E_EVAL_SCRIPT_TOO_LARGE", `expr must be at most ${limits.maxInlineChars} characters`);
    }
    enforceEvalGuardrails(expr, "expr");
    const evaluatorBody = `return (${expr});`;
    ensureEvaluable(evaluatorBody, "expr");
    return { expression: expr, evaluatorBody };
  }

  if (expression.length > limits.maxInlineChars) {
    throw new CliError("E_EVAL_SCRIPT_TOO_LARGE", `expression must be at most ${limits.maxInlineChars} characters`);
  }
  enforceEvalGuardrails(expression, "expression");
  ensureEvaluable(expression, "expression");
  return { expression, evaluatorBody: expression };
}
