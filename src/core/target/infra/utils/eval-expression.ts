import { CliError } from "../../../errors.js";
import { providers } from "../../../providers/index.js";

export function parseEvalExpression(
  opts: {
    expression?: string;
    expr?: string;
    scriptFile?: string;
    mode?: "expr" | "script";
  },
  limits: { maxInlineChars: number; maxScriptFileBytes: number },
): { expression: string; evaluatorBody: string } {
  const expression = typeof opts.expression === "string" ? opts.expression : "";
  const expr = typeof opts.expr === "string" ? opts.expr : "";
  const scriptFile = typeof opts.scriptFile === "string" ? opts.scriptFile.trim() : "";
  const hasExpression = expression.trim().length > 0;
  const hasExpr = expr.trim().length > 0;
  const hasScriptFile = scriptFile.length > 0;
  const selectedCount = Number(hasExpression) + Number(hasExpr) + Number(hasScriptFile);
  if (selectedCount === 0) {
    throw new CliError("E_QUERY_INVALID", "expr, expression, or script-file is required");
  }
  if (selectedCount > 1) {
    if (hasExpression && hasScriptFile) {
      throw new CliError("E_QUERY_INVALID", "choose either expression/js/script or script-file");
    }
    if (hasExpr && hasScriptFile) {
      throw new CliError("E_QUERY_INVALID", "choose either expr or script-file");
    }
    throw new CliError("E_QUERY_INVALID", "choose either expr or expression/js/script");
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
    const mode = opts.mode === "expr" || opts.mode === "script" ? opts.mode : "script";
    if (mode === "expr") {
      if (scriptText.length > limits.maxInlineChars) {
        throw new CliError("E_EVAL_SCRIPT_TOO_LARGE", `script-file must be at most ${limits.maxInlineChars} characters in expr mode`);
      }
      return { expression: scriptText, evaluatorBody: `return (${scriptText});` };
    }
    return { expression: scriptText, evaluatorBody: scriptText };
  }

  if (hasExpr) {
    if (expr.length > limits.maxInlineChars) {
      throw new CliError("E_EVAL_SCRIPT_TOO_LARGE", `expr must be at most ${limits.maxInlineChars} characters`);
    }
    return { expression: expr, evaluatorBody: `return (${expr});` };
  }

  if (expression.length > limits.maxInlineChars) {
    throw new CliError("E_EVAL_SCRIPT_TOO_LARGE", `expression must be at most ${limits.maxInlineChars} characters`);
  }
  return { expression, evaluatorBody: expression };
}

