import type { Page, Request, Response } from "playwright-core";
import { CliError } from "../../errors.js";
import { providers } from "../../providers/index.js";
import { redactHeaders } from "../../shared/index.js";
import type { OpenReport } from "../../types.js";

const OPEN_REDIRECT_CHAIN_MAX = 12;
const DOWNLOAD_OUT_DIR_DEFAULT = "artifacts/downloads";
const DOWNLOAD_FILENAME_MAX = 180;
const OPEN_WAIT_UNTIL_VALUES = ["commit", "domcontentloaded", "load", "networkidle"] as const;
const OPEN_REUSE_MODES = ["off", "url", "origin", "active"] as const;

export type OpenWaitUntil = (typeof OPEN_WAIT_UNTIL_VALUES)[number];
export type OpenReuseMode = (typeof OPEN_REUSE_MODES)[number];

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
  sourceUrl: string | null;
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
  let mime: string | null = null;
  if (response) {
    status = response.status();
    headers = redactHeaders({ headers: await response.allHeaders(), redactors: [] });
    const headerMime = headers["content-type"] ?? headers["Content-Type"] ?? null;
    mime = typeof headerMime === "string" && headerMime.trim().length > 0 ? headerMime : null;
  }

  return {
    downloadStarted: true,
    sourceUrl: opts.sourceUrl,
    finalUrl,
    status,
    mime,
    headers,
    fileName: path.basename(outPath),
    filename: path.basename(outPath),
    path: outPath,
    sha256,
    bytes: size,
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

export function buildRedirectEvidence(opts: {
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

export function parseOpenWaitUntil(input: string | undefined, allowDownload: boolean): OpenWaitUntil {
  const fallback: OpenWaitUntil = allowDownload ? "commit" : "domcontentloaded";
  if (typeof input !== "string" || input.trim().length === 0) {
    return fallback;
  }
  const normalized = input.trim().toLowerCase();
  if (!OPEN_WAIT_UNTIL_VALUES.includes(normalized as OpenWaitUntil)) {
    throw new CliError("E_QUERY_INVALID", `wait-until must be one of: ${OPEN_WAIT_UNTIL_VALUES.join(", ")}`);
  }
  if (allowDownload && normalized !== "commit") {
    throw new CliError("E_QUERY_INVALID", "wait-until must be commit when --allow-download is enabled");
  }
  return normalized as OpenWaitUntil;
}

export function parseOpenReuseMode(opts: {
  reuseModeInput?: string;
  reuseUrl?: boolean;
}): OpenReuseMode {
  const hasReuseMode = typeof opts.reuseModeInput === "string" && opts.reuseModeInput.trim().length > 0;
  const hasReuseUrl = Boolean(opts.reuseUrl);
  if (hasReuseMode && hasReuseUrl) {
    throw new CliError("E_QUERY_INVALID", "Use either --reuse or --reuse-url, not both");
  }
  if (hasReuseUrl) {
    return "url";
  }
  if (!hasReuseMode) {
    return "off";
  }
  const normalized = opts.reuseModeInput!.trim().toLowerCase();
  if (!OPEN_REUSE_MODES.includes(normalized as OpenReuseMode)) {
    throw new CliError("E_QUERY_INVALID", `reuse must be one of: ${OPEN_REUSE_MODES.join(", ")}`);
  }
  return normalized as OpenReuseMode;
}

export async function navigatePageWithEvidence(opts: {
  page: Page;
  parsedUrl: URL;
  timeoutMs: number;
  allowDownload: boolean;
  downloadOutDir?: string;
  waitUntil: OpenWaitUntil;
}): Promise<{
  response: Response | null;
  status: number | null;
  finalUrl: string;
  title: string;
  downloadReport: OpenReport["download"];
}> {
  const responses: Response[] = [];
  const onResponse = (resp: Response) => {
    responses.push(resp);
    if (responses.length > 80) {
      responses.shift();
    }
  };
  opts.page.on("response", onResponse);

  try {
    const downloadEnabled = opts.allowDownload;
    const downloadEvent = downloadEnabled ? opts.page.waitForEvent("download", { timeout: opts.timeoutMs }) : null;
    if (downloadEvent) {
      void downloadEvent.catch(() => null);
    }

    let response: Response | null = null;
    let gotoError: unknown = null;
    let download: import("playwright-core").Download | null = null;
    try {
      const gotoPromise = opts.page.goto(opts.parsedUrl.toString(), {
        waitUntil: opts.waitUntil,
        timeout: opts.timeoutMs,
      });
      const downloadSignal = downloadEvent
        ? new Promise<{ kind: "download"; download: import("playwright-core").Download }>((resolve) => {
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
        void gotoPromise.catch(() => null);
      }
    } catch (error) {
      gotoError = error;
    }

    if (downloadEnabled && !download && gotoError) {
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

    let downloadReport: OpenReport["download"] = null;
    if (downloadEnabled && download) {
      downloadReport = await captureDownloadArtifact({
        download,
        responses,
        outDir: resolveDownloadOutDir(opts.downloadOutDir),
        sourceUrl: opts.parsedUrl.toString(),
      });
    }

    if (gotoError && !(downloadEnabled && downloadReport)) {
      throw gotoError;
    }

    const title = await opts.page.title();
    const finalUrl = downloadReport ? downloadReport.finalUrl : opts.page.url();
    const status = downloadReport?.status ?? response?.status() ?? null;

    return {
      response: response ?? null,
      status,
      finalUrl,
      title,
      downloadReport,
    };
  } finally {
    opts.page.off("response", onResponse);
  }
}
