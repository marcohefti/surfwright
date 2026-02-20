import { chromium } from "playwright-core";
import { newActionId } from "../../../action-id.js";
import { CliError } from "../../../errors.js";
import { nowIso, saveTargetSnapshot } from "../../../state/index.js";
import { providers } from "../../../providers/index.js";
import { ensureValidSelector, resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import { parseWaitAfterClick, resolveWaitTimeoutMs, waitAfterClick } from "../../click/click-utils.js";
import { evaluateActionAssertions, parseActionAssertions } from "../../../shared/index.js";
import { buildActionProofEnvelope, toActionWaitEvidence } from "../../../shared/index.js";

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
  waitForText?: string;
  waitForSelector?: string;
  waitNetworkIdle?: boolean;
  waitTimeoutMs?: number;
  proof?: boolean;
  assertUrlPrefix?: string;
  assertSelector?: string;
  assertText?: string;
}): Promise<TargetUploadReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const selector = parseRequiredSelector(opts.selectorQuery, "selector");
  const fileInputs = parseUploadFiles(opts.files);
  const waitAfter = parseWaitAfterClick({
    waitForText: opts.waitForText,
    waitForSelector: opts.waitForSelector,
    waitNetworkIdle: opts.waitNetworkIdle,
  });
  const waitTimeoutMs = resolveWaitTimeoutMs(opts.waitTimeoutMs, opts.timeoutMs);
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
    const isFileInput = await locator.evaluate((node: any) => {
      const tagName = typeof node?.tagName === "string" ? node.tagName.toLowerCase() : "";
      const inputType = typeof node?.type === "string" ? node.type.toLowerCase() : "";
      return tagName === "input" && inputType === "file";
    });

    let mode: TargetUploadReport["mode"] = "direct-input";
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

    const waitStartedAt = Date.now();
    const waitedMode = await waitAfterClick({
      page: target.page,
      waitAfter,
      timeoutMs: waitTimeoutMs,
    });
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
