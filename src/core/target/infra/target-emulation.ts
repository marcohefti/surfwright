import { chromium } from "playwright-core";
import { newActionId } from "../../action-id.js";
import { CliError } from "../../errors.js";
import { nowIso } from "../../state/index.js";
import { saveTargetSnapshot } from "../../state/index.js";
import { resolveSessionForAction, resolveTargetHandle, sanitizeTargetId } from "./targets.js";
import { providers } from "../../providers/index.js";
import { openCdpSession } from "./cdp/index.js";

type ActionTimingMs = {
  total: number;
  resolveSession: number;
  connectCdp: number;
  action: number;
  persistState: number;
};

type TargetEmulateReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  actionId: string;
  emulation: {
    viewport: { width: number; height: number } | null;
    userAgent: string | null;
    colorScheme: "light" | "dark" | "no-preference" | null;
    hasTouch: boolean | null;
    deviceScaleFactor: number | null;
  };
  timingMs: ActionTimingMs;
};

type TargetScreenshotReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  path: string;
  fullPage: boolean;
  type: "png" | "jpeg";
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  timingMs: ActionTimingMs;
};

type TargetClickAtReport = {
  ok: true;
  sessionId: string;
  targetId: string;
  actionId: string;
  point: {
    x: number;
    y: number;
  };
  button: "left" | "middle" | "right";
  clickCount: number;
  url: string;
  title: string;
  timingMs: ActionTimingMs;
};

function parseOptionalInt(value: number | undefined, name: string, min: number, max: number): number | null {
  if (typeof value === "undefined") {
    return null;
  }
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new CliError("E_QUERY_INVALID", `${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function parseOptionalNumber(value: number | undefined, name: string, min: number, max: number): number | null {
  if (typeof value === "undefined") {
    return null;
  }
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new CliError("E_QUERY_INVALID", `${name} must be between ${min} and ${max}`);
  }
  return value;
}

function parseColorScheme(value: string | undefined): "light" | "dark" | "no-preference" | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "light" || normalized === "dark" || normalized === "no-preference") {
    return normalized;
  }
  throw new CliError("E_QUERY_INVALID", "color-scheme must be one of: light, dark, no-preference");
}

function parseScreenshotType(value: string | undefined): "png" | "jpeg" {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "png";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "png" || normalized === "jpeg") {
    return normalized;
  }
  throw new CliError("E_QUERY_INVALID", "type must be one of: png, jpeg");
}

function parseScreenshotOutPath(value: string | undefined): string {
  const out = typeof value === "string" ? value.trim() : "";
  if (out.length === 0) {
    throw new CliError("E_QUERY_INVALID", "out path is required");
  }
  return providers().path.resolve(out);
}

function parseClickCoordinate(value: number | undefined, name: string): number {
  if (!Number.isFinite(value)) {
    throw new CliError("E_QUERY_INVALID", `${name} is required`);
  }
  const resolved = Number(value);
  if (resolved < 0 || resolved > 100000) {
    throw new CliError("E_QUERY_INVALID", `${name} must be between 0 and 100000`);
  }
  return resolved;
}

function parseClickButton(value: string | undefined): "left" | "middle" | "right" {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "" || normalized === "left") {
    return "left";
  }
  if (normalized === "middle" || normalized === "right") {
    return normalized;
  }
  throw new CliError("E_QUERY_INVALID", "button must be one of: left, middle, right");
}

function parseClickCount(value: number | undefined): number {
  if (typeof value === "undefined") {
    return 1;
  }
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new CliError("E_QUERY_INVALID", "click-count must be an integer between 1 and 5");
  }
  return value;
}

export async function targetEmulate(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  width?: number;
  height?: number;
  userAgent?: string;
  colorScheme?: string;
  hasTouch?: boolean;
  deviceScaleFactor?: number;
}): Promise<TargetEmulateReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const width = parseOptionalInt(opts.width, "width", 200, 5000);
  const height = parseOptionalInt(opts.height, "height", 200, 5000);
  const viewport = width !== null || height !== null ? { width: width ?? 1280, height: height ?? 720 } : null;
  const userAgent = typeof opts.userAgent === "string" && opts.userAgent.trim().length > 0 ? opts.userAgent.trim() : null;
  const colorScheme = parseColorScheme(opts.colorScheme);
  const hasTouch = typeof opts.hasTouch === "boolean" ? opts.hasTouch : null;
  const deviceScaleFactor = parseOptionalNumber(opts.deviceScaleFactor, "device-scale-factor", 0.5, 4);

  const { session } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, { timeout: opts.timeoutMs });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    if (viewport) {
      await target.page.setViewportSize(viewport);
    }
    if (colorScheme) {
      await target.page.emulateMedia({
        colorScheme,
      });
    }

    if (userAgent || hasTouch !== null || deviceScaleFactor !== null) {
      const cdp = await target.page.context().newCDPSession(target.page);
      if (userAgent) {
        await cdp.send("Emulation.setUserAgentOverride", { userAgent });
      }
      if (hasTouch !== null || deviceScaleFactor !== null) {
        const runtimeViewport = target.page.viewportSize() ?? { width: 1280, height: 720 };
        await cdp.send("Emulation.setDeviceMetricsOverride", {
          width: runtimeViewport.width,
          height: runtimeViewport.height,
          deviceScaleFactor: deviceScaleFactor ?? 1,
          mobile: hasTouch ?? false,
        });
        if (hasTouch !== null) {
          await cdp.send("Emulation.setTouchEmulationEnabled", {
            enabled: hasTouch,
            maxTouchPoints: hasTouch ? 5 : 1,
          });
        }
      }
    }

    const actionCompletedAt = Date.now();
    const report: TargetEmulateReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      actionId: newActionId(),
      emulation: {
        viewport,
        userAgent,
        colorScheme,
        hasTouch,
        deviceScaleFactor,
      },
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
        lastActionKind: "emulate",
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

export async function targetClickAt(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  x?: number;
  y?: number;
  button?: string;
  clickCount?: number;
}): Promise<TargetClickAtReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const x = parseClickCoordinate(opts.x, "x");
  const y = parseClickCoordinate(opts.y, "y");
  const button = parseClickButton(opts.button);
  const clickCount = parseClickCount(opts.clickCount);

  const { session } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, { timeout: opts.timeoutMs });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    await target.page.mouse.click(x, y, {
      button,
      clickCount,
    });

    await target.page
      .waitForLoadState("domcontentloaded", {
        timeout: Math.max(200, Math.min(1000, opts.timeoutMs)),
      })
      .catch(() => {
        // Not all coordinate clicks trigger navigation; this is best-effort only.
      });

    const actionCompletedAt = Date.now();
    const title = await target.page.title();
    const report: TargetClickAtReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      actionId: newActionId(),
      point: { x, y },
      button,
      clickCount,
      url: target.page.url(),
      title,
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
        lastActionKind: "click-at",
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

export async function targetScreenshot(opts: {
  targetId: string;
  timeoutMs: number;
  sessionId?: string;
  persistState?: boolean;
  outPath?: string;
  fullPage?: boolean;
  type?: string;
  quality?: number;
}): Promise<TargetScreenshotReport> {
  const startedAt = Date.now();
  const requestedTargetId = sanitizeTargetId(opts.targetId);
  const outPath = parseScreenshotOutPath(opts.outPath);
  const type = parseScreenshotType(opts.type);
  const quality =
    type === "jpeg" ? parseOptionalInt(opts.quality, "quality", 0, 100) : null;
  if (type === "png" && typeof opts.quality !== "undefined") {
    throw new CliError("E_QUERY_INVALID", "quality is only supported when type=jpeg");
  }

  const { session } = await resolveSessionForAction({
    sessionHint: opts.sessionId,
    timeoutMs: opts.timeoutMs,
    targetIdHint: requestedTargetId,
  });
  const resolvedSessionAt = Date.now();
  const browser = await chromium.connectOverCDP(session.cdpOrigin, { timeout: opts.timeoutMs });
  const connectedAt = Date.now();

  try {
    const target = await resolveTargetHandle(browser, requestedTargetId);
    const { fs, path } = providers();
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const cdp = await openCdpSession(target.page);
    const metrics = (await cdp.send("Page.getLayoutMetrics")) as {
      contentSize?: { x?: number; y?: number; width?: number; height?: number };
      visualViewport?: { clientWidth?: number; clientHeight?: number; scale?: number };
      layoutViewport?: { clientWidth?: number; clientHeight?: number; scale?: number };
    };
    const contentWidth = Math.max(0, Number(metrics.contentSize?.width ?? 0));
    const contentHeight = Math.max(0, Number(metrics.contentSize?.height ?? 0));
    const viewportWidth = Math.max(
      0,
      Number(metrics.visualViewport?.clientWidth ?? metrics.layoutViewport?.clientWidth ?? 0),
    );
    const viewportHeight = Math.max(
      0,
      Number(metrics.visualViewport?.clientHeight ?? metrics.layoutViewport?.clientHeight ?? 0),
    );

    if (Boolean(opts.fullPage) && (contentWidth <= 0 || contentHeight <= 0)) {
      throw new CliError("E_INTERNAL", "Unable to capture fullPage screenshot (layout metrics returned 0 size)");
    }
    if (!Boolean(opts.fullPage) && (viewportWidth <= 0 || viewportHeight <= 0)) {
      throw new CliError("E_INTERNAL", "Unable to capture screenshot (viewport metrics returned 0 size)");
    }

    const capture = (await cdp.send("Page.captureScreenshot", {
      format: type,
      quality: quality ?? undefined,
      fromSurface: true,
      captureBeyondViewport: Boolean(opts.fullPage),
      clip: Boolean(opts.fullPage)
        ? {
            x: 0,
            y: 0,
            width: contentWidth,
            height: contentHeight,
            scale: 1,
          }
        : undefined,
    })) as { data?: string };

    const base64 = capture.data;
    if (typeof base64 !== "string" || base64.length === 0) {
      throw new CliError("E_INTERNAL", "CDP did not return screenshot data");
    }
    const screenshot = Buffer.from(base64, "base64");
    fs.writeFileSync(outPath, screenshot);
    const actionCompletedAt = Date.now();
    const sha256 = providers().crypto.createHash("sha256").update(screenshot).digest("hex");

    const report: TargetScreenshotReport = {
      ok: true,
      sessionId: session.sessionId,
      targetId: requestedTargetId,
      path: outPath,
      fullPage: Boolean(opts.fullPage),
      type,
      width: Math.round(Boolean(opts.fullPage) ? contentWidth : viewportWidth),
      height: Math.round(Boolean(opts.fullPage) ? contentHeight : viewportHeight),
      bytes: screenshot.byteLength,
      sha256,
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
        lastActionAt: nowIso(),
        lastActionKind: "screenshot",
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
