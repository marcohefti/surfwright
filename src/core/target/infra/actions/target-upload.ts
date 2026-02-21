import { chromium } from "playwright-core";
import { newActionId } from "../../../action-id.js";
import { CliError } from "../../../errors.js";
import { nowIso, saveTargetSnapshot } from "../../../state/index.js";
import { providers } from "../../../providers/index.js";
import { ensureValidSelector, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import { parseWaitAfterClick, resolveWaitTimeoutMs, waitAfterClick, waitTimeoutError } from "../../click/click-utils.js";
import { evaluateActionAssertions, parseActionAssertions } from "../../../shared/index.js";
import { buildActionProofEnvelope, toActionWaitEvidence } from "../../../shared/index.js";
import type { BrowserNodeLike } from "../types/browser-dom-types.js";
import {
  deriveResultSource,
  escapeRegexLiteral,
  parseOptionalRegex,
  parseOptionalTrimmedString,
  readBodyTextBestEffort,
  readSelectorTextBestEffort,
  resolveUploadedFilenameFromEvidence,
  waitTimedOut,
  type UploadResultVerification,
} from "./target-upload-result.js";

type TargetUploadReport = {
  ok: true;
  sessionId: string;
  sessionSource?: "explicit" | "target-inferred" | "implicit-new";
  targetId: string;
  actionId: string;
  selector: string;
  files: Array<{
    name: string;
    size: number;
    type: string;
  }>;
  fileCount: number;
  mode: "direct-input" | "filechooser";
  submitSelector: string | null;
  submitted: boolean;
  uploadedFilename: string | null;
  uploadVerified: boolean;
  matchedResultText: string | null;
  resultVerification: UploadResultVerification | null;
  proof?: {
    action: "upload";
    urlChanged: boolean;
    waitSatisfied: boolean;
    finalUrl: string;
    finalTitle: string;
    queryMode: "selector";
    query: string;
    selector: string;
    countAfter: null;
  };
  proofEnvelope?: import("../../../types.js").ActionProofEnvelope;
  assertions?: import("../../../types.js").ActionAssertionReport | null;
  wait?: {
    mode: "text" | "selector" | "network-idle";
    value: string | null;
    timeoutMs: number;
    elapsedMs: number;
    satisfied: boolean;
  } | null;
  timingMs: {
    total: number;
    resolveSession: number;
    connectCdp: number;
    action: number;
    persistState: number;
  };
};

function parseRequiredSelector(input: string | undefined, optionName: string): string {
  const selector = typeof input === "string" ? input.trim() : "";
  if (selector.length === 0) {
    throw new CliError("E_QUERY_INVALID", `${optionName} selector is required`);
  }
  return selector;
}

function mimeFromName(name: string): string {
  const ext = providers().path.extname(name).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".json") return "application/json";
  if (ext === ".txt") return "text/plain";
  if (ext === ".csv") return "text/csv";
  return "application/octet-stream";
}

function parseOptionalExpectedFilename(input: string | undefined): string | null {
  if (typeof input !== "string") {
    return null;
  }
  const value = input.trim();
  if (value.length < 1) {
    return null;
  }
  return providers().path.basename(value);
}

function parseUploadFiles(input: string | string[] | undefined): Array<{ absolutePath: string; name: string; size: number; type: string }> {
  const { fs, path } = providers();
  const raw = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  const files = raw.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  if (files.length === 0) {
    throw new CliError("E_QUERY_INVALID", "Provide at least one --file <path>");
  }

  return files.map((filePath) => {
    const absolutePath = path.resolve(filePath);
    let stat: { isFile(): boolean; size: number };
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      throw new CliError("E_QUERY_INVALID", `file is not readable: ${filePath}`);
    }
    if (!stat.isFile()) {
      throw new CliError("E_QUERY_INVALID", `file must point to a regular file: ${filePath}`);
    }
    const name = path.basename(absolutePath);
    return {
      absolutePath,
      name,
      size: stat.size,
      type: mimeFromName(name),
    };
  });
}

export async function targetUpload(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  selectorQuery?: string;
  files?: string | string[];
  submitSelector?: string;
  waitForText?: string;
  waitForSelector?: string;
  waitNetworkIdle?: boolean;
  waitTimeoutMs?: number;
  expectUploadedFilename?: string;
  waitForResult?: boolean;
  resultSelector?: string;
  resultTextContains?: string;
  resultFilenameRegex?: string;
  proof?: boolean;
  assertUrlPrefix?: string;
  assertSelector?: string;
  assertText?: string;
}): Promise<TargetUploadReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const selector = parseRequiredSelector(opts.selectorQuery, "selector");
  const submitSelector = typeof opts.submitSelector === "string" ? opts.submitSelector.trim() : "";
  const fileInputs = parseUploadFiles(opts.files);
  const waitAfter = parseWaitAfterClick({
    waitForText: opts.waitForText,
    waitForSelector: opts.waitForSelector,
    waitNetworkIdle: opts.waitNetworkIdle,
  });
  const waitTimeoutMs = resolveWaitTimeoutMs(opts.waitTimeoutMs, opts.timeoutMs);
  const includeProof = Boolean(opts.proof);
  const expectedUploadedFilename = parseOptionalExpectedFilename(opts.expectUploadedFilename);
  const waitForResult = Boolean(opts.waitForResult);
  const resultSelector = parseOptionalTrimmedString(opts.resultSelector);
  if (resultSelector) {
    parseRequiredSelector(resultSelector, "result-selector");
  }
  const resultTextContains = parseOptionalTrimmedString(opts.resultTextContains);
  const explicitFilenameRegex = parseOptionalRegex(opts.resultFilenameRegex, "result-filename-regex");
  const inferredFilenameRegex =
    explicitFilenameRegex ??
    (expectedUploadedFilename
      ? new RegExp(`\\b${escapeRegexLiteral(expectedUploadedFilename)}\\b`)
      : fileInputs.length === 1
        ? new RegExp(`\\b${escapeRegexLiteral(fileInputs[0].name)}\\b`)
        : null);
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
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    await ensureValidSelector(target.page, selector);
    const locator = target.page.locator(selector).first();
    const count = await target.page.locator(selector).count();
    if (count < 1) {
      throw new CliError("E_QUERY_INVALID", `No element matched upload selector: ${selector}`);
    }

    const absolutePaths = fileInputs.map((entry) => entry.absolutePath);
    const isFileInput = await locator.evaluate((node: BrowserNodeLike) => {
      const tagName = typeof node?.tagName === "string" ? node.tagName.toLowerCase() : "";
      const inputType = typeof node?.type === "string" ? node.type.toLowerCase() : "";
      return tagName === "input" && inputType === "file";
    });

    let mode: TargetUploadReport["mode"] = "direct-input";
    let submitted = false;
    const urlBeforeAction = target.page.url();
    if (isFileInput) {
      await locator.setInputFiles(absolutePaths, {
        timeout: opts.timeoutMs,
      });
    } else {
      mode = "filechooser";
      const chooserPromise = target.page.waitForEvent("filechooser", {
        timeout: opts.timeoutMs,
      });
      await locator.click({
        timeout: opts.timeoutMs,
      });
      let chooser: { setFiles(files: string[], options?: { timeout?: number }): Promise<void> };
      try {
        chooser = await chooserPromise;
      } catch {
        throw new CliError("E_QUERY_INVALID", "selector did not trigger a file chooser");
      }
      await chooser.setFiles(absolutePaths, {
        timeout: opts.timeoutMs,
      });
    }

    if (submitSelector.length > 0) {
      await ensureValidSelector(target.page, submitSelector);
      const submitLocator = target.page.locator(submitSelector).first();
      const submitCount = await target.page.locator(submitSelector).count();
      if (submitCount < 1) {
        throw new CliError("E_QUERY_INVALID", `No element matched submit selector: ${submitSelector}`);
      }
      await submitLocator.click({
        timeout: opts.timeoutMs,
      });
      submitted = true;
    }

    const waitStartedAt = Date.now();
    let waitedMode: { mode: "text" | "selector" | "network-idle"; value: string | null } | null;
    try {
      waitedMode = await waitAfterClick({
        page: target.page,
        waitAfter,
        timeoutMs: waitTimeoutMs,
      });
    } catch (error) {
      if (waitAfter && waitTimedOut(error)) {
        throw waitTimeoutError({
          mode: waitAfter.mode,
          value: waitAfter.value,
          timeoutMs: waitTimeoutMs,
          queryMode: "selector",
          query: selector,
          visibleOnly: false,
          frameScope: "main",
        });
      }
      throw error;
    }
    const waited =
      waitedMode === null
        ? null
        : {
            mode: waitedMode.mode,
            value: waitedMode.value,
            timeoutMs: waitTimeoutMs,
            elapsedMs: Date.now() - waitStartedAt,
            satisfied: true,
          };
    let matchedResultText =
      waited?.mode === "selector" && typeof waited.value === "string"
        ? await readSelectorTextBestEffort(target.page, waited.value, waitTimeoutMs)
        : null;
    let resultSelectorText: string | null = null;
    if (resultSelector) {
      await ensureValidSelector(target.page, resultSelector);
      const resultLocator = target.page.locator(resultSelector).first();
      if (waitForResult) {
        try {
          await resultLocator.waitFor({
            state: "visible",
            timeout: waitTimeoutMs,
          });
        } catch (error) {
          if (waitTimedOut(error)) {
            throw waitTimeoutError({
              mode: "selector",
              value: resultSelector,
              timeoutMs: waitTimeoutMs,
              queryMode: "selector",
              query: selector,
              visibleOnly: false,
              frameScope: "main",
            });
          }
          throw error;
        }
      }
      resultSelectorText = await readSelectorTextBestEffort(target.page, resultSelector, waitTimeoutMs);
      if (resultSelectorText) {
        matchedResultText = resultSelectorText;
      }
    }
    let normalizedPageText = (await readBodyTextBestEffort(target.page, Math.min(opts.timeoutMs, 5000))) ?? "";
    const verifyResultEvidence = () => {
      const selectorText = resultSelectorText ?? matchedResultText;
      const source = deriveResultSource(selectorText, normalizedPageText);
      const evidenceText = [selectorText, normalizedPageText]
        .filter((value): value is string => typeof value === "string" && value.length > 0)
        .join("\n");
      const matchedTextContains = resultTextContains ? evidenceText.includes(resultTextContains) : null;
      const matchedFilenameRegex = inferredFilenameRegex ? inferredFilenameRegex.test(evidenceText) : null;
      const uploadedFilename = resolveUploadedFilenameFromEvidence({
        fileInputs,
        expectedUploadedFilename,
        selectorText,
        bodyText: normalizedPageText,
      });
      const resultVerification: UploadResultVerification = {
        enabled: waitForResult,
        selector: resultSelector,
        textContains: resultTextContains,
        filenameRegex: inferredFilenameRegex ? inferredFilenameRegex.source : null,
        source,
        matchedTextContains,
        matchedFilenameRegex,
        satisfied: false,
      };
      const checks = [matchedTextContains, matchedFilenameRegex].filter((value) => value !== null);
      resultVerification.satisfied = checks.length > 0 ? checks.every((value) => value === true) : uploadedFilename !== null;
      return {
        uploadedFilename,
        resultVerification,
      };
    };
    let { uploadedFilename, resultVerification } = verifyResultEvidence();
    if (waitForResult) {
      const started = Date.now();
      while (!resultVerification.satisfied && Date.now() - started < waitTimeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (resultSelector) {
          resultSelectorText = await readSelectorTextBestEffort(target.page, resultSelector, 1000);
          if (resultSelectorText) {
            matchedResultText = resultSelectorText;
          }
        }
        const nextBodyText = await readBodyTextBestEffort(target.page, 1000);
        if (nextBodyText !== null) {
          normalizedPageText = nextBodyText;
        }
        ({ uploadedFilename, resultVerification } = verifyResultEvidence());
      }
      if (!resultVerification.satisfied) {
        throw waitTimeoutError({
          mode: resultSelector ? "selector" : "text",
          value: resultSelector ?? resultTextContains ?? (inferredFilenameRegex ? `regex:${inferredFilenameRegex.source}` : null),
          timeoutMs: waitTimeoutMs,
          queryMode: "selector",
          query: selector,
          visibleOnly: false,
          frameScope: "main",
        });
      }
    }
    const uploadVerified = expectedUploadedFilename ? uploadedFilename === expectedUploadedFilename : uploadedFilename !== null;
    if (expectedUploadedFilename && !uploadVerified) {
      throw new CliError("E_ASSERT_FAILED", `uploaded filename assertion failed: expected ${expectedUploadedFilename}`, {
        hintContext: {
          expectedUploadedFilename,
          observedUploadedFilename: uploadedFilename,
          matchedResultText,
        },
      });
    }
    const finalUrl = target.page.url();
    const assertions = await evaluateActionAssertions({
      page: target.page,
      assertions: parsedAssertions,
    });
    const finalTitle = await target.page.title();
    const actionCompletedAt = Date.now();
    const proofEnvelope = includeProof
      ? buildActionProofEnvelope({
          action: "upload",
          urlBefore: urlBeforeAction,
          urlAfter: finalUrl,
          targetBefore: requestedTargetId,
          targetAfter: requestedTargetId,
          matchCount: count,
          pickedIndex: 0,
          wait: toActionWaitEvidence({
            requested: waitAfter ? { ...waitAfter, timeoutMs: waitTimeoutMs } : null,
            observed: waited,
          }),
          assertions,
          countAfter: null,
          details: {
            selector,
            mode,
            fileCount: fileInputs.length,
            submitSelector: submitSelector.length > 0 ? submitSelector : null,
            submitted,
            uploadedFilename,
            uploadVerified,
            resultVerification: waitForResult ? resultVerification : null,
            finalTitle,
          },
        })
      : null;
    const report: TargetUploadReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      selector,
      files: fileInputs.map(({ name, size, type }) => ({ name, size, type })),
      fileCount: fileInputs.length,
      mode,
      submitSelector: submitSelector.length > 0 ? submitSelector : null,
      submitted,
      uploadedFilename,
      uploadVerified,
      matchedResultText,
      resultVerification: waitForResult ? resultVerification : null,
      ...(assertions ? { assertions } : {}),
      wait: waited,
      ...(includeProof
        ? {
            proof: {
              action: "upload",
              urlChanged: urlBeforeAction !== finalUrl,
              waitSatisfied: waited ? waited.satisfied : true,
              finalUrl,
              finalTitle,
              queryMode: "selector",
              query: selector,
              selector,
              countAfter: null,
            },
            ...(proofEnvelope ? { proofEnvelope } : {}),
          }
        : {}),
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
        url: target.page.url(),
        title: await target.page.title(),
        status: null,
        lastActionId: report.actionId,
        lastActionAt: nowIso(),
        lastActionKind: "upload",
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
