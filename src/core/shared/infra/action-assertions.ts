import type { Page } from "playwright-core";
import { CliError } from "../../errors.js";
import type { ActionAssertionCheck, ActionAssertionReport } from "../../types.js";

export type ActionAssertionInput = {
  assertUrlPrefix?: string;
  assertSelector?: string;
  assertText?: string;
};

export type ParsedActionAssertions = {
  urlPrefix: string | null;
  selector: string | null;
  text: string | null;
};

export function parseActionAssertions(input: ActionAssertionInput): ParsedActionAssertions {
  const urlPrefix = typeof input.assertUrlPrefix === "string" ? input.assertUrlPrefix.trim() : "";
  const selector = typeof input.assertSelector === "string" ? input.assertSelector.trim() : "";
  const text = typeof input.assertText === "string" ? input.assertText.trim() : "";

  return {
    urlPrefix: urlPrefix.length > 0 ? urlPrefix : null,
    selector: selector.length > 0 ? selector : null,
    text: text.length > 0 ? text : null,
  };
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

async function checkSelectorVisible(page: Page, selector: string): Promise<boolean> {
  try {
    const locator = page.locator(selector).first();
    return await locator.isVisible();
  } catch {
    throw new CliError("E_SELECTOR_INVALID", `Invalid selector query: ${selector}`);
  }
}

export async function evaluateActionAssertions(opts: {
  page: Page;
  assertions: ParsedActionAssertions;
}): Promise<ActionAssertionReport | null> {
  const checks: ActionAssertionCheck[] = [];
  const { assertions, page } = opts;

  if (assertions.urlPrefix) {
    const actual = page.url();
    checks.push({
      id: "url-prefix",
      ok: actual.startsWith(assertions.urlPrefix),
      expected: assertions.urlPrefix,
      actual,
    });
  }

  if (assertions.selector) {
    const visible = await checkSelectorVisible(page, assertions.selector);
    checks.push({
      id: "selector",
      ok: visible,
      expected: assertions.selector,
      actual: visible ? "visible" : "not-visible",
    });
  }

  if (assertions.text) {
    const actualBodyText = await page.evaluate(() => {
      const runtime = globalThis as unknown as { document?: { body?: { innerText?: string } } };
      return String(runtime.document?.body?.innerText ?? "");
    });
    const matched = normalizeText(actualBodyText).includes(normalizeText(assertions.text ?? ""));
    checks.push({
      id: "text",
      ok: matched,
      expected: assertions.text,
      actual: matched ? "present" : "missing",
    });
  }

  if (checks.length === 0) {
    return null;
  }

  const failed = checks.filter((entry) => !entry.ok).length;
  if (failed > 0) {
    const firstFailed = checks.find((entry) => !entry.ok) ?? checks[0];
    throw new CliError("E_ASSERT_FAILED", `assertion failed: ${firstFailed.id}`, {
      hints: [
        "Retry with a narrower assertion target",
        "Use target snapshot/read/eval to inspect page state before asserting",
      ],
      hintContext: {
        assertionId: firstFailed.id,
        expected: firstFailed.expected,
        actual: firstFailed.actual,
      },
    });
  }

  return {
    total: checks.length,
    failed,
    checks,
  };
}
