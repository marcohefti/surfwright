import type { CDPSession } from "playwright-core";
import { CliError } from "../../errors.js";

function averageQuadCenter(quad: number[]): { x: number; y: number } | null {
  if (!Array.isArray(quad) || quad.length !== 8) {
    return null;
  }
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  if (xs.some((v) => !Number.isFinite(v)) || ys.some((v) => !Number.isFinite(v))) {
    return null;
  }
  return {
    x: xs.reduce((a, b) => a + b, 0) / xs.length,
    y: ys.reduce((a, b) => a + b, 0) / ys.length,
  };
}

export async function cdpClickBackendNodeId(opts: {
  cdp: CDPSession;
  backendNodeId: number;
}): Promise<{ point: { x: number; y: number } }> {
  await opts.cdp.send("DOM.enable").catch(() => {});

  // Best-effort scroll; can fail for detached nodes or special documents.
  await opts.cdp.send("DOM.scrollIntoViewIfNeeded", { backendNodeId: opts.backendNodeId }).catch(() => {});

  const box = (await opts.cdp
    .send("DOM.getBoxModel", { backendNodeId: opts.backendNodeId })
    .catch(() => null)) as
    | null
    | {
        model?: {
          content?: number[];
          border?: number[];
        };
      };

  const point =
    averageQuadCenter(box?.model?.content ?? []) ??
    averageQuadCenter(box?.model?.border ?? []);
  if (!point) {
    throw new CliError("E_QUERY_INVALID", "Unable to click handle: element has no box model");
  }

  // Use a minimal CDP mouse click sequence.
  await opts.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y, button: "none" });
  await opts.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await opts.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });

  return { point };
}

export async function cdpDescribeBackendNode(opts: {
  cdp: CDPSession;
  backendNodeId: number;
}): Promise<{
  selectorHint: string | null;
  text: string;
  attributes: Record<string, string>;
}> {
  await opts.cdp.send("DOM.enable").catch(() => {});
  const described = (await opts.cdp.send("DOM.describeNode", {
    backendNodeId: opts.backendNodeId,
    depth: 0,
    pierce: true,
  })) as { node?: { nodeName?: string; attributes?: string[] } };

  const nodeName = typeof described?.node?.nodeName === "string" ? described.node.nodeName.toLowerCase() : "";
  const attrs = Array.isArray(described?.node?.attributes) ? described.node.attributes : [];
  const attributes: Record<string, string> = {};
  for (let i = 0; i + 1 < attrs.length; i += 2) {
    const key = typeof attrs[i] === "string" ? attrs[i] : "";
    const value = typeof attrs[i + 1] === "string" ? attrs[i + 1] : "";
    if (key) {
      attributes[key] = value;
    }
  }

  const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();
  const id = typeof attributes.id === "string" && attributes.id.length > 0 ? `#${attributes.id}` : "";
  const classSuffix = typeof attributes.class === "string"
    ? normalize(attributes.class)
        .split(" ")
        .filter((entry) => entry.length > 0)
        .slice(0, 2)
        .map((entry) => `.${entry}`)
        .join("")
    : "";

  const selectorHint = nodeName ? `${nodeName}${id}${classSuffix}` : null;
  const textCandidate =
    (typeof attributes["aria-label"] === "string" ? attributes["aria-label"] : "") ||
    (typeof attributes.value === "string" ? attributes.value : "") ||
    (typeof attributes.name === "string" ? attributes.name : "");

  return {
    selectorHint,
    text: String(textCandidate ?? ""),
    attributes,
  };
}
