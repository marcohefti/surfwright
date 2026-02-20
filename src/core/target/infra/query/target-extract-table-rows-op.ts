import type { BrowserNodeLike, BrowserRuntimeLike } from "../types/browser-dom-types.js";

export function targetExtractTableRowsOp(arg: {
  selectorQuery: string | null;
  visibleOnly: boolean;
  scanLimit: number;
  includeActionable: boolean;
  frameId: string;
}): {
  matched: boolean;
  items: Array<{
    title: string;
    url: string | null;
    summary: string | null;
    publishedAt: string | null;
    section?: string | null;
    record?: Record<string, string | null>;
    actionable?: {
      handle: string | null;
      selectorHint: string | null;
      frameId: string | null;
      href: string | null;
    };
  }>;
} {
  const runtime = globalThis as unknown as BrowserRuntimeLike;
  const doc = runtime.document;
  const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
  const isVisible = (node: BrowserNodeLike | null): boolean => {
    if (!node) {
      return false;
    }
    if (node.hasAttribute?.("hidden")) {
      return false;
    }
    const style = runtime.getComputedStyle?.(node);
    if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) {
      return false;
    }
    return (node.getClientRects?.().length ?? 0) > 0;
  };
  const selectorHintFor = (node: BrowserNodeLike | null): string | null => {
    const el = node;
    const classListRaw = typeof el?.className === "string" ? normalize(el.className) : "";
    const classSuffix =
      classListRaw.length > 0
        ? classListRaw
            .split(" ")
            .filter((entry) => entry.length > 0)
            .slice(0, 2)
            .map((entry) => `.${entry}`)
            .join("")
        : "";
    const tag = typeof el?.tagName === "string" ? el.tagName.toLowerCase() : "";
    const id = typeof el?.id === "string" && el.id.length > 0 ? `#${el.id}` : "";
    return tag.length > 0 ? `${tag}${id}${classSuffix}` : null;
  };

  const rootNode = arg.selectorQuery ? doc?.querySelector?.(arg.selectorQuery) ?? null : doc?.body ?? null;
  if (!rootNode) {
    return { matched: false, items: [] };
  }

  const items: Array<{
    title: string;
    url: string | null;
    summary: string | null;
    publishedAt: string | null;
    section?: string | null;
    record?: Record<string, string | null>;
    actionable?: {
      handle: string | null;
      selectorHint: string | null;
      frameId: string | null;
      href: string | null;
    };
  }> = [];
  const tableNodes: BrowserNodeLike[] = Array.from(rootNode.querySelectorAll?.("table") ?? []);
  const maxItems = Math.max(arg.scanLimit * 3, arg.scanLimit);
  const normalizeHeader = (value: string, fallbackIndex: number): string => {
    const trimmed = normalize(value);
    return trimmed.length > 0 ? trimmed : `col ${fallbackIndex + 1}`;
  };

  for (let tableIndex = 0; tableIndex < tableNodes.length; tableIndex += 1) {
    const tableNode = tableNodes[tableIndex];
    if (arg.visibleOnly && !isVisible(tableNode)) {
      continue;
    }
    const caption = normalize(tableNode?.querySelector?.("caption")?.textContent ?? "");
    const headingCells: BrowserNodeLike[] = Array.from(
      tableNode?.querySelectorAll?.("thead tr:first-child th, thead tr:first-child td") ??
      tableNode?.querySelectorAll?.("tr:first-child th, tr:first-child td") ??
      [],
    );
    const headers = headingCells.map((cell, index) => normalizeHeader(String(cell?.textContent ?? ""), index));
    const tbodyRows = tableNode?.querySelectorAll?.("tbody tr") ?? [];
    const rowNodes: BrowserNodeLike[] = Array.from(tbodyRows.length > 0 ? tbodyRows : tableNode?.querySelectorAll?.("tr") ?? []);

    let rowOrdinal = 0;
    for (const rowNode of rowNodes) {
      if (arg.visibleOnly && !isVisible(rowNode)) {
        continue;
      }
      const cells: BrowserNodeLike[] = Array.from(rowNode.querySelectorAll?.("th,td") ?? []);
      if (cells.length < 1) {
        continue;
      }
      if (rowOrdinal === 0 && headingCells.length > 0 && cells.every((cell, index) => normalize(String(cell?.textContent ?? "")) === headers[index])) {
        rowOrdinal += 1;
        continue;
      }
      const record: Record<string, string | null> = {};
      for (let index = 0; index < cells.length; index += 1) {
        const rawKey = headers[index] ?? `col ${index + 1}`;
        let key = rawKey;
        let duplicateOrdinal = 2;
        while (Object.prototype.hasOwnProperty.call(record, key)) {
          key = `${rawKey} #${duplicateOrdinal}`;
          duplicateOrdinal += 1;
        }
        const rawValue = normalize(String(cells[index]?.textContent ?? ""));
        record[key] = rawValue.length > 0 ? rawValue : null;
      }
      const firstText = Object.values(record).find((entry) => typeof entry === "string" && entry.length > 0) ?? "";
      const linkNode = rowNode.querySelector?.("a[href]") ?? null;
      const href = typeof linkNode?.href === "string" && linkNode.href.length > 0 ? linkNode.href : null;
      rowOrdinal += 1;
      items.push({
        title: firstText.length > 0 ? String(firstText) : `row ${rowOrdinal}`,
        url: href,
        summary: `${caption.length > 0 ? caption : `table ${tableIndex + 1}`} row ${rowOrdinal}`,
        publishedAt: null,
        section: caption.length > 0 ? caption : null,
        record,
        ...(arg.includeActionable
          ? {
              actionable: {
                handle: null,
                selectorHint: selectorHintFor(linkNode ?? rowNode),
                frameId: arg.frameId,
                href,
              },
            }
          : {}),
      });
      if (items.length >= maxItems) {
        break;
      }
    }
    if (items.length >= maxItems) {
      break;
    }
  }

  return { matched: true, items };
}
