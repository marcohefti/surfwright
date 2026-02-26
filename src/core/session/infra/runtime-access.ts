import process from "node:process";
import { chromium, type Browser } from "playwright-core";
import { createSessionRuntimePool } from "./runtime-pool.js";
import { createLocalDaemonDiagnostics } from "../../daemon/infra/diagnostics.js";

export type SessionBrowserHooks = {
  onAcquire?: (input: { sessionId: string; cdpOrigin: string }) => void | Promise<void>;
  onRelease?: (input: {
    sessionId: string;
    cdpOrigin: string;
    outcome: "ok" | "error";
    error?: unknown;
  }) => void | Promise<void>;
};

export type SessionBrowserLease = {
  sessionId: string;
  cdpOrigin: string;
  browser: Browser;
  release: (input?: { outcome?: "ok" | "error"; error?: unknown }) => Promise<void>;
};

const SESSION_RUNTIME_POOL = createSessionRuntimePool({
  diagnostics: createLocalDaemonDiagnostics(),
  connect: async ({ cdpOrigin, timeoutMs }) =>
    await chromium.connectOverCDP(cdpOrigin, {
      timeout: timeoutMs,
    }),
});

function poolingEnabledInThisProcess(): boolean {
  return process.argv.includes("__daemon-worker");
}

function browserProxyWithRelease(browser: Browser, release: () => Promise<void>): Browser {
  return new Proxy(browser as object, {
    get(target, prop, receiver) {
      if (prop === "close") {
        return async () => {
          await release();
        };
      }
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
  }) as Browser;
}

function normalizeConnectInput(
  cdpOriginOrInput:
    | string
    | {
        sessionId?: string;
        cdpOrigin: string;
        timeoutMs?: number;
        timeout?: number;
      },
  options?: {
    timeout?: number;
  },
): {
  sessionId?: string;
  cdpOrigin: string;
  timeoutMs: number;
} {
  if (typeof cdpOriginOrInput === "string") {
    return {
      cdpOrigin: cdpOriginOrInput,
      timeoutMs: options?.timeout ?? 30000,
    };
  }
  return {
    ...(typeof cdpOriginOrInput.sessionId === "string" ? { sessionId: cdpOriginOrInput.sessionId } : {}),
    cdpOrigin: cdpOriginOrInput.cdpOrigin,
    timeoutMs: cdpOriginOrInput.timeoutMs ?? cdpOriginOrInput.timeout ?? options?.timeout ?? 30000,
  };
}

export async function connectSessionBrowser(
  cdpOriginOrInput:
    | string
    | {
        sessionId?: string;
        cdpOrigin: string;
        timeoutMs?: number;
        timeout?: number;
      },
  options?: {
    timeout?: number;
  },
): Promise<Browser> {
  const normalized = normalizeConnectInput(cdpOriginOrInput, options);
  if (!poolingEnabledInThisProcess()) {
    return await chromium.connectOverCDP(normalized.cdpOrigin, {
      timeout: normalized.timeoutMs,
    });
  }
  const pooled = await SESSION_RUNTIME_POOL.acquire({
    ...(typeof normalized.sessionId === "string" ? { sessionId: normalized.sessionId } : {}),
    cdpOrigin: normalized.cdpOrigin,
    timeoutMs: normalized.timeoutMs,
  });
  return browserProxyWithRelease(pooled.browser, pooled.release);
}

export async function acquireSessionBrowser(opts: {
  sessionId: string;
  cdpOrigin: string;
  timeoutMs: number;
  hooks?: SessionBrowserHooks;
}): Promise<SessionBrowserLease> {
  const pooled = await SESSION_RUNTIME_POOL.acquire({
    sessionId: opts.sessionId,
    cdpOrigin: opts.cdpOrigin,
    timeoutMs: opts.timeoutMs,
  });
  await opts.hooks?.onAcquire?.({
    sessionId: opts.sessionId,
    cdpOrigin: opts.cdpOrigin,
  });

  let released = false;
  const release = async (input?: { outcome?: "ok" | "error"; error?: unknown }) => {
    if (released) {
      return;
    }
    released = true;
    const outcome = input?.outcome ?? "ok";
    const error = input?.error;
    try {
      await pooled.release();
    } finally {
      await opts.hooks?.onRelease?.({
        sessionId: opts.sessionId,
        cdpOrigin: opts.cdpOrigin,
        outcome,
        ...(typeof error === "undefined" ? {} : { error }),
      });
    }
  };
  const browser = browserProxyWithRelease(pooled.browser, release);

  return {
    sessionId: opts.sessionId,
    cdpOrigin: opts.cdpOrigin,
    browser,
    release,
  };
}

export async function withSessionBrowser<T>(opts: {
  sessionId: string;
  cdpOrigin: string;
  timeoutMs: number;
  hooks?: SessionBrowserHooks;
  run: (lease: SessionBrowserLease) => Promise<T>;
}): Promise<T> {
  const lease = await acquireSessionBrowser({
    sessionId: opts.sessionId,
    cdpOrigin: opts.cdpOrigin,
    timeoutMs: opts.timeoutMs,
    hooks: opts.hooks,
  });
  try {
    const result = await opts.run(lease);
    await lease.release({ outcome: "ok" });
    return result;
  } catch (error) {
    await lease.release({
      outcome: "error",
      error,
    });
    throw error;
  }
}
