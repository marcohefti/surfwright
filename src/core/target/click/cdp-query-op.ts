import type { BrowserNodeLike, BrowserRuntimeLike } from "../infra/types/browser-dom-types.js";

export function cdpQueryOp(arg: {
  op:
    | "summary"
    | "preview"
    | "click"
    | "click-point"
    | "invisible"
    | "aria"
    | "fill"
    | "wait-selector-visible"
    | "wait-text-visible";
  mode?: "text" | "selector";
  query?: string;
  selector?: string | null;
  contains?: string | null;
  withinSelector?: string | null;
  index?: number;
  stopExclusive?: number;
  maxRejected?: number;
  attrNames?: string[];
  waitSelector?: string;
  waitText?: string;
  fillValue?: string;
  fillEvents?: string[];
}):
  | { rawCount: number; firstVisibleIndex: number | null }
  | { ok: true; visible: boolean; text: string; selectorHint: string | null; href?: string | null }
  | { ok: true; x: number; y: number; visible: boolean; text: string; selectorHint: string | null; href?: string | null }
  | { ok: false }
  | { rejected: Array<{ index: number; visible: boolean; text: string; selectorHint: string | null }>; rejectedTruncated: boolean }
  | { detached: boolean; values: Record<string, string | null> }
  | { filled: boolean; valueLength: number; eventsDispatched: string[] }
  | boolean {
  const runtime = globalThis as unknown as BrowserRuntimeLike;
  const doc = runtime.document;
  const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
  const normLower = (value: string): string => normalize(value).toLowerCase();

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

  const isVisible = (node: BrowserNodeLike | null): boolean => {
    if (!node) return false;
    if (node.hasAttribute?.("hidden")) return false;
    const style = runtime.getComputedStyle?.(node);
    if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
    return (node.getClientRects?.().length ?? 0) > 0;
  };

  const textFor = (node: BrowserNodeLike | null): string => {
    const el = node;
    const tag = typeof el?.tagName === "string" ? el.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select") {
      return (
        el?.getAttribute?.("aria-label") ??
        el?.getAttribute?.("placeholder") ??
        el?.getAttribute?.("name") ??
        el?.id ??
        el?.value ??
        ""
      );
    }
    return el?.innerText ?? el?.textContent ?? el?.getAttribute?.("aria-label") ?? el?.getAttribute?.("title") ?? "";
  };

  const hrefFor = (node: BrowserNodeLike | null): string | null => {
    const direct = node?.matches?.("a[href]") ? node : null;
    const nearest = direct ?? node?.closest?.("a[href]") ?? node?.querySelector?.("a[href]") ?? null;
    const href = nearest?.getAttribute?.("href") ?? nearest?.href ?? null;
    return typeof href === "string" && href.trim().length > 0 ? href : null;
  };

  if (arg.op === "wait-selector-visible") {
    const selector = typeof arg.waitSelector === "string" ? arg.waitSelector : "";
    const node = doc?.querySelector?.(selector) ?? null;
    return Boolean(node && isVisible(node));
  }

  if (arg.op === "wait-text-visible") {
    const body = doc?.body ?? null;
    const hay = normLower(String(body?.innerText ?? ""));
    const needle = normLower(String(arg.waitText ?? ""));
    return needle.length > 0 && hay.includes(needle);
  }

  const withinSelector = typeof arg.withinSelector === "string" ? arg.withinSelector.trim() : "";
  const root = (() => {
    if (withinSelector.length < 1) {
      return doc?.body ?? null;
    }
    try {
      return doc?.querySelector?.(withinSelector) ?? null;
    } catch {
      return null;
    }
  })();
  if (!root) {
    if (arg.op === "summary") return { rawCount: 0, firstVisibleIndex: null };
    if (arg.op === "invisible") return { rejected: [], rejectedTruncated: false };
    if (arg.op === "aria") {
      const values: Record<string, string | null> = {};
      for (const name of arg.attrNames ?? []) values[name] = null;
      return { detached: true, values };
    }
    if (arg.op === "fill") return { filled: false, valueLength: 0, eventsDispatched: [] };
    return { ok: false };
  }

  const mode = arg.mode ?? "selector";
  const query = typeof arg.query === "string" ? arg.query : "";
  const selector = typeof arg.selector === "string" ? arg.selector : "";
  const containsLower = typeof arg.contains === "string" && arg.contains.trim().length > 0 ? normLower(arg.contains) : null;
  const queryLower = normLower(query);

  const buildMatches = (): BrowserNodeLike[] => {
    if (mode === "selector") {
      const nodes = Array.from(root.querySelectorAll?.(selector) ?? []);
      return containsLower ? nodes.filter((node) => normLower(textFor(node)).includes(containsLower)) : nodes;
    }

    const candidateSelector =
      "a,button,input,textarea,select,option,label,summary,[role=\"button\"],[role=\"link\"],[role=\"menuitem\"],[role=\"tab\"],[role=\"checkbox\"],[role=\"radio\"],[role=\"option\"],[role=\"heading\"],h1,h2,h3,h4,h5,h6,[tabindex]:not([tabindex=\"-1\"])";
    const nodes = Array.from(root.querySelectorAll?.(candidateSelector) ?? []);
    const exact = nodes.filter((node) => normLower(textFor(node)) === queryLower);
    const pool = exact.length > 0 ? exact : nodes;
    return pool.filter((node) => normLower(textFor(node)).includes(queryLower));
  };

  const matches = buildMatches();

  if (arg.op === "summary") {
    let firstVisibleIndex: number | null = null;
    for (let i = 0; i < matches.length; i += 1) {
      if (isVisible(matches[i])) {
        firstVisibleIndex = i;
        break;
      }
    }
    return { rawCount: matches.length, firstVisibleIndex };
  }

  if (arg.op === "preview") {
    const index = typeof arg.index === "number" ? arg.index : -1;
    const node = index >= 0 ? (matches[index] ?? null) : null;
    if (!node) return { ok: false };
    return {
      ok: true,
      visible: isVisible(node),
      text: normalize(String(textFor(node) ?? "")).slice(0, 180),
      selectorHint: selectorHintFor(node),
      href: hrefFor(node),
    };
  }

  if (arg.op === "click") {
    const index = typeof arg.index === "number" ? arg.index : -1;
    const node = index >= 0 ? (matches[index] ?? null) : null;
    if (!node) return { ok: false };
    try {
      node.scrollIntoView?.({ block: "center", inline: "center" });
    } catch {
      // ignore
    }
    node.click?.();
    return {
      ok: true,
      visible: isVisible(node),
      text: normalize(String(textFor(node) ?? "")).slice(0, 180),
      selectorHint: selectorHintFor(node),
      href: hrefFor(node),
    };
  }

  if (arg.op === "click-point") {
    const index = typeof arg.index === "number" ? arg.index : -1;
    const node = index >= 0 ? (matches[index] ?? null) : null;
    if (!node) return { ok: false };
    try {
      node.scrollIntoView?.({ block: "center", inline: "center" });
    } catch {
      // ignore
    }

    // Prefer returning a click point for a trusted mouse click (required for actions like opening a new tab).
    const rect = node.getBoundingClientRect?.();
    let x = (rect?.left ?? 0) + (rect?.width ?? 0) / 2;
    let y = (rect?.top ?? 0) + (rect?.height ?? 0) / 2;

    // Best-effort: translate iframe-relative coordinates into top-level viewport coordinates for same-origin frames.
    try {
      let win = globalThis as unknown as {
        frameElement?: BrowserNodeLike | null;
        parent?: unknown;
      };
      for (let i = 0; i < 16; i += 1) {
        const frameEl = win?.frameElement ?? null;
        if (!frameEl) break;
        const fr = frameEl.getBoundingClientRect?.();
        x += (fr?.left ?? 0);
        y += (fr?.top ?? 0);
        const parent = win?.parent ?? null;
        if (!parent || parent === win) break;
        win = parent as {
          frameElement?: BrowserNodeLike | null;
          parent?: unknown;
        };
      }
    } catch {
      // ignore
    }

    // Guard against non-finite values to avoid flaky downstream input.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false };

    return {
      ok: true,
      x,
      y,
      visible: isVisible(node),
      text: normalize(String(textFor(node) ?? "")).slice(0, 180),
      selectorHint: selectorHintFor(node),
      href: hrefFor(node),
    };
  }

  if (arg.op === "invisible") {
    const stopExclusive = Math.max(
      0,
      Math.min(typeof arg.stopExclusive === "number" ? arg.stopExclusive : matches.length, matches.length),
    );
    const maxRejected = Math.max(0, typeof arg.maxRejected === "number" ? arg.maxRejected : 0);
    const rejected: Array<{ index: number; visible: boolean; text: string; selectorHint: string | null }> = [];
    let rejectedTruncated = false;
    for (let i = 0; i < stopExclusive; i += 1) {
      const node = matches[i];
      const visible = isVisible(node);
      if (visible) continue;
      if (rejected.length >= maxRejected) {
        rejectedTruncated = true;
        continue;
      }
      rejected.push({
        index: i,
        visible,
        text: normalize(String(textFor(node) ?? "")).slice(0, 180),
        selectorHint: selectorHintFor(node),
      });
    }
    return { rejected, rejectedTruncated };
  }

  if (arg.op === "aria") {
    const index = typeof arg.index === "number" ? arg.index : -1;
    const names = Array.isArray(arg.attrNames) ? arg.attrNames : [];
    const node = index >= 0 ? (matches[index] ?? null) : null;
    const values: Record<string, string | null> = {};
    if (!node) {
      for (const name of names) values[name] = null;
      return { detached: true, values };
    }
    for (const name of names) {
      values[name] = node?.getAttribute?.(name) ?? null;
    }
    return { detached: false, values };
  }

  if (arg.op === "fill") {
    const index = typeof arg.index === "number" ? arg.index : -1;
    const node = index >= 0 ? (matches[index] ?? null) : null;
    const raw = typeof arg.fillValue === "string" ? arg.fillValue : "";
    const eventsRequested = Array.isArray(arg.fillEvents) ? arg.fillEvents : [];
    const dispatchEvents = (target: BrowserNodeLike, names: string[]) => {
      const dispatched: string[] = [];
      for (const name of names) {
        try {
          target.dispatchEvent?.(new Event(name, { bubbles: true }));
          dispatched.push(name);
        } catch {
          // ignore invalid events in browser runtime
        }
      }
      return dispatched;
    };
    if (!node) {
      return { filled: false, valueLength: raw.length, eventsDispatched: [] };
    }
    const tag = typeof node?.tagName === "string" ? node.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select") {
      try {
        node.focus?.();
      } catch {
        // ignore
      }
      try {
        node.value = raw;
      } catch {
        // ignore
      }
      const eventsDispatched = dispatchEvents(node, eventsRequested);
      return { filled: true, valueLength: raw.length, eventsDispatched };
    }
    if (node?.isContentEditable) {
      try {
        node.focus?.();
      } catch {
        // ignore
      }
      node.textContent = raw;
      const eventsDispatched = dispatchEvents(node, eventsRequested);
      return { filled: true, valueLength: raw.length, eventsDispatched };
    }
    return { filled: false, valueLength: raw.length, eventsDispatched: [] };
  }

  return { ok: false };
}
