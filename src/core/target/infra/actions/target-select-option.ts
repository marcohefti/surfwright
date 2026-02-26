import { chromium } from "playwright-core";
import { newActionId } from "../../../action-id.js";
import { CliError } from "../../../errors.js";
import { nowIso, saveTargetSnapshot } from "../../../state/index.js";
import { ensureValidSelector, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import { evaluateActionAssertions, parseActionAssertions } from "../../../shared/index.js";
import { buildActionProofEnvelope, toActionWaitEvidence } from "../../../shared/index.js";
import type { TargetSelectOptionReport } from "../../../types.js";
import { connectSessionBrowser } from "../../../session/infra/runtime-access.js";

type ParsedSelection =
  | { selectedBy: "value"; value: string }
  | { selectedBy: "label"; label: string }
  | { selectedBy: "index"; index: number };

function parseRequiredSelector(input: string | undefined): string {
  const selector = typeof input === "string" ? input.trim() : "";
  if (selector.length === 0) {
    throw new CliError("E_QUERY_INVALID", "selector is required");
  }
  return selector;
}

function parseSelection(opts: {
  value?: string;
  label?: string;
  optionIndex?: number;
}): ParsedSelection {
  const value = typeof opts.value === "string" ? opts.value : undefined;
  const label = typeof opts.label === "string" ? opts.label : undefined;
  const optionIndex = opts.optionIndex;
  const hasIndex = typeof optionIndex === "number";
  const selected = Number(typeof value === "string") + Number(typeof label === "string") + Number(hasIndex);
  if (selected !== 1) {
    throw new CliError("E_QUERY_INVALID", "Provide exactly one selection mode: --value, --label, or --option-index");
  }
  if (typeof value === "string") {
    return { selectedBy: "value", value };
  }
  if (typeof label === "string") {
    return { selectedBy: "label", label };
  }
  if (!hasIndex || !Number.isInteger(optionIndex) || optionIndex < 0) {
    throw new CliError("E_QUERY_INVALID", "option-index must be a non-negative integer");
  }
  return { selectedBy: "index", index: optionIndex };
}

export async function targetSelectOption(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  selectorQuery?: string;
  value?: string;
  label?: string;
  optionIndex?: number;
  proof?: boolean;
  assertUrlPrefix?: string;
  assertSelector?: string;
  assertText?: string;
}): Promise<TargetSelectOptionReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const selector = parseRequiredSelector(opts.selectorQuery);
  const selection = parseSelection({
    value: opts.value,
    label: opts.label,
    optionIndex: opts.optionIndex,
  });
  const includeProof = Boolean(opts.proof);
  const parsedAssertions = parseActionAssertions({
    assertUrlPrefix: opts.assertUrlPrefix,
    assertSelector: opts.assertSelector,
    assertText: opts.assertText,
  });

  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await connectSessionBrowser(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    await ensureValidSelector(target.page, selector);
    const locator = target.page.locator(selector).first();
    const matchCount = await target.page.locator(selector).count();
    if (matchCount < 1) {
      throw new CliError("E_QUERY_INVALID", `No element matched selector: ${selector}`);
    }

    const isSelect = await locator.evaluate((node) => {
      const tagName = typeof (node as { tagName?: string })?.tagName === "string"
        ? ((node as { tagName: string }).tagName.toLowerCase())
        : "";
      return tagName === "select";
    });
    if (!isSelect) {
      throw new CliError("E_QUERY_INVALID", `selector did not match a <select> element: ${selector}`);
    }

    const urlBeforeAction = target.page.url();
    if (selection.selectedBy === "value") {
      await locator.selectOption({ value: selection.value }, { timeout: opts.timeoutMs });
    } else if (selection.selectedBy === "label") {
      await locator.selectOption({ label: selection.label }, { timeout: opts.timeoutMs });
    } else {
      const optionValue = await locator.evaluate((node, index) => {
        const element = node as { options?: ArrayLike<{ value?: string }> };
        const options = element.options ?? null;
        const length = Number(options?.length ?? 0);
        if (index < 0 || index >= length) {
          return null;
        }
        const value = options?.[index]?.value;
        return typeof value === "string" ? value : null;
      }, selection.index);
      if (typeof optionValue !== "string") {
        throw new CliError("E_QUERY_INVALID", `option-index out of range: ${selection.index}`);
      }
      await locator.selectOption({ value: optionValue }, { timeout: opts.timeoutMs });
    }

    const selected = await locator.evaluate((node) => {
      const element = node as {
        selectedOptions?: ArrayLike<{ value?: string; textContent?: string | null; index?: number }>;
      };
      const first = element.selectedOptions?.[0];
      if (!first) {
        return {
          selectedValue: null,
          selectedText: null,
          selectedIndex: null,
        };
      }
      return {
        selectedValue: typeof first.value === "string" ? first.value : null,
        selectedText: typeof first.textContent === "string" ? first.textContent.trim() : null,
        selectedIndex: typeof first.index === "number" ? first.index : null,
      };
    });

    const finalUrl = target.page.url();
    const assertions = await evaluateActionAssertions({
      page: target.page,
      assertions: parsedAssertions,
    });
    const finalTitle = await target.page.title();
    const actionCompletedAt = Date.now();
    const proofEnvelope = includeProof
      ? buildActionProofEnvelope({
          action: "select-option",
          urlBefore: urlBeforeAction,
          urlAfter: finalUrl,
          targetBefore: requestedTargetId,
          targetAfter: requestedTargetId,
          matchCount,
          pickedIndex: 0,
          wait: toActionWaitEvidence({
            requested: null,
            observed: null,
          }),
          assertions,
          countAfter: null,
          details: {
            selector,
            selectedBy: selection.selectedBy,
            selectedValue: selected.selectedValue,
            selectedText: selected.selectedText,
            selectedIndex: selected.selectedIndex,
          },
        })
      : null;

    const report: TargetSelectOptionReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      selector,
      selectedBy: selection.selectedBy,
      selectedValue: selected.selectedValue,
      selectedText: selected.selectedText,
      selectedIndex: selected.selectedIndex,
      url: finalUrl,
      title: finalTitle,
      ...(includeProof
        ? {
            proof: {
              action: "select-option",
              selectedBy: selection.selectedBy,
              selectedValue: selected.selectedValue,
              selectedText: selected.selectedText,
              selectedIndex: selected.selectedIndex,
              finalUrl,
            },
          }
        : {}),
      ...(proofEnvelope ? { proofEnvelope } : {}),
      ...(assertions ? { assertions } : {}),
      timingMs: {
        total: 0,
        resolveSession: resolvedSessionAt - startedAt,
        connectCdp: connectedAt - resolvedSessionAt,
        action: actionCompletedAt - connectedAt,
        persistState: 0,
      },
    };

    const persistStartedAt = Date.now();
    if (opts.persistState !== false) {
      await saveTargetSnapshot({
        targetId: report.targetId,
        sessionId: report.sessionId,
        url: report.url,
        title: report.title,
        status: null,
        lastActionId: report.actionId,
        lastActionAt: nowIso(),
        lastActionKind: "select-option",
        updatedAt: nowIso(),
      });
    }
    const persistedAt = Date.now();
    report.timingMs.persistState = persistedAt - persistStartedAt;
    report.timingMs.total = persistedAt - startedAt;
    return report;
  } finally {
    await browser.close();
  }
}
