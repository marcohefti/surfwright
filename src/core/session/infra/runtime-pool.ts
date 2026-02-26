import type { Browser } from "playwright-core";
import { createNoopDaemonDiagnostics, type DaemonDiagnostics } from "../../daemon/domain/diagnostics.js";

export const SESSION_RUNTIME_POOL_MAX_ENTRIES_DEFAULT = 64;
export const SESSION_RUNTIME_TIMEOUT_HARD_CLOSE_THRESHOLD_DEFAULT = 2;

export type SessionRuntimePoolState = "absent" | "warming" | "ready" | "degraded" | "draining" | "closed";

export class SessionRuntimePoolError extends Error {
  code: "E_RUNTIME_POOL_SESSION_MISMATCH" | "E_RUNTIME_POOL_WARM_FAILED";

  constructor(code: "E_RUNTIME_POOL_SESSION_MISMATCH" | "E_RUNTIME_POOL_WARM_FAILED", message: string) {
    super(message);
    this.code = code;
    this.name = "SessionRuntimePoolError";
  }
}

export type SessionRuntimePoolLease = {
  key: string;
  sessionId: string;
  cdpOrigin: string;
  pooled: boolean;
  browser: Browser;
  release: () => Promise<void>;
};

type RuntimeEntry = {
  key: string;
  sessionId: string;
  cdpOrigin: string;
  state: SessionRuntimePoolState;
  browser: Browser | null;
  borrowCount: number;
  timeoutStrikes: number;
  lastUsedAt: number;
  warmingPromise: Promise<void> | null;
};

type ConnectFn = (input: { cdpOrigin: string; timeoutMs: number }) => Promise<Browser>;

function allowedTransition(from: SessionRuntimePoolState, to: SessionRuntimePoolState): boolean {
  const key = `${from}->${to}`;
  return (
    key === "absent->warming" ||
    key === "warming->ready" ||
    key === "warming->absent" ||
    key === "ready->degraded" ||
    key === "degraded->warming" ||
    key === "degraded->closed" ||
    key === "ready->draining" ||
    key === "degraded->draining" ||
    key === "draining->closed" ||
    key === "closed->absent"
  );
}

function poolKey(sessionId: string): string {
  return `session:${sessionId}`;
}

function sessionAuthority(input: { sessionId?: string; cdpOrigin: string }): string {
  const sessionId = (input.sessionId ?? "").trim();
  if (sessionId.length > 0) {
    return sessionId;
  }
  return `origin:${input.cdpOrigin}`;
}

export function createSessionRuntimePool(opts: {
  connect: ConnectFn;
  diagnostics?: DaemonDiagnostics;
  maxEntries?: number;
  timeoutHardCloseThreshold?: number;
  now?: () => number;
}) {
  const connect = opts.connect;
  const diagnostics = opts.diagnostics ?? createNoopDaemonDiagnostics();
  const maxEntries = opts.maxEntries ?? SESSION_RUNTIME_POOL_MAX_ENTRIES_DEFAULT;
  const timeoutHardCloseThreshold = opts.timeoutHardCloseThreshold ?? SESSION_RUNTIME_TIMEOUT_HARD_CLOSE_THRESHOLD_DEFAULT;
  const now = opts.now ?? (() => Date.now());

  const entries = new Map<string, RuntimeEntry>();

  const metric = (metricName: string, value: number, tags?: Record<string, string>) => {
    diagnostics.emitMetric({
      ts: new Date().toISOString(),
      metric: metricName,
      value,
      ...(tags ? { tags } : {}),
    });
  };

  const transition = (entry: RuntimeEntry, next: SessionRuntimePoolState) => {
    if (entry.state === next) {
      return;
    }
    if (!allowedTransition(entry.state, next)) {
      throw new Error(`Invalid runtime pool transition: ${entry.state} -> ${next}`);
    }
    entry.state = next;
  };

  const finalizeClosedEntry = (entry: RuntimeEntry) => {
    transition(entry, "closed");
    entry.browser = null;
    entry.warmingPromise = null;
    transition(entry, "absent");
    entries.delete(entry.key);
  };

  const closeDrainingEntryIfIdle = async (entry: RuntimeEntry) => {
    if (entry.state !== "draining" || entry.borrowCount > 0) {
      return;
    }
    const browser = entry.browser;
    if (browser) {
      await browser.close();
    }
    finalizeClosedEntry(entry);
  };

  const chooseIdleLruEvictionCandidate = (): RuntimeEntry | null => {
    let candidate: RuntimeEntry | null = null;
    for (const entry of entries.values()) {
      if (entry.state !== "ready") {
        continue;
      }
      if (entry.borrowCount > 0) {
        continue;
      }
      if (!candidate || entry.lastUsedAt < candidate.lastUsedAt) {
        candidate = entry;
      }
    }
    return candidate;
  };

  const evictIdleLruEntry = async (): Promise<boolean> => {
    const candidate = chooseIdleLruEvictionCandidate();
    if (!candidate) {
      metric("daemon_runtime_pool_overflow_total", 1, { reason: "all_busy" });
      return false;
    }
    transition(candidate, "draining");
    await closeDrainingEntryIfIdle(candidate);
    metric("daemon_runtime_pool_evictions_total", 1, { reason: "lru" });
    return true;
  };

  const ensureWarmEntry = async (entry: RuntimeEntry, timeoutMs: number): Promise<void> => {
    if (entry.state === "ready" && entry.browser) {
      return;
    }
    if (entry.state === "warming" && entry.warmingPromise) {
      await entry.warmingPromise;
      return;
    }
    const reconnect = entry.state === "degraded";
    if (reconnect) {
      metric("daemon_pool_reconnect_attempt", 1);
    }
    if (entry.state === "degraded") {
      transition(entry, "warming");
    } else if (entry.state === "closed") {
      transition(entry, "absent");
      transition(entry, "warming");
    } else if (entry.state === "absent") {
      transition(entry, "warming");
    } else if (entry.state !== "warming") {
      throw new Error(`Cannot warm runtime entry from state ${entry.state}`);
    }

    entry.warmingPromise = (async () => {
      try {
        const warmed = await connect({
          cdpOrigin: entry.cdpOrigin,
          timeoutMs,
        });
        entry.browser = warmed;
        entry.timeoutStrikes = 0;
        transition(entry, "ready");
        if (reconnect) {
          metric("daemon_pool_reconnect_success", 1);
        }
      } catch (error) {
        if (entry.state === "warming") {
          transition(entry, "absent");
          entries.delete(entry.key);
        } else if (entry.state === "degraded") {
          transition(entry, "closed");
          transition(entry, "absent");
          entries.delete(entry.key);
        }
        throw new SessionRuntimePoolError("E_RUNTIME_POOL_WARM_FAILED", `runtime warm failed: ${String(error)}`);
      } finally {
        entry.warmingPromise = null;
      }
    })();

    await entry.warmingPromise;
  };

  const entryLease = (entry: RuntimeEntry): SessionRuntimePoolLease => {
    if (!entry.browser) {
      throw new Error("runtime entry missing browser for lease");
    }
    entry.borrowCount += 1;
    entry.lastUsedAt = now();
    let released = false;
    return {
      key: entry.key,
      sessionId: entry.sessionId,
      cdpOrigin: entry.cdpOrigin,
      pooled: true,
      browser: entry.browser,
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        entry.borrowCount = Math.max(0, entry.borrowCount - 1);
        entry.lastUsedAt = now();
        await closeDrainingEntryIfIdle(entry);
      },
    };
  };

  const uncachedLease = async (input: { sessionId: string; cdpOrigin: string; timeoutMs: number }): Promise<SessionRuntimePoolLease> => {
    metric("daemon_runtime_pool_overflow_total", 1, { reason: "all_busy_uncached" });
    const browser = await connect({
      cdpOrigin: input.cdpOrigin,
      timeoutMs: input.timeoutMs,
    });
    let released = false;
    return {
      key: poolKey(input.sessionId),
      sessionId: input.sessionId,
      cdpOrigin: input.cdpOrigin,
      pooled: false,
      browser,
      release: async () => {
        if (released) {
          return;
        }
        released = true;
        await browser.close();
      },
    };
  };

  const acquire = async (input: {
    sessionId?: string;
    cdpOrigin: string;
    timeoutMs: number;
  }): Promise<SessionRuntimePoolLease> => {
    const sessionId = sessionAuthority({
      sessionId: input.sessionId,
      cdpOrigin: input.cdpOrigin,
    });
    const key = poolKey(sessionId);
    let entry = entries.get(key);

    if (entry) {
      if (entry.sessionId !== sessionId || entry.cdpOrigin !== input.cdpOrigin) {
        metric("daemon_session_isolation_breaks_total", 1);
        throw new SessionRuntimePoolError(
          "E_RUNTIME_POOL_SESSION_MISMATCH",
          "runtime pool key mismatch between requested and cached session authority",
        );
      }
      if (entry.state === "ready" && entry.browser) {
        metric("daemon_pool_cache_hit", 1);
        return entryLease(entry);
      }
      if (entry.state === "warming" && entry.warmingPromise) {
        await entry.warmingPromise;
        return entryLease(entry);
      }
      if (entry.state === "degraded") {
        try {
          await ensureWarmEntry(entry, input.timeoutMs);
          return entryLease(entry);
        } catch (error) {
          transition(entry, "closed");
          finalizeClosedEntry(entry);
          throw error;
        }
      }
      if (entry.state === "draining") {
        metric("daemon_pool_cache_miss", 1);
        return await uncachedLease({
          sessionId,
          cdpOrigin: input.cdpOrigin,
          timeoutMs: input.timeoutMs,
        });
      }
      if (entry.state === "closed") {
        finalizeClosedEntry(entry);
      }
    }

    if (entries.size >= maxEntries) {
      const evicted = await evictIdleLruEntry();
      if (!evicted) {
        metric("daemon_pool_cache_miss", 1);
        return await uncachedLease({
          sessionId,
          cdpOrigin: input.cdpOrigin,
          timeoutMs: input.timeoutMs,
        });
      }
    }

    entry = {
      key,
      sessionId,
      cdpOrigin: input.cdpOrigin,
      state: "absent",
      browser: null,
      borrowCount: 0,
      timeoutStrikes: 0,
      lastUsedAt: now(),
      warmingPromise: null,
    };
    entries.set(key, entry);
    metric("daemon_pool_cache_miss", 1);
    await ensureWarmEntry(entry, input.timeoutMs);
    return entryLease(entry);
  };

  const handleTimeout = async (input: {
    key: string;
    bestEffortCancel?: () => Promise<boolean>;
  }) => {
    const entry = entries.get(input.key);
    if (!entry) {
      return;
    }
    if (entry.state === "ready") {
      transition(entry, "degraded");
    }
    entry.timeoutStrikes += 1;

    let cancelled = false;
    try {
      cancelled = input.bestEffortCancel ? await input.bestEffortCancel() : false;
    } catch {
      cancelled = false;
    }

    if (!cancelled) {
      if (entry.state === "ready") {
        transition(entry, "draining");
      } else if (entry.state === "degraded") {
        transition(entry, "draining");
      }
      metric("daemon_pool_forced_reset", 1, { reason: "cancel_unresolved" });
      await closeDrainingEntryIfIdle(entry);
    }

    if (entry.timeoutStrikes >= timeoutHardCloseThreshold) {
      if (entry.state === "ready") {
        transition(entry, "draining");
      } else if (entry.state === "degraded") {
        transition(entry, "closed");
        finalizeClosedEntry(entry);
        metric("daemon_pool_forced_reset", 1, { reason: "timeout_threshold" });
        return;
      }
      metric("daemon_pool_forced_reset", 1, { reason: "timeout_threshold" });
      await closeDrainingEntryIfIdle(entry);
    }
  };

  const drainColdEntriesOnMemoryPressure = async (maxToDrain = 1): Promise<number> => {
    const candidates = Array.from(entries.values())
      .filter((entry) => entry.state === "ready" && entry.borrowCount === 0)
      .sort((left, right) => left.lastUsedAt - right.lastUsedAt)
      .slice(0, Math.max(0, maxToDrain));

    let drained = 0;
    for (const entry of candidates) {
      transition(entry, "draining");
      await closeDrainingEntryIfIdle(entry);
      drained += 1;
      metric("daemon_runtime_pool_evictions_total", 1, { reason: "memory_pressure" });
    }
    return drained;
  };

  const withLease = async <T>(input: {
    sessionId?: string;
    cdpOrigin: string;
    timeoutMs: number;
    run: (lease: SessionRuntimePoolLease) => Promise<T>;
  }): Promise<T> => {
    const lease = await acquire({
      sessionId: input.sessionId,
      cdpOrigin: input.cdpOrigin,
      timeoutMs: input.timeoutMs,
    });
    try {
      return await input.run(lease);
    } finally {
      await lease.release();
    }
  };

  const snapshot = () =>
    Array.from(entries.values()).map((entry) => ({
      key: entry.key,
      sessionId: entry.sessionId,
      cdpOrigin: entry.cdpOrigin,
      state: entry.state,
      borrowCount: entry.borrowCount,
      timeoutStrikes: entry.timeoutStrikes,
      hasBrowser: Boolean(entry.browser),
      lastUsedAt: entry.lastUsedAt,
    }));

  return {
    acquire,
    withLease,
    handleTimeout,
    drainColdEntriesOnMemoryPressure,
    snapshot,
    defaults: {
      maxEntries,
      timeoutHardCloseThreshold,
    },
  };
}
