import fs from "node:fs/promises";
import path from "node:path";
import type { TargetNetworkHarReport, TargetNetworkRequestReport } from "./types.js";

type HarHeader = {
  name: string;
  value: string;
};

function headersToHar(headers: Record<string, string> | undefined): HarHeader[] {
  if (!headers) {
    return [];
  }
  return Object.entries(headers)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => ({
      name,
      value,
    }));
}

function queryStringToHar(urlRaw: string): HarHeader[] {
  try {
    const url = new URL(urlRaw);
    const params: HarHeader[] = [];
    for (const [name, value] of url.searchParams.entries()) {
      params.push({ name, value });
    }
    return params;
  } catch {
    return [];
  }
}

function responseMimeType(headers: Record<string, string> | undefined): string {
  const contentType = headers?.["content-type"] ?? headers?.["Content-Type"];
  return typeof contentType === "string" ? contentType : "";
}

function requestBodySize(request: TargetNetworkRequestReport): number {
  const preview = request.postDataPreview;
  if (!preview || preview.length === 0) {
    return -1;
  }
  if (preview.startsWith("base64:")) {
    return -1;
  }
  return Buffer.byteLength(preview, "utf8");
}

function requestTimings(request: TargetNetworkRequestReport): {
  blocked: number;
  dns: number;
  connect: number;
  ssl: number;
  send: number;
  wait: number;
  receive: number;
} {
  const durationMs = request.durationMs;
  if (typeof durationMs !== "number") {
    return {
      blocked: -1,
      dns: -1,
      connect: -1,
      ssl: -1,
      send: -1,
      wait: -1,
      receive: -1,
    };
  }

  const wait = typeof request.ttfbMs === "number" ? Math.min(durationMs, Math.max(0, request.ttfbMs)) : durationMs;
  return {
    blocked: -1,
    dns: -1,
    connect: -1,
    ssl: -1,
    send: 0,
    wait,
    receive: Math.max(0, durationMs - wait),
  };
}

function toHarEntry(opts: {
  request: TargetNetworkRequestReport;
  captureStartEpochMs: number;
  pageRef: string;
}): Record<string, unknown> {
  const request = opts.request;
  const startedDateTime = new Date(opts.captureStartEpochMs + request.startMs).toISOString();
  const responseHeaders = request.responseHeaders ?? {};
  return {
    startedDateTime,
    time: typeof request.durationMs === "number" ? request.durationMs : 0,
    request: {
      method: request.method,
      url: request.url,
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: headersToHar(request.requestHeaders),
      queryString: queryStringToHar(request.url),
      headersSize: -1,
      bodySize: requestBodySize(request),
    },
    response: {
      status: request.status ?? 0,
      statusText: request.failure ?? "",
      httpVersion: "HTTP/1.1",
      cookies: [],
      headers: headersToHar(request.responseHeaders),
      content: {
        size: request.bytesApprox ?? 0,
        mimeType: responseMimeType(responseHeaders),
      },
      redirectURL: "",
      headersSize: -1,
      bodySize: request.bytesApprox ?? -1,
    },
    cache: {},
    timings: requestTimings(request),
    pageref: opts.pageRef,
    _surfwright: {
      id: request.id,
      resourceType: request.resourceType,
      navigation: request.navigation,
      ok: request.ok,
      failure: request.failure,
      ttfbMs: request.ttfbMs,
      bytesApprox: request.bytesApprox,
    },
  };
}

export async function writeHarFile(opts: {
  outputPath: string;
  captureStartEpochMs: number;
  captureStartedAtIso: string;
  pageTitle: string;
  pageUrl: string;
  targetId: string;
  requests: TargetNetworkRequestReport[];
}): Promise<TargetNetworkHarReport> {
  const outputPath = path.resolve(opts.outputPath);

  const pageRef = `page-${opts.targetId}`;
  const entries = [...opts.requests]
    .sort((a, b) => a.id - b.id)
    .map((request) =>
      toHarEntry({
        request,
        captureStartEpochMs: opts.captureStartEpochMs,
        pageRef,
      }),
    );

  const payload = {
    log: {
      version: "1.2",
      creator: {
        name: "surfwright",
      },
      pages: [
        {
          startedDateTime: opts.captureStartedAtIso,
          id: pageRef,
          title: opts.pageTitle,
          pageTimings: {
            onContentLoad: -1,
            onLoad: -1,
          },
          _surfwright: {
            url: opts.pageUrl,
            targetId: opts.targetId,
          },
        },
      ],
      entries,
    },
  };

  const serialized = JSON.stringify(payload);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, serialized, "utf8");

  return {
    path: outputPath,
    mode: "minimal",
    scope: "filtered",
    entries: entries.length,
    bytes: Buffer.byteLength(serialized, "utf8"),
    writtenAt: new Date().toISOString(),
  };
}
