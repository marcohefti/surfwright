import { chromium, type Request, type Response } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { resolveOpenSessionHint } from "../../session-isolation.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { readPageTargetId, resolveSessionForAction } from "../../target/public.js";
import type { OpenReport, SessionReport } from "../../types.js";
import { parseManagedBrowserMode } from "../app/browser-mode.js";
import { providers } from "../../providers/index.js";
import { redactHeaders } from "../../shared/index.js";

const OPEN_REDIRECT_CHAIN_MAX = 12;
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

async function captureDownloadArtifact(opts: {
  download: import("playwright-core").Download;
  responses: Response[];
  outDir: string;
}): Promise<OpenReport["download"]> {
  const { fs, path, crypto } = providers();
  fs.mkdirSync(opts.outDir, { recursive: true });
  const filename = sanitizeFilename(opts.download.suggestedFilename());
  const outPath = uniquePath(opts.outDir, filename);
  await opts.download.saveAs(outPath);
  const stat = fs.statSync(outPath);
  const size = stat.size;
  const sha256 = await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(outPath);
    stream.on("data", (chunk: string | Buffer) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
  const finalUrl = opts.download.url();

  const response =
    opts.responses.find((entry) => entry.url() === finalUrl) ??
    opts.responses
      .slice()
      .reverse()
      .find((entry) => {
        try {
          const headers = entry.headers();
          const cd = headers["content-disposition"] ?? headers["Content-Disposition"];
          return typeof cd === "string" && cd.toLowerCase().includes("attachment");
        } catch {
          return false;
        }
      }) ??
    null;

  let status: number | null = null;
  let headers: Record<string, string> = {};
  if (response) {
    status = response.status();
    headers = redactHeaders({ headers: await response.allHeaders(), redactors: [] });
  }

  return {
    finalUrl,
    status,
    headers,
    filename: path.basename(outPath),
    path: outPath,
    sha256,
    size,
  };
}

function collectRedirectChain(request: Request): string[] {
  const reverse: string[] = [];
  let current: Request | null = request;
  while (current) {
    reverse.push(current.url());
    current = current.redirectedFrom();
  }
  return reverse.reverse();
}

function buildRedirectEvidence(opts: {
  response: Response | null;
  requestedUrl: string;
  finalUrl: string;
}): { redirectChain: string[] | null; redirectChainTruncated: boolean } {
  if (opts.requestedUrl === opts.finalUrl) {
    return { redirectChain: null, redirectChainTruncated: false };
  }

  const fromResponse = opts.response ? collectRedirectChain(opts.response.request()) : [];
  const merged = fromResponse.length > 0 ? fromResponse : [opts.requestedUrl, opts.finalUrl];

  const normalized = merged.filter((entry, idx) => idx === 0 || entry !== merged[idx - 1]);
  if (normalized.length === 0) {
    return { redirectChain: [opts.requestedUrl, opts.finalUrl], redirectChainTruncated: false };
  }

  if (normalized[0] !== opts.requestedUrl) {
    normalized.unshift(opts.requestedUrl);
  }
  if (normalized[normalized.length - 1] !== opts.finalUrl) {
    normalized.push(opts.finalUrl);
  }

  if (normalized.length <= OPEN_REDIRECT_CHAIN_MAX) {
    return { redirectChain: normalized, redirectChainTruncated: false };
  }

  return {
    redirectChain: [...normalized.slice(0, OPEN_REDIRECT_CHAIN_MAX - 1), normalized[normalized.length - 1]],
    redirectChainTruncated: true,
  };
}

export async function openUrl(opts: {
  inputUrl: string;
  timeoutMs: number;
  sessionId?: string;
  profile?: string;
  reuseUrl?: boolean;
  isolation?: string;
  browserModeInput?: string;
  ensureSharedSession: (input: { timeoutMs: number }) => Promise<SessionReport>;
  allowDownload?: boolean;
  downloadOutDir?: string;
}): Promise<OpenReport> {
  const startedAt = Date.now();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(opts.inputUrl);
  } catch {
    throw new CliError("E_URL_INVALID", "URL must be absolute (e.g. https://example.com)");
  }
  const requestedUrl = parsedUrl.toString();
  const profileHint = typeof opts.profile === "string" && opts.profile.trim().length > 0 ? opts.profile : undefined;
  const sessionHint = profileHint
    ? undefined
    : await resolveOpenSessionHint({
        sessionId: opts.sessionId,
        isolation: opts.isolation,
        timeoutMs: opts.timeoutMs,
        ensureSharedSession: opts.ensureSharedSession,
      });

  const desiredBrowserMode = parseManagedBrowserMode(opts.browserModeInput);
  const { session, sessionSource } = await resolveSessionForAction({
    sessionHint,
    profileHint,
    timeoutMs: opts.timeoutMs,
    allowImplicitNewSession: !sessionHint && !profileHint,
    browserMode: desiredBrowserMode ?? undefined,
  });
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, {
    timeout: opts.timeoutMs,
  });
  const connectedAt = Date.now();
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    if (opts.reuseUrl) {
      const existing = context.pages().find((candidate) => candidate.url() === parsedUrl.toString());
      if (existing) {
        const actionId = newActionId();
        const targetId = await readPageTargetId(context, existing);
        const title = await existing.title();
        const finalUrl = existing.url();
        const { redirectChain, redirectChainTruncated } = buildRedirectEvidence({
          response: null,
          requestedUrl,
          finalUrl,
        });
        const actionCompletedAt = Date.now();
        const report: OpenReport = {
          ok: true,
          sessionId: session.sessionId,
          sessionSource,
          browserMode: session.browserMode,
          profile: session.profile ?? null,
          targetId,
          actionId,
          requestedUrl,
          finalUrl,
          wasRedirected: requestedUrl !== finalUrl,
          redirectChain,
          redirectChainTruncated,
          url: finalUrl,
          status: null,
          title,
          download: null,
          timingMs: {
            total: 0,
            resolveSession: resolvedSessionAt - startedAt,
            connectCdp: connectedAt - resolvedSessionAt,
            action: actionCompletedAt - connectedAt,
            persistState: 0,
          },
        };
        const persistStartedAt = Date.now();
        await saveTargetSnapshot({
          targetId: report.targetId,
          sessionId: report.sessionId,
          url: report.url,
          title: report.title,
          status: report.status,
          lastActionId: report.actionId,
          lastActionAt: nowIso(),
          lastActionKind: "open",
          updatedAt: nowIso(),
        });
        const persistedAt = Date.now();
        report.timingMs.persistState = persistedAt - persistStartedAt;
        report.timingMs.total = persistedAt - startedAt;
        return report;
      }
    }
    const page = await context.newPage();
    const responses: Response[] = [];
    const onResponse = (resp: Response) => {
      responses.push(resp);
      if (responses.length > 80) {
        responses.shift();
      }
    };
    page.on("response", onResponse);

    const downloadEnabled = Boolean(opts.allowDownload);
    const downloadEvent = downloadEnabled ? page.waitForEvent("download", { timeout: opts.timeoutMs }) : null;
    // If navigation wins, we may never await the download event; ensure its timeout rejection
    // doesn't surface as an unhandled rejection.
    if (downloadEvent) {
      void downloadEvent.catch(() => null);
    }

    let response: Response | null = null;
    let gotoError: unknown = null;
    let download: import("playwright-core").Download | null = null;
    try {
      const gotoPromise = page.goto(parsedUrl.toString(), {
        waitUntil: downloadEnabled ? "commit" : "domcontentloaded",
        timeout: opts.timeoutMs,
      });
      const downloadSignal = downloadEvent
        ? new Promise<{ kind: "download"; download: import("playwright-core").Download }>((resolve) => {
            // Ensure downloadEvent timeout doesn't surface as an unhandled rejection via this derived promise.
            downloadEvent.then((d) => resolve({ kind: "download", download: d }), () => {});
          })
        : new Promise<never>(() => {});
      const settled = await Promise.race([
        downloadSignal,
        gotoPromise.then((r) => ({ kind: "goto" as const, response: r })),
      ]);
      if (settled.kind === "goto") {
        response = settled.response;
        download = null;
      } else {
        download = settled.download;
        response = null;
        // Download navigations frequently abort the page navigation; never await gotoPromise here.
        void gotoPromise.catch(() => null);
      }
    } catch (error) {
      gotoError = error;
    }
    if (downloadEnabled && !download && gotoError) {
      // If navigation aborted early (ERR_ABORTED), downloads can arrive shortly after.
      const timeoutMs = Math.min(1200, opts.timeoutMs);
      const downloaded = await Promise.race([
        downloadEvent ? downloadEvent.catch(() => null) : Promise.resolve(null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ]);
      if (downloaded) {
        download = downloaded;
        gotoError = null;
      }
    }

    const targetId = await readPageTargetId(context, page);

    let downloadReport: OpenReport["download"] = null;
    if (downloadEnabled && download) {
      downloadReport = await captureDownloadArtifact({
        download,
        responses,
        outDir: resolveDownloadOutDir(opts.downloadOutDir),
      });
    }

    page.off("response", onResponse);

    if (gotoError && !(downloadEnabled && downloadReport)) {
      throw gotoError;
    }

    const title = await page.title();
    const finalUrl = downloadReport ? downloadReport.finalUrl : page.url();
    const { redirectChain, redirectChainTruncated } = buildRedirectEvidence({
      response: response ?? null,
      requestedUrl,
      finalUrl,
    });
    const actionCompletedAt = Date.now();
    const report: OpenReport = {
      ok: true,
      sessionId: session.sessionId,
      sessionSource,
      browserMode: session.browserMode,
      profile: session.profile ?? null,
      targetId,
      actionId: newActionId(),
      requestedUrl,
      finalUrl,
      wasRedirected: requestedUrl !== finalUrl,
      redirectChain,
      redirectChainTruncated,
      url: finalUrl,
      status: downloadReport?.status ?? response?.status() ?? null,
      title,
      download: downloadReport,
      timingMs: {
        total: 0,
        resolveSession: resolvedSessionAt - startedAt,
        connectCdp: connectedAt - resolvedSessionAt,
        action: actionCompletedAt - connectedAt,
        persistState: 0,
      },
    };
    const persistStartedAt = Date.now();
    await saveTargetSnapshot({
      targetId: report.targetId,
      sessionId: report.sessionId,
      url: report.url,
      title: report.title,
      status: report.status,
      lastActionId: report.actionId,
      lastActionAt: nowIso(),
      lastActionKind: "open",
      updatedAt: nowIso(),
    });
    const persistedAt = Date.now();
    report.timingMs.persistState = persistedAt - persistStartedAt;
    report.timingMs.total = persistedAt - startedAt;
    return report;
  } finally {
    await browser.close();
  }
}
