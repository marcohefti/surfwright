import { CliError } from "../../../errors.js";
import { providers } from "../../../providers/index.js";
import type { TargetSnapshotDiffReport, TargetSnapshotMode, TargetSnapshotReport } from "../../../types.js";

const DIFF_LIST_CAP = 60;

function mustReadFile(pathInput: string): { path: string; text: string } {
  const { fs, path } = providers();
  const resolved = path.resolve(pathInput);
  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf8");
  } catch {
    throw new CliError("E_QUERY_INVALID", `Unable to read file: ${resolved}`);
  }
  if (raw.trim().length === 0) {
    throw new CliError("E_QUERY_INVALID", `Empty JSON file: ${resolved}`);
  }
  return { path: resolved, text: raw };
}

function parseSnapshot(text: string, label: string): TargetSnapshotReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CliError("E_QUERY_INVALID", `${label} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new CliError("E_QUERY_INVALID", `${label} must be an object`);
  }
  const obj = parsed as Partial<TargetSnapshotReport>;
  if (obj.ok !== true) {
    throw new CliError("E_QUERY_INVALID", `${label} must be a surfwright target snapshot report`);
  }
  if (typeof obj.url !== "string" || typeof obj.title !== "string") {
    throw new CliError("E_QUERY_INVALID", `${label} missing url/title`);
  }
  if (obj.mode !== "snapshot" && obj.mode !== "orient") {
    throw new CliError("E_QUERY_INVALID", `${label} has invalid mode`);
  }
  if (!Array.isArray(obj.headings) || !Array.isArray(obj.buttons) || !Array.isArray(obj.links)) {
    throw new CliError("E_QUERY_INVALID", `${label} missing headings/buttons/links arrays`);
  }
  return obj as TargetSnapshotReport;
}

function normalizeList(values: string[]): string[] {
  return values
    .map((v) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : ""))
    .filter((v) => v.length > 0);
}

function multiset(values: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const value of values) {
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return map;
}

function diffMultiset(a: string[], b: string[]): { added: string[]; removed: string[] } {
  const aMap = multiset(a);
  const bMap = multiset(b);
  const added: string[] = [];
  const removed: string[] = [];
  for (const [key, countB] of bMap.entries()) {
    const countA = aMap.get(key) ?? 0;
    const extra = countB - countA;
    for (let i = 0; i < extra; i += 1) {
      added.push(key);
    }
  }
  for (const [key, countA] of aMap.entries()) {
    const countB = bMap.get(key) ?? 0;
    const extra = countA - countB;
    for (let i = 0; i < extra; i += 1) {
      removed.push(key);
    }
  }
  added.sort();
  removed.sort();
  return { added, removed };
}

type Link = { text: string; href: string };

function normalizeLinks(values: Array<{ text: string; href: string }>): Link[] {
  const out: Link[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const text = typeof value.text === "string" ? value.text.replace(/\s+/g, " ").trim() : "";
    const href = typeof value.href === "string" ? value.href.trim() : "";
    if (!text && !href) {
      continue;
    }
    out.push({ text, href });
  }
  return out;
}

function linkKey(link: Link): string {
  return `${link.text}\n${link.href}`;
}

function diffLinks(a: Link[], b: Link[]): { added: Link[]; removed: Link[] } {
  const aMap = new Map<string, { link: Link; count: number }>();
  const bMap = new Map<string, { link: Link; count: number }>();
  for (const link of a) {
    const key = linkKey(link);
    const existing = aMap.get(key) ?? { link, count: 0 };
    existing.count += 1;
    aMap.set(key, existing);
  }
  for (const link of b) {
    const key = linkKey(link);
    const existing = bMap.get(key) ?? { link, count: 0 };
    existing.count += 1;
    bMap.set(key, existing);
  }
  const added: Link[] = [];
  const removed: Link[] = [];
  for (const [key, entryB] of bMap.entries()) {
    const countA = aMap.get(key)?.count ?? 0;
    const extra = entryB.count - countA;
    for (let i = 0; i < extra; i += 1) {
      added.push(entryB.link);
    }
  }
  for (const [key, entryA] of aMap.entries()) {
    const countB = bMap.get(key)?.count ?? 0;
    const extra = entryA.count - countB;
    for (let i = 0; i < extra; i += 1) {
      removed.push(entryA.link);
    }
  }
  const sortKey = (link: Link) => `${link.text}\n${link.href}`.toLowerCase();
  added.sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
  removed.sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
  return { added, removed };
}

function capList<T>(values: T[], cap: number): { values: T[]; truncated: boolean } {
  if (values.length <= cap) {
    return { values, truncated: false };
  }
  return { values: values.slice(0, cap), truncated: true };
}

export function targetSnapshotDiffFromFiles(opts: { aPath: string; bPath: string }): TargetSnapshotDiffReport {
  const aFile = mustReadFile(opts.aPath);
  const bFile = mustReadFile(opts.bPath);
  const a = parseSnapshot(aFile.text, "a");
  const b = parseSnapshot(bFile.text, "b");

  const aHeadings = normalizeList(a.headings);
  const bHeadings = normalizeList(b.headings);
  const aButtons = normalizeList(a.buttons);
  const bButtons = normalizeList(b.buttons);
  const aLinks = normalizeLinks(a.links);
  const bLinks = normalizeLinks(b.links);

  const headings = diffMultiset(aHeadings, bHeadings);
  const buttons = diffMultiset(aButtons, bButtons);
  const links = diffLinks(aLinks, bLinks);

  const cappedHeadingsAdded = capList(headings.added, DIFF_LIST_CAP);
  const cappedHeadingsRemoved = capList(headings.removed, DIFF_LIST_CAP);
  const cappedButtonsAdded = capList(buttons.added, DIFF_LIST_CAP);
  const cappedButtonsRemoved = capList(buttons.removed, DIFF_LIST_CAP);
  const cappedLinksAdded = capList(links.added, DIFF_LIST_CAP);
  const cappedLinksRemoved = capList(links.removed, DIFF_LIST_CAP);

  const changedTextPreview =
    (typeof a.textPreview === "string" ? a.textPreview.replace(/\s+/g, " ").trim() : "") !==
    (typeof b.textPreview === "string" ? b.textPreview.replace(/\s+/g, " ").trim() : "");

  const modeA = a.mode as TargetSnapshotMode;
  const modeB = b.mode as TargetSnapshotMode;

  return {
    ok: true,
    a: {
      path: aFile.path,
      url: a.url,
      title: a.title,
      mode: modeA,
      counts: {
        headings: aHeadings.length,
        buttons: aButtons.length,
        links: aLinks.length,
      },
    },
    b: {
      path: bFile.path,
      url: b.url,
      title: b.title,
      mode: modeB,
      counts: {
        headings: bHeadings.length,
        buttons: bButtons.length,
        links: bLinks.length,
      },
    },
    changed: {
      url: a.url !== b.url,
      title: a.title !== b.title,
      textPreview: changedTextPreview,
      headings: headings.added.length > 0 || headings.removed.length > 0,
      buttons: buttons.added.length > 0 || buttons.removed.length > 0,
      links: links.added.length > 0 || links.removed.length > 0,
    },
    delta: {
      headings: {
        added: cappedHeadingsAdded.values,
        removed: cappedHeadingsRemoved.values,
        truncated:
          cappedHeadingsAdded.truncated || cappedHeadingsRemoved.truncated,
      },
      buttons: {
        added: cappedButtonsAdded.values,
        removed: cappedButtonsRemoved.values,
        truncated: cappedButtonsAdded.truncated || cappedButtonsRemoved.truncated,
      },
      links: {
        added: cappedLinksAdded.values,
        removed: cappedLinksRemoved.values,
        truncated: cappedLinksAdded.truncated || cappedLinksRemoved.truncated,
      },
    },
  };
}
