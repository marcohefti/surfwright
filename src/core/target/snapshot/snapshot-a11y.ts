import type { CDPSession, Page } from "playwright-core";
import { CliError } from "../../errors.js";
import { nowIso, saveTargetSnapshot } from "../../state/index.js";
import type { SessionSource, TargetSnapshotReport } from "../../types.js";
import { safePageTitle } from "../infra/utils/safe-page-title.js";
import { encodeBackendNodeHandle } from "../infra/utils/element-handle.js";

type SnapshotCursor = { ax: number };

function formatA11yCursor(cursor: SnapshotCursor): string {
  return `ax=${cursor.ax}`;
}

export async function targetSnapshotA11y(opts: {
  startedAt: number;
  resolvedSessionAt: number;
  connectedAt: number;
  timeoutMs: number;
  sessionId: string;
  sessionSource: SessionSource;
  targetId: string;
  page: Page;
  cdp: CDPSession;
  selectorQuery: string | null;
  visibleOnly: boolean;
  frameScope: "main" | "all";
  cursorTokenProvided: boolean;
  cursorAx: number;
  maxAxRows: number;
  hints: string[];
  persistState: boolean;
}): Promise<TargetSnapshotReport> {
  await opts.cdp.send("DOM.enable").catch(() => {});
  await opts.cdp.send("Accessibility.enable").catch(() => {});

  let scopeMatched = opts.selectorQuery === null;
  let scopeNodeId: number | null = null;
  if (opts.selectorQuery) {
    try {
      const doc = (await opts.cdp.send("DOM.getDocument", { depth: 0, pierce: true })) as { root?: { nodeId?: number } };
      const rootNodeId = typeof doc?.root?.nodeId === "number" ? doc.root.nodeId : null;
      if (rootNodeId !== null) {
        const q = (await opts.cdp.send("DOM.querySelector", { nodeId: rootNodeId, selector: opts.selectorQuery })) as { nodeId?: number };
        if (typeof q?.nodeId === "number" && q.nodeId > 0) {
          scopeNodeId = q.nodeId;
          scopeMatched = true;
        }
      }
    } catch {
      // Selector scoping is best-effort for a11y mode.
    }
  }

  let axNodes: any[] = [];
  let usedPartial = false;
  if (scopeNodeId !== null) {
    try {
      const partial = (await opts.cdp.send("Accessibility.getPartialAXTree", {
        nodeId: scopeNodeId,
        fetchRelatives: false,
      })) as { nodes?: any[] };
      if (Array.isArray(partial?.nodes)) {
        axNodes = partial.nodes;
        usedPartial = true;
      }
    } catch {
      // Not all Chrome versions expose getPartialAXTree. Fall back to full tree.
    }
  }
  if (axNodes.length === 0) {
    const full = (await opts.cdp.send("Accessibility.getFullAXTree").catch(() => ({ nodes: [] }))) as { nodes?: any[] };
    axNodes = Array.isArray(full?.nodes) ? full.nodes : [];
    if (scopeNodeId !== null && !usedPartial) {
      opts.hints.push("a11y selector scoping unavailable; returned full accessibility tree");
    }
  }

  const normalize = (value: string): string => value.replace(/\\s+/g, " ").trim();
  const roleOf = (node: any): string => normalize(String(node?.role?.value ?? node?.role ?? "")).toLowerCase();
  const nameOf = (node: any): string => normalize(String(node?.name?.value ?? node?.name ?? ""));
  const valueOf = (node: any): string => normalize(String(node?.value?.value ?? node?.value ?? ""));
  const descOf = (node: any): string => normalize(String(node?.description?.value ?? node?.description ?? ""));
  const backendIdOf = (node: any): number | null =>
    typeof node?.backendDOMNodeId === "number" && node.backendDOMNodeId > 0 ? node.backendDOMNodeId : null;

  const includeRoles = new Set([
    "button",
    "link",
    "heading",
    "textbox",
    "combobox",
    "checkbox",
    "radio",
    "switch",
    "tab",
    "menuitem",
    "option",
  ]);

  const byId = new Map<string, any>();
  const childIdSet = new Set<string>();
  for (const node of axNodes) {
    const id = typeof node?.nodeId === "string" ? node.nodeId : "";
    if (!id) continue;
    byId.set(id, node);
    const childIds = Array.isArray(node?.childIds) ? node.childIds : [];
    for (const childId of childIds) {
      if (typeof childId === "string") {
        childIdSet.add(childId);
      }
    }
  }

  const candidateRoots = [...byId.keys()].filter((id) => !childIdSet.has(id));
  const rootWebAreas = candidateRoots.filter((id) => roleOf(byId.get(id)) === "rootwebarea");
  const rootId = (rootWebAreas.length > 0 ? rootWebAreas : candidateRoots).sort((a, b) => a.localeCompare(b))[0] ?? "";

  type A11yRow = NonNullable<TargetSnapshotReport["a11y"]>["rows"][number];
  const allRows: A11yRow[] = [];
  const visited = new Set<string>();
  const walk = (id: string, depth: number) => {
    if (!id || visited.has(id)) return;
    visited.add(id);
    const node = byId.get(id);
    if (!node) return;
    if (node?.ignored !== true) {
      const role = roleOf(node);
      const name = nameOf(node);
      const backend = backendIdOf(node);
      if ((includeRoles.has(role) && name.length > 0) || backend !== null) {
        const handle = backend !== null ? encodeBackendNodeHandle(backend) : null;
        const value = valueOf(node);
        const description = descOf(node);
        allRows.push({
          index: allRows.length,
          depth,
          role: role || "unknown",
          name,
          handle,
          ...(value.length > 0 ? { value } : {}),
          ...(description.length > 0 ? { description } : {}),
        });
      }
    }
    const childIds = Array.isArray(node?.childIds) ? node.childIds : [];
    const sortedChildren = childIds
      .filter((cid: any) => typeof cid === "string")
      .sort((a: string, b: string) => a.localeCompare(b));
    for (const childId of sortedChildren) {
      walk(childId, depth + 1);
    }
  };

  if (rootId) {
    walk(rootId, 0);
  } else {
    for (const id of [...byId.keys()].sort((a, b) => a.localeCompare(b))) {
      walk(id, 0);
    }
  }

  if (opts.cursorAx < 0 || !Number.isFinite(opts.cursorAx) || !Number.isInteger(opts.cursorAx)) {
    throw new CliError("E_QUERY_INVALID", "ax cursor offset must be a non-negative integer");
  }

  const pageRows = allRows.slice(opts.cursorAx, opts.cursorAx + opts.maxAxRows).map((row, idx) => ({
    ...row,
    index: opts.cursorAx + idx,
  }));

  const nextCursor =
    opts.cursorAx + pageRows.length < allRows.length
      ? formatA11yCursor({ ax: opts.cursorAx + pageRows.length })
      : null;

  const actionCompletedAt = Date.now();
  const report: TargetSnapshotReport = {
    ok: true,
    sessionId: opts.sessionId,
    sessionSource: opts.sessionSource,
    targetId: opts.targetId,
    mode: "a11y",
    cursor: opts.cursorTokenProvided ? formatA11yCursor({ ax: opts.cursorAx }) : null,
    nextCursor,
    url: opts.page.url(),
    title: await safePageTitle(opts.page, opts.timeoutMs),
    scope: {
      selector: opts.selectorQuery,
      matched: scopeMatched,
      visibleOnly: opts.visibleOnly,
      frameScope: opts.frameScope,
    },
    textPreview: "",
    headings: [],
    buttons: [],
    links: [],
    truncated: {
      text: false,
      headings: false,
      buttons: false,
      links: false,
    },
    a11y: {
      total: allRows.length,
      rows: pageRows,
      truncated: nextCursor !== null,
    },
    hints: opts.hints,
    timingMs: {
      total: 0,
      resolveSession: opts.resolvedSessionAt - opts.startedAt,
      connectCdp: opts.connectedAt - opts.resolvedSessionAt,
      action: actionCompletedAt - opts.connectedAt,
      persistState: 0,
    },
  };

  const persistStartedAt = Date.now();
  if (opts.persistState) {
    await saveTargetSnapshot({
      targetId: report.targetId,
      sessionId: report.sessionId,
      url: report.url,
      title: report.title,
      status: null,
      lastActionAt: nowIso(),
      lastActionKind: "snapshot",
      updatedAt: nowIso(),
    });
  }
  const persistedAt = Date.now();
  report.timingMs.persistState = persistedAt - persistStartedAt;
  report.timingMs.total = persistedAt - opts.startedAt;

  return report;
}
