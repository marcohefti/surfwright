import { chromium, type Response } from "playwright-core";
import { newActionId } from "../../../action-id.js";
import { CliError } from "../../../errors.js";
import { nowIso, saveTargetSnapshot } from "../../../state/index.js";
import { providers } from "../../../providers/index.js";
import { redactHeaders } from "../../../shared/index.js";
import { parseTargetQueryInput } from "../target-query.js";
import { parseFrameScope } from "../target-find.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "../targets.js";
import { createCdpEvaluator, frameIdsForScope, getCdpFrameTree, openCdpSession } from "../cdp/index.js";
import { cdpQueryOp } from "../../click/cdp-query-op.js";
import type { TargetDownloadReport } from "../../../types.js";
import { evaluateActionAssertions, parseActionAssertions } from "../../../shared/index.js";
import { buildActionProofEnvelope, toActionWaitEvidence } from "../../../shared/index.js";

const DOWNLOAD_OUT_DIR_DEFAULT = "artifacts/downloads";
const DOWNLOAD_FILENAME_MAX = 180;

function sanitizeFilename(input: string): string {
  const raw = input.trim();
  const normalized = raw.replace(/[\\\/]+/g, "-").replace(/\s+/g, " ").trim();
  const safe = normalized.replace(/[^A-Za-z0-9._ -]+/g, "-").replace(/-+/g, "-").trim();
  const sliced = safe.length > 0 ? safe.slice(0, DOWNLOAD_FILENAME_MAX) : "download.bin";
  return sliced.replace(/\s+/g, " ");
}

function resolveDownloadOutDir(input: string | undefined): string {
  const value = typeof input === "string" ? input.trim() : "";
  return providers().path.resolve(value.length > 0 ? value : DOWNLOAD_OUT_DIR_DEFAULT);
}

function uniquePath(dir: string, filename: string): string {
  const { fs, path } = providers();
  const base = filename;
  const ext = path.extname(base);
  const stem = ext.length > 0 ? base.slice(0, -ext.length) : base;
  let candidate = path.join(dir, base);
  let idx = 1;
  while (fs.existsSync(candidate) && idx < 5000) {
    candidate = path.join(dir, `${stem}-${idx}${ext}`);
    idx += 1;
  }
  return candidate;
}

async function sha256File(filePath: string): Promise<string> {
  const { fs, crypto } = providers();
  return await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function pickDownloadResponse(responses: Response[], finalUrl: string): Response | null {
  const exact = responses.find((entry) => entry.url() === finalUrl);
  if (exact) {
    return exact;
  }
  for (const entry of responses.slice().reverse()) {
    try {
      const cd = entry.headers()["content-disposition"];
      if (typeof cd === "string" && cd.toLowerCase().includes("attachment")) {
        return entry;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export async function targetDownload(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  textQuery?: string;
  selectorQuery?: string;
  containsQuery?: string;
  visibleOnly?: boolean;
  frameScope?: string;
  index?: number;
  downloadOutDir?: string;
  proof?: boolean;
  assertUrlPrefix?: string;
  assertSelector?: string;
  assertText?: string;
}): Promise<TargetDownloadReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const parsed = parseTargetQueryInput({
    textQuery: opts.textQuery,
    selectorQuery: opts.selectorQuery,
    containsQuery: opts.containsQuery,
    visibleOnly: opts.visibleOnly,
  });
  const requestedIndex = typeof opts.index === "number" && Number.isFinite(opts.index) ? opts.index : null;
  if (requestedIndex !== null && (!Number.isInteger(requestedIndex) || requestedIndex < 0)) {
    throw new CliError("E_QUERY_INVALID", "index must be a non-negative integer");
  }
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
  const frameScope = parseFrameScope(opts.frameScope);
  const browser = await chromium.connectOverCDP(session.cdpOrigin, { timeout: opts.timeoutMs });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const cdp = await openCdpSession(target.page);
    const frameTree = await getCdpFrameTree(cdp);
    const worldCache = new Map<string, number>();
    const frameIds = frameIdsForScope({ frameTree, scope: frameScope });

    const queryMode = parsed.mode;
    const query = parsed.query;
    const selector = parsed.selector;
    const contains = parsed.contains;
    const visibleOnly = parsed.visibleOnly;

    const perFrameCounts: Array<{ frameCdpId: string; rawCount: number; firstVisibleIndex: number | null }> = [];
    for (const frameCdpId of frameIds) {
      const evaluator = createCdpEvaluator({ cdp, frameCdpId, worldCache });
      const summary = (await evaluator.evaluate(cdpQueryOp, {
        op: "summary",
        mode: queryMode,
        query,
        selector,
        contains,
      })) as { rawCount: number; firstVisibleIndex: number | null };
      perFrameCounts.push({ frameCdpId, rawCount: summary.rawCount, firstVisibleIndex: summary.firstVisibleIndex });
    }
    const matchCount = perFrameCounts.reduce((sum, entry) => sum + entry.rawCount, 0);
    if (matchCount < 1) {
      throw new CliError("E_QUERY_INVALID", visibleOnly ? "No visible element matched download query" : "No element matched download query");
    }

    const resolveFrameForGlobalIndex = (globalIndex: number): { frameCdpId: string; localIndex: number } => {
      let offset = 0;
      for (const entry of perFrameCounts) {
        if (globalIndex < offset + entry.rawCount) {
          return { frameCdpId: entry.frameCdpId, localIndex: globalIndex - offset };
        }
        offset += entry.rawCount;
      }
      throw new CliError("E_INTERNAL", "Unable to resolve global match index");
    };

    const previewAt = async (globalIndex: number) => {
      const resolved = resolveFrameForGlobalIndex(globalIndex);
      const evaluator = createCdpEvaluator({ cdp, frameCdpId: resolved.frameCdpId, worldCache });
      const payload = (await evaluator.evaluate(cdpQueryOp, {
        op: "preview",
        mode: queryMode,
        query,
        selector,
        contains,
        index: resolved.localIndex,
      })) as { ok: boolean; visible?: boolean; text?: string; selectorHint?: string | null; href?: string | null };
      if (!payload.ok) {
        throw new CliError("E_INTERNAL", "Unable to read match preview");
      }
      return { visible: Boolean(payload.visible), text: payload.text ?? "", selectorHint: payload.selectorHint ?? null, href: payload.href ?? null };
    };

    let pickedIndex: number;
    if (requestedIndex !== null) {
      if (requestedIndex >= matchCount) {
        throw new CliError("E_QUERY_INVALID", `index out of range: requested ${requestedIndex}, matchCount ${matchCount}`);
      }
      const preview = await previewAt(requestedIndex);
      if (visibleOnly && !preview.visible) {
        throw new CliError("E_QUERY_INVALID", `matched element at index ${requestedIndex} is not visible`);
      }
      pickedIndex = requestedIndex;
    } else if (!visibleOnly) {
      pickedIndex = 0;
    } else {
      let found: number | null = null;
      let offset = 0;
      for (const entry of perFrameCounts) {
        if (typeof entry.firstVisibleIndex === "number") {
          found = offset + entry.firstVisibleIndex;
          break;
        }
        offset += entry.rawCount;
      }
      if (found === null) {
        throw new CliError("E_QUERY_INVALID", "No visible element matched download query");
      }
      pickedIndex = found;
    }

    const responses: Response[] = [];
    const onResponse = (resp: Response) => {
      responses.push(resp);
      if (responses.length > 80) {
        responses.shift();
      }
    };
    target.page.on("response", onResponse);
    const downloadPromise = target.page.waitForEvent("download", { timeout: opts.timeoutMs });

    const clickAt = async (globalIndex: number) => {
      const resolved = resolveFrameForGlobalIndex(globalIndex);
      const evaluator = createCdpEvaluator({ cdp, frameCdpId: resolved.frameCdpId, worldCache });
      const payload = (await evaluator.evaluate(cdpQueryOp, {
        op: "click",
        mode: queryMode,
        query,
        selector,
        contains,
        index: resolved.localIndex,
      })) as { ok: boolean; visible?: boolean; text?: string; selectorHint?: string | null; href?: string | null };
      if (!payload.ok) {
        throw new CliError("E_QUERY_INVALID", visibleOnly ? "No visible element matched download query" : "No element matched download query");
      }
      return { visible: Boolean(payload.visible), text: payload.text ?? "", selectorHint: payload.selectorHint ?? null, href: payload.href ?? null };
    };

    const clickedPreview = await clickAt(pickedIndex);
    const urlBeforeDownload = target.page.url();
    let download: import("playwright-core").Download;
    download = await downloadPromise;

    const outDir = resolveDownloadOutDir(opts.downloadOutDir);
    providers().fs.mkdirSync(outDir, { recursive: true });
    const filename = sanitizeFilename(download.suggestedFilename());
    const outPath = uniquePath(outDir, filename);
    await download.saveAs(outPath);
    const stat = providers().fs.statSync(outPath);
    const sha256 = await sha256File(outPath);
    const finalUrl = download.url();
    const response = pickDownloadResponse(responses, finalUrl);
    const status = response ? response.status() : null;
    const headers = response ? redactHeaders({ headers: await response.allHeaders(), redactors: [] }) : {};
    const headerMime = headers["content-type"] ?? headers["Content-Type"] ?? null;
    const mime = typeof headerMime === "string" && headerMime.trim().length > 0 ? headerMime : null;
    const sourceUrl = clickedPreview.href ?? urlBeforeDownload;
    target.page.off("response", onResponse);
    const assertions = await evaluateActionAssertions({
      page: target.page,
      assertions: parsedAssertions,
    });
    const actionCompletedAt = Date.now();
    const currentUrl = target.page.url();
    const currentTitle = await target.page.title();
    const proofEnvelope = includeProof
      ? buildActionProofEnvelope({
          action: "download",
          urlBefore: urlBeforeDownload,
          urlAfter: currentUrl,
          targetBefore: requestedTargetId,
          targetAfter: requestedTargetId,
          matchCount,
          pickedIndex,
          wait: toActionWaitEvidence({
            requested: null,
            observed: null,
          }),
          assertions,
          countAfter: null,
          details: {
            downloadUrl: finalUrl,
            downloadStatus: status,
            filename: providers().path.basename(outPath),
            size: stat.size,
          },
        })
      : null;

    const report: TargetDownloadReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      targetId: requestedTargetId,
      actionId: newActionId(),
      mode: queryMode,
      selector,
      contains,
      visibleOnly,
      query,
      sourceUrl,
      matchCount,
      pickedIndex,
      clicked: {
        index: pickedIndex,
        text: clickedPreview.text,
        visible: clickedPreview.visible,
        selectorHint: clickedPreview.selectorHint,
      },
      url: currentUrl,
      title: currentTitle,
      download: {
        downloadStarted: true,
        sourceUrl,
        finalUrl,
        status,
        mime,
        headers,
        fileName: providers().path.basename(outPath),
        filename: providers().path.basename(outPath),
        path: outPath,
        sha256,
        bytes: stat.size,
        size: stat.size,
      },
      ...(includeProof
        ? {
            proof: {
              downloadStarted: true,
              fileName: providers().path.basename(outPath),
              path: outPath,
              bytes: stat.size,
              mime,
              sourceUrl,
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
        lastActionKind: "download",
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
