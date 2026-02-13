import { CliError } from "./errors.js";

type EnsureSharedSession = (opts: { timeoutMs: number }) => Promise<{ sessionId: string }>;
type EnsureImplicitSession = (opts: { timeoutMs: number }) => Promise<{ session: { sessionId: string } }>;

export function parseIsolationMode(input: string | undefined): "isolated" | "shared" {
  if (typeof input === "undefined") {
    return "isolated";
  }
  const value = input.trim().toLowerCase();
  if (value === "isolated" || value === "shared") {
    return value;
  }
  throw new CliError("E_QUERY_INVALID", "isolation must be one of: isolated, shared");
}

export async function resolveOpenSessionHint(opts: {
  sessionId?: string;
  isolation?: string;
  timeoutMs: number;
  ensureSharedSession: EnsureSharedSession;
}): Promise<string | undefined> {
  const explicit = typeof opts.sessionId === "string" && opts.sessionId.length > 0 ? opts.sessionId : undefined;
  if (explicit) {
    return explicit;
  }
  const isolation = parseIsolationMode(opts.isolation);
  if (isolation === "shared") {
    const ensured = await opts.ensureSharedSession({
      timeoutMs: opts.timeoutMs,
    });
    return ensured.sessionId;
  }
  return undefined;
}

export async function resolvePipelineSessionId(opts: {
  sessionId?: string;
  isolation?: string;
  timeoutMs: number;
  ensureSharedSession: EnsureSharedSession;
  ensureImplicitSession: EnsureImplicitSession;
}): Promise<string> {
  let resolvedSessionId = opts.sessionId;
  const isolation = parseIsolationMode(opts.isolation);
  if ((typeof resolvedSessionId !== "string" || resolvedSessionId.length === 0) && isolation === "shared") {
    const ensured = await opts.ensureSharedSession({
      timeoutMs: opts.timeoutMs,
    });
    resolvedSessionId = ensured.sessionId;
  }
  if (typeof resolvedSessionId !== "string" || resolvedSessionId.length === 0) {
    const implicit = await opts.ensureImplicitSession({
      timeoutMs: opts.timeoutMs,
    });
    resolvedSessionId = implicit.session.sessionId;
  }
  return resolvedSessionId;
}
