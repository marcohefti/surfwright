import type { Page, Response } from "playwright-core";
import { CliError } from "../../../errors.js";
import { providers } from "../../../providers/index.js";
import { redactHeaders } from "../../../shared/index.js";
import { nowIso, saveTargetSnapshot } from "../../../state/index.js";
import type { TargetDownloadReport } from "../../../types.js";
import { evaluateActionAssertions, type ParsedActionAssertions } from "../../../shared/index.js";
import { buildActionProofEnvelope, toActionWaitEvidence } from "../../../shared/index.js";
import { newActionId } from "../../../action-id.js";

const DOWNLOAD_OUT_DIR_DEFAULT = "artifacts/downloads";
const DOWNLOAD_FILENAME_MAX = 180;

export function sanitizeFilename(input: string): string {
  const raw = input.trim();
  const normalized = raw.replace(/[\\\/]+/g, "-").replace(/\s+/g, " ").trim();
  const safe = normalized.replace(/[^A-Za-z0-9._ -]+/g, "-").replace(/-+/g, "-").trim();
  const sliced = safe.length > 0 ? safe.slice(0, DOWNLOAD_FILENAME_MAX) : "download.bin";
  return sliced.replace(/\s+/g, " ");
}

export function resolveDownloadOutDir(input: string | undefined): string {
  const value = typeof input === "string" ? input.trim() : "";
  return providers().path.resolve(value.length > 0 ? value : DOWNLOAD_OUT_DIR_DEFAULT);
}

export function uniquePath(dir: string, filename: string): string {
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

export async function sha256File(filePath: string): Promise<string> {
  const { fs, crypto } = providers();
  return await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function pickDownloadResponse(responses: Response[], finalUrl: string): Response | null {
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

function parseContentDispositionFilename(headers: Record<string, string>): string | null {
  const raw = headers["content-disposition"] ?? headers["Content-Disposition"] ?? null;
  if (typeof raw !== "string" || raw.trim().length < 1) {
    return null;
  }
  const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match && typeof utf8Match[1] === "string") {
    try {
      return decodeURIComponent(utf8Match[1].trim());
    } catch {
      // ignore decode errors
    }
  }
  const simpleMatch = raw.match(/filename="?([^";]+)"?/i);
  if (simpleMatch && typeof simpleMatch[1] === "string") {
    return simpleMatch[1].trim();
  }
  return null;
}

function filenameFromUrl(input: string): string | null {
  try {
    const parsed = new URL(input);
    const parts = parsed.pathname.split("/").filter((part) => part.length > 0);
    const last = parts[parts.length - 1] ?? "";
    return last.length > 0 ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

async function sha256Buffer(input: Buffer): Promise<string> {
  const { crypto } = providers();
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function captureFetchFallbackDownload(opts: {
  page: Page;
  outDir: string;
  fallbackUrl: string;
  sourceUrl: string | null;
  timeoutMs: number;
}): Promise<{
  report: NonNullable<TargetDownloadReport["download"]>;
  downloadFinalUrl: string;
  downloadStatus: number | null;
  downloadFileName: string;
  downloadBytes: number;
  mime: string | null;
}> {
  const { fs, path } = providers();
  fs.mkdirSync(opts.outDir, { recursive: true });
  const response = await opts.page.request.get(opts.fallbackUrl, {
    timeout: opts.timeoutMs,
    failOnStatusCode: false,
  });
  const headers = redactHeaders({ headers: response.headers(), redactors: [] });
  const finalUrl = response.url();
  const body = Buffer.from(await response.body());
  const contentDispositionName = parseContentDispositionFilename(headers);
  const filenameHint = contentDispositionName ?? filenameFromUrl(finalUrl) ?? "download.bin";
  const filename = sanitizeFilename(filenameHint);
  const outPath = uniquePath(opts.outDir, filename);
  fs.writeFileSync(outPath, body);
  const sha256 = await sha256Buffer(body);
  const headerMime = headers["content-type"] ?? headers["Content-Type"] ?? null;
  const mime = typeof headerMime === "string" && headerMime.trim().length > 0 ? headerMime : null;
  const fileName = path.basename(outPath);
  const bytes = body.byteLength;
  return {
    report: {
      downloadStarted: true,
      sourceUrl: opts.sourceUrl,
      finalUrl,
      status: response.status(),
      mime,
      headers,
      fileName,
      path: outPath,
      sha256,
      bytes,
    },
    downloadFinalUrl: finalUrl,
    downloadStatus: response.status(),
    downloadFileName: fileName,
    downloadBytes: bytes,
    mime,
  };
}

export async function handleMissingDownloadEvent(opts: {
  page: Page;
  downloadWaitError: unknown;
  timeoutMs: number;
  allowMissingDownloadEvent: boolean;
  fallbackToFetch: boolean;
  downloadOutDir?: string;
  parsedAssertions: ParsedActionAssertions;
  includeProof: boolean;
  requestedTargetId: string;
  sessionId: string;
  sessionSource: TargetDownloadReport["sessionSource"];
  mode: TargetDownloadReport["mode"];
  selector: string | null;
  contains: string | null;
  visibleOnly: boolean;
  query: string;
  sourceUrl: string | null;
  matchCount: number;
  pickedIndex: number;
  clicked: TargetDownloadReport["clicked"];
  urlBeforeDownload: string;
  resolvedSessionAt: number;
  connectedAt: number;
  startedAt: number;
  persistState: boolean;
}): Promise<TargetDownloadReport> {
  const timeoutReason =
    opts.downloadWaitError instanceof Error
      ? opts.downloadWaitError.message
      : `download event not observed within timeout (${opts.timeoutMs}ms)`;
  const outDir = resolveDownloadOutDir(opts.downloadOutDir);
  let fallbackErrorReason: string | null = null;
  let fallbackCapture: Awaited<ReturnType<typeof captureFetchFallbackDownload>> | null = null;
  if (opts.fallbackToFetch) {
    const rawFallbackUrl = opts.sourceUrl ?? opts.page.url();
    let fallbackUrl: string | null = null;
    if (typeof rawFallbackUrl === "string" && rawFallbackUrl.trim().length > 0) {
      try {
        fallbackUrl = new URL(rawFallbackUrl, opts.page.url()).toString();
      } catch {
        fallbackUrl = rawFallbackUrl;
      }
    }
    if (typeof fallbackUrl === "string" && fallbackUrl.trim().length > 0) {
      try {
        fallbackCapture = await captureFetchFallbackDownload({
          page: opts.page,
          outDir,
          fallbackUrl,
          sourceUrl: opts.sourceUrl,
          timeoutMs: opts.timeoutMs,
        });
      } catch (error) {
        fallbackErrorReason = error instanceof Error ? error.message : "fetch fallback failed";
      }
    } else {
      fallbackErrorReason = "fetch fallback failed: no candidate URL available";
    }
  }

  if (fallbackCapture) {
    const assertions = await evaluateActionAssertions({
      page: opts.page,
      assertions: opts.parsedAssertions,
    });
    const actionCompletedAt = Date.now();
    const currentUrl = opts.page.url();
    const currentTitle = await opts.page.title();
    const proofEnvelope = opts.includeProof
      ? buildActionProofEnvelope({
          action: "download",
          urlBefore: opts.urlBeforeDownload,
          urlAfter: currentUrl,
          targetBefore: opts.requestedTargetId,
          targetAfter: opts.requestedTargetId,
          matchCount: opts.matchCount,
          pickedIndex: opts.pickedIndex,
          wait: toActionWaitEvidence({
            requested: null,
            observed: null,
          }),
          assertions,
          countAfter: null,
          details: {
            downloadUrl: fallbackCapture.downloadFinalUrl,
            downloadStatus: fallbackCapture.downloadStatus,
            fileName: fallbackCapture.downloadFileName,
            bytes: fallbackCapture.downloadBytes,
            downloadMethod: "fetch-fallback",
          },
        })
      : null;

    const report: TargetDownloadReport = {
      ok: true,
      sessionId: opts.sessionId,
      sessionSource: opts.sessionSource,
      targetId: opts.requestedTargetId,
      actionId: newActionId(),
      mode: opts.mode,
      selector: opts.selector,
      contains: opts.contains,
      visibleOnly: opts.visibleOnly,
      query: opts.query,
      sourceUrl: opts.sourceUrl,
      matchCount: opts.matchCount,
      pickedIndex: opts.pickedIndex,
      clicked: opts.clicked,
      url: currentUrl,
      title: currentTitle,
      downloadStarted: true,
      downloadMethod: "fetch-fallback",
      downloadStatus: fallbackCapture.downloadStatus,
      downloadFinalUrl: fallbackCapture.downloadFinalUrl,
      downloadFileName: fallbackCapture.downloadFileName,
      downloadBytes: fallbackCapture.downloadBytes,
      downloadedFilename: fallbackCapture.downloadFileName,
      downloadedBytes: fallbackCapture.downloadBytes,
      download: fallbackCapture.report,
      ...(opts.includeProof
        ? {
            proof: {
              downloadStarted: true,
              downloadMethod: "fetch-fallback",
              fileName: fallbackCapture.downloadFileName,
              path: fallbackCapture.report.path,
              bytes: fallbackCapture.downloadBytes,
              mime: fallbackCapture.mime,
              sourceUrl: opts.sourceUrl,
            },
          }
        : {}),
      ...(proofEnvelope ? { proofEnvelope } : {}),
      ...(assertions ? { assertions } : {}),
      timingMs: {
        total: 0,
        resolveSession: opts.resolvedSessionAt - opts.startedAt,
        connectCdp: opts.connectedAt - opts.resolvedSessionAt,
        action: actionCompletedAt - opts.connectedAt,
        persistState: 0,
      },
    };
    return await persistDownloadReport({ report, persistState: opts.persistState, startedAt: opts.startedAt });
  }

  if (!opts.allowMissingDownloadEvent) {
    const message = opts.fallbackToFetch && fallbackErrorReason
      ? `${timeoutReason}; fetch fallback failed: ${fallbackErrorReason}`
      : timeoutReason;
    throw new CliError("E_INTERNAL", message);
  }

  const assertions = await evaluateActionAssertions({
    page: opts.page,
    assertions: opts.parsedAssertions,
  });
  const actionCompletedAt = Date.now();
  const currentUrl = opts.page.url();
  const currentTitle = await opts.page.title();
  const failureReason = opts.fallbackToFetch && fallbackErrorReason
    ? `download event not observed within timeout (${opts.timeoutMs}ms); fetch fallback failed: ${fallbackErrorReason}`
    : `download event not observed within timeout (${opts.timeoutMs}ms)`;
  const proofEnvelope = opts.includeProof
    ? buildActionProofEnvelope({
        action: "download",
        urlBefore: opts.urlBeforeDownload,
        urlAfter: currentUrl,
        targetBefore: opts.requestedTargetId,
        targetAfter: opts.requestedTargetId,
        matchCount: opts.matchCount,
        pickedIndex: opts.pickedIndex,
        wait: toActionWaitEvidence({
          requested: null,
          observed: null,
        }),
        assertions,
        countAfter: null,
        details: {
          downloadUrl: null,
          downloadStatus: null,
          fileName: null,
          bytes: null,
          downloadMethod: "none",
          failureReason,
        },
      })
    : null;
  const report: TargetDownloadReport = {
    ok: true,
    sessionId: opts.sessionId,
    sessionSource: opts.sessionSource,
    targetId: opts.requestedTargetId,
    actionId: newActionId(),
    mode: opts.mode,
    selector: opts.selector,
    contains: opts.contains,
    visibleOnly: opts.visibleOnly,
    query: opts.query,
    sourceUrl: opts.sourceUrl,
    matchCount: opts.matchCount,
    pickedIndex: opts.pickedIndex,
    clicked: opts.clicked,
    url: currentUrl,
    title: currentTitle,
    downloadStarted: false,
    downloadMethod: "none",
    downloadStatus: null,
    downloadFinalUrl: null,
    downloadFileName: null,
    downloadBytes: null,
    downloadedFilename: null,
    downloadedBytes: null,
    download: null,
    failureReason,
    ...(opts.includeProof
      ? {
          proof: {
            downloadStarted: false,
            downloadMethod: "none",
            fileName: null,
            path: null,
            bytes: null,
            mime: null,
            sourceUrl: opts.sourceUrl,
            failureReason,
          },
        }
      : {}),
    ...(proofEnvelope ? { proofEnvelope } : {}),
    ...(assertions ? { assertions } : {}),
    timingMs: {
      total: 0,
      resolveSession: opts.resolvedSessionAt - opts.startedAt,
      connectCdp: opts.connectedAt - opts.resolvedSessionAt,
      action: actionCompletedAt - opts.connectedAt,
      persistState: 0,
    },
  };
  return await persistDownloadReport({ report, persistState: opts.persistState, startedAt: opts.startedAt });
}

export async function persistDownloadReport(opts: {
  report: TargetDownloadReport;
  persistState: boolean;
  startedAt: number;
}): Promise<TargetDownloadReport> {
  const persistStartedAt = Date.now();
  if (opts.persistState) {
    await saveTargetSnapshot({
      targetId: opts.report.targetId,
      sessionId: opts.report.sessionId,
      url: opts.report.url,
      title: opts.report.title,
      status: null,
      lastActionId: opts.report.actionId,
      lastActionAt: nowIso(),
      lastActionKind: "download",
      updatedAt: nowIso(),
    });
  }
  const persistedAt = Date.now();
  opts.report.timingMs.persistState = persistedAt - persistStartedAt;
  opts.report.timingMs.total = persistedAt - opts.startedAt;
  return opts.report;
}
