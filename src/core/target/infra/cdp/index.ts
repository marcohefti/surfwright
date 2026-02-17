import type { CDPSession, Page } from "playwright-core";
import { CliError } from "../../../errors.js";
import type { FrameEntry } from "../../frames/frames.js";

type CdpFrame = {
  id: string;
  parentId?: string;
  url: string;
  name?: string;
  securityOrigin?: string;
};

export type CdpFrameTree = {
  frame: CdpFrame;
  childFrames?: CdpFrameTree[];
};

export type CdpFrameListingEntry = FrameEntry & {
  cdpFrameId: string;
};

const SURFWRIGHT_WORLD_NAME = "surfwright";

export type CdpEvaluator = {
  evaluate<T>(pageFunction: () => T): Promise<T>;
  evaluate<T, Arg>(pageFunction: (arg: Arg) => T, arg: Arg): Promise<T>;
};

type ExecutionContextCreatedPayload = {
  context?: {
    id?: number;
    auxData?: { frameId?: string; isDefault?: boolean };
  };
};

function recordMainWorldContext(payload: ExecutionContextCreatedPayload, cache: Map<string, number>): void {
  const ctx = payload?.context;
  const id = ctx?.id;
  const aux = ctx?.auxData;
  if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) {
    return;
  }
  const frameId = aux?.frameId;
  if (typeof frameId !== "string" || frameId.length === 0) {
    return;
  }
  if (aux?.isDefault !== true) {
    return;
  }
  cache.set(frameId, id);
}

function stringifyArgOrThrow(arg: unknown): string {
  try {
    const json = JSON.stringify(arg);
    return typeof json === "string" ? json : "undefined";
  } catch {
    throw new CliError("E_QUERY_INVALID", "evaluation arg must be JSON-serializable");
  }
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function sortedChildFrames(node: CdpFrameTree): CdpFrameTree[] {
  const children = node.childFrames ?? [];
  return children.slice().sort((a, b) => {
    const urlCmp = (a.frame.url ?? "").localeCompare(b.frame.url ?? "");
    if (urlCmp !== 0) {
      return urlCmp;
    }
    const nameA = a.frame.name ?? "";
    const nameB = b.frame.name ?? "";
    return nameA.localeCompare(nameB);
  });
}

function countFrameTree(node: CdpFrameTree): number {
  let count = 1;
  for (const child of node.childFrames ?? []) {
    count += countFrameTree(child);
  }
  return count;
}

export async function openCdpSession(page: Page, opts?: { mainWorldCache?: Map<string, number> }): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  if (opts?.mainWorldCache) {
    // Capture main-world contexts during Runtime.enable so callers can deterministically
    // evaluate in the page's default realm without racing executionContextCreated.
    cdp.on("Runtime.executionContextCreated", ((payload: ExecutionContextCreatedPayload) => {
      recordMainWorldContext(payload, opts.mainWorldCache as Map<string, number>);
    }) as never);
  }
  // Idempotent enables are fine and keep callers simple.
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  return cdp;
}

export async function getCdpFrameTree(cdp: CDPSession): Promise<CdpFrameTree> {
  const payload = (await cdp.send("Page.getFrameTree")) as { frameTree?: CdpFrameTree };
  const root = payload.frameTree;
  if (!root || !root.frame || typeof root.frame.id !== "string") {
    throw new CliError("E_INTERNAL", "CDP did not return a frame tree");
  }
  return root;
}

export function listCdpFrameEntries(opts: { frameTree: CdpFrameTree; limit: number }): {
  count: number;
  entries: CdpFrameListingEntry[];
  truncated: boolean;
} {
  const count = countFrameTree(opts.frameTree);
  const entries: CdpFrameListingEntry[] = [];
  const mainOrigin = safeOrigin(opts.frameTree.frame.url);

  let index = 0;
  const walk = (node: CdpFrameTree, parentFrameId: string | null, depth: number) => {
    if (entries.length >= opts.limit) {
      return;
    }
    const stableFrameId = `f-${index}`;
    index += 1;
    const url = node.frame.url ?? "";
    const origin = safeOrigin(url);
    const sameOrigin = mainOrigin !== null && origin !== null && origin === mainOrigin;
    entries.push({
      frameId: stableFrameId,
      parentFrameId,
      depth,
      isMain: parentFrameId === null,
      sameOrigin,
      url,
      name: node.frame.name ?? null,
      cdpFrameId: node.frame.id,
    });
    for (const child of sortedChildFrames(node)) {
      walk(child, stableFrameId, depth + 1);
      if (entries.length >= opts.limit) {
        return;
      }
    }
  };

  walk(opts.frameTree, null, 0);
  return {
    count,
    entries,
    truncated: count > entries.length,
  };
}

export function resolveCdpFrameByStableId(opts: {
  frameTree: CdpFrameTree;
  stableFrameIdInput: string | undefined;
}): { entry: CdpFrameListingEntry; frameCount: number } {
  const stable = typeof opts.stableFrameIdInput === "string" && opts.stableFrameIdInput.trim().length > 0 ? opts.stableFrameIdInput.trim() : "f-0";
  const match = /^f-(\d+)$/.exec(stable);
  if (!match) {
    throw new CliError("E_QUERY_INVALID", "frame-id must match f-<n> (e.g. f-0)");
  }
  const desiredIndex = Number.parseInt(match[1], 10);
  if (!Number.isFinite(desiredIndex) || desiredIndex < 0) {
    throw new CliError("E_QUERY_INVALID", "frame-id must match f-<n> (e.g. f-0)");
  }

  const listing = listCdpFrameEntries({ frameTree: opts.frameTree, limit: Number.MAX_SAFE_INTEGER });
  const picked = listing.entries[desiredIndex];
  if (!picked) {
    throw new CliError("E_QUERY_INVALID", `frame-id not found: f-${desiredIndex}`);
  }
  return {
    entry: picked,
    frameCount: listing.count,
  };
}

export function frameIdsForScope(opts: { frameTree: CdpFrameTree; scope: "main" | "all" }): string[] {
  if (opts.scope === "main") {
    return [opts.frameTree.frame.id];
  }
  const ids: string[] = [];
  const walk = (node: CdpFrameTree) => {
    ids.push(node.frame.id);
    for (const child of sortedChildFrames(node)) {
      walk(child);
    }
  };
  walk(opts.frameTree);
  return ids;
}

export async function createIsolatedWorldContext(opts: {
  cdp: CDPSession;
  frameCdpId: string;
  cache: Map<string, number>;
}): Promise<number> {
  const cached = opts.cache.get(opts.frameCdpId);
  if (typeof cached === "number") {
    return cached;
  }
  const payload = (await opts.cdp.send("Page.createIsolatedWorld", {
    frameId: opts.frameCdpId,
    worldName: SURFWRIGHT_WORLD_NAME,
  })) as { executionContextId?: number };
  const contextId = payload.executionContextId;
  if (typeof contextId !== "number" || !Number.isFinite(contextId) || contextId <= 0) {
    throw new CliError("E_INTERNAL", "CDP did not return an executionContextId");
  }
  opts.cache.set(opts.frameCdpId, contextId);
  return contextId;
}

export async function ensureMainWorldContextId(opts: {
  cdp: CDPSession;
  frameCdpId: string;
  cache: Map<string, number>;
  timeoutMs: number;
}): Promise<number> {
  const cached = opts.cache.get(opts.frameCdpId);
  if (typeof cached === "number") {
    return cached;
  }

  // Runtime/Page enables are idempotent and may trigger executionContextCreated emissions.
  const onCreatedTimeoutMs = Math.max(150, Math.min(1200, opts.timeoutMs));
  const deadline = Date.now() + onCreatedTimeoutMs;

  let found: number | null = null;
  const onCreated = (payload: ExecutionContextCreatedPayload) => {
    const ctx = payload?.context;
    const id = ctx?.id;
    const aux = ctx?.auxData;
    if (typeof id !== "number" || !Number.isFinite(id) || id <= 0) {
      return;
    }
    if (aux?.frameId !== opts.frameCdpId) {
      return;
    }
    if (aux?.isDefault !== true) {
      return;
    }
    found = id;
  };

  opts.cdp.on("Runtime.executionContextCreated", onCreated as never);
  try {
    await opts.cdp.send("Page.enable").catch(() => {});
    await opts.cdp.send("Runtime.enable").catch(() => {});
    while (found === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } finally {
    opts.cdp.off("Runtime.executionContextCreated", onCreated as never);
  }

  if (found === null) {
    throw new CliError("E_INTERNAL", "Timed out waiting for main world execution context");
  }
  opts.cache.set(opts.frameCdpId, found);
  return found;
}

export async function evalJsonInContext<T>(opts: { cdp: CDPSession; contextId: number; expression: string }): Promise<T> {
  const payload = (await opts.cdp.send("Runtime.evaluate", {
    expression: opts.expression,
    contextId: opts.contextId,
    returnByValue: true,
    awaitPromise: true,
  })) as {
    result?: { value?: unknown };
    exceptionDetails?: { text?: string; exception?: { value?: unknown; description?: string } };
  };

  if (payload.exceptionDetails) {
    const text = typeof payload.exceptionDetails.text === "string" ? payload.exceptionDetails.text.trim() : "";
    const description =
      typeof payload.exceptionDetails.exception?.description === "string"
        ? payload.exceptionDetails.exception.description.trim()
        : "";
    const message = (description || text || "evaluation failed").slice(0, 240);
    throw new CliError("E_EVAL_RUNTIME", message);
  }

  return (payload.result?.value ?? null) as T;
}

export async function evalJsonInFrame<T>(opts: {
  cdp: CDPSession;
  frameCdpId: string;
  worldCache: Map<string, number>;
  expression: string;
}): Promise<T> {
  const contextId = await createIsolatedWorldContext({
    cdp: opts.cdp,
    frameCdpId: opts.frameCdpId,
    cache: opts.worldCache,
  });
  return await evalJsonInContext<T>({
    cdp: opts.cdp,
    contextId,
    expression: opts.expression,
  });
}

export async function evalJsonInMainWorldFrame<T>(opts: {
  cdp: CDPSession;
  frameCdpId: string;
  mainWorldCache: Map<string, number>;
  timeoutMs: number;
  expression: string;
}): Promise<T> {
  const contextId = await ensureMainWorldContextId({
    cdp: opts.cdp,
    frameCdpId: opts.frameCdpId,
    cache: opts.mainWorldCache,
    timeoutMs: opts.timeoutMs,
  });
  return await evalJsonInContext<T>({
    cdp: opts.cdp,
    contextId,
    expression: opts.expression,
  });
}

export function createCdpEvaluator(opts: {
  cdp: CDPSession;
  frameCdpId: string;
  worldCache: Map<string, number>;
}): CdpEvaluator {
  async function evaluate<T, Arg>(pageFunction: (arg: Arg) => T, arg?: Arg): Promise<T> {
    // Playwright normally serializes a function + arg and runs it in the page.
    // We do the same over CDP, but force an isolated world in the desired frame
    // to avoid Playwright realm binding bugs on OOPIF/third-party iframes.
    const fnText = pageFunction.toString();
    const expression =
      arguments.length >= 2
        ? `(${fnText})(${stringifyArgOrThrow(arg)})`
        : `(${fnText})()`;
    return await evalJsonInFrame<T>({
      cdp: opts.cdp,
      frameCdpId: opts.frameCdpId,
      worldCache: opts.worldCache,
      expression,
    });
  }

  return { evaluate } as CdpEvaluator;
}

export function createCdpMainWorldEvaluator(opts: {
  cdp: CDPSession;
  frameCdpId: string;
  mainWorldCache: Map<string, number>;
  timeoutMs: number;
}): CdpEvaluator {
  async function evaluate<T, Arg>(pageFunction: (arg: Arg) => T, arg?: Arg): Promise<T> {
    const fnText = pageFunction.toString();
    const expression =
      arguments.length >= 2
        ? `(${fnText})(${stringifyArgOrThrow(arg)})`
        : `(${fnText})()`;
    return await evalJsonInMainWorldFrame<T>({
      cdp: opts.cdp,
      frameCdpId: opts.frameCdpId,
      mainWorldCache: opts.mainWorldCache,
      timeoutMs: opts.timeoutMs,
      expression,
    });
  }
  return { evaluate } as CdpEvaluator;
}

export async function ensureValidSelectorSyntaxCdp(opts: {
  cdp: CDPSession;
  frameCdpId: string;
  worldCache: Map<string, number>;
  selectorQuery: string;
}): Promise<void> {
  const payload = await evalJsonInFrame<{
    ok: boolean;
    errorName?: string;
  }>({
    cdp: opts.cdp,
    frameCdpId: opts.frameCdpId,
    worldCache: opts.worldCache,
    expression: `(() => {
      try {
        document.querySelector(${JSON.stringify(opts.selectorQuery)});
        return { ok: true };
      } catch (err) {
        return { ok: false, errorName: (err && typeof err.name === "string" ? err.name : "Error") };
      }
    })()`,
  });
  if (!payload.ok) {
    throw new CliError("E_SELECTOR_INVALID", `Invalid selector query: ${opts.selectorQuery}`);
  }
}
