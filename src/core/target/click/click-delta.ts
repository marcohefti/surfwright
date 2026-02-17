import type { TargetClickDeltaEvidence } from "../../types.js";

const CLICK_DELTA_FOCUS_TEXT_MAX_CHARS = 120;
const CLICK_DELTA_ROLES = ["dialog", "alert", "status", "menu", "listbox"] as const;
export const CLICK_DELTA_ARIA_ATTRIBUTES = [
  "aria-expanded",
  "aria-controls",
  "aria-hidden",
  "aria-modal",
  "aria-pressed",
  "aria-selected",
  "aria-checked",
  "aria-disabled",
] as const;

type ClickDeltaFocus = {
  selectorHint: string | null;
  text: string | null;
  textTruncated: boolean;
};

type ClickDeltaRole = (typeof CLICK_DELTA_ROLES)[number];
type ClickDeltaRoleCounts = Record<ClickDeltaRole, number>;

async function captureDeltaProbe(evaluator: {
  evaluate<T, Arg>(fn: (arg: Arg) => T, arg: Arg): Promise<T>;
}): Promise<{
  focus: ClickDeltaFocus;
  roleCounts: ClickDeltaRoleCounts;
}> {
  return await evaluator.evaluate(
    ({ focusTextMaxChars, roles }: { focusTextMaxChars: number; roles: ClickDeltaRole[] }) => {
      const runtime = globalThis as unknown as { document?: any };
      const doc = runtime.document;
      const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();

      const selectorHintFor = (node: any): string | null => {
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

      const active = doc?.activeElement ?? null;
      const tag = typeof active?.tagName === "string" ? active.tagName.toLowerCase() : "";
      let focusTextRaw = "";
      if (tag === "input" || tag === "textarea" || tag === "select") {
        focusTextRaw =
          active?.getAttribute?.("aria-label") ??
          active?.getAttribute?.("placeholder") ??
          active?.getAttribute?.("name") ??
          active?.id ??
          "";
      } else if (tag === "html" || tag === "body") {
        focusTextRaw = "";
      } else {
        focusTextRaw = active?.innerText ?? active?.textContent ?? active?.getAttribute?.("aria-label") ?? "";
      }
      const focusTextNormalized = normalize(String(focusTextRaw ?? ""));
      const focusText = focusTextNormalized.slice(0, focusTextMaxChars);

      const roleCounts: Partial<Record<ClickDeltaRole, number>> = {};
      for (const role of roles) {
        roleCounts[role] = doc?.querySelectorAll?.(`[role="${role}"]`)?.length ?? 0;
      }

      return {
        focus: {
          selectorHint: selectorHintFor(active),
          text: focusText.length > 0 ? focusText : null,
          textTruncated: focusTextNormalized.length > focusTextMaxChars,
        },
        roleCounts: {
          dialog: roleCounts.dialog ?? 0,
          alert: roleCounts.alert ?? 0,
          status: roleCounts.status ?? 0,
          menu: roleCounts.menu ?? 0,
          listbox: roleCounts.listbox ?? 0,
        },
      };
    },
    {
      focusTextMaxChars: CLICK_DELTA_FOCUS_TEXT_MAX_CHARS,
      roles: [...CLICK_DELTA_ROLES],
    },
  );
}

export async function captureClickDeltaState(
  page: { url(): string; title(): Promise<string> },
  evaluator: { evaluate<T, Arg>(fn: (arg: Arg) => T, arg: Arg): Promise<T> },
): Promise<{
  url: string;
  title: string;
  focus: ClickDeltaFocus;
  roleCounts: ClickDeltaRoleCounts;
}> {
  const url = page.url();
  const [title, probe] = await Promise.all([page.title(), captureDeltaProbe(evaluator)]);
  return {
    url,
    title,
    focus: probe.focus,
    roleCounts: probe.roleCounts,
  };
}

export function buildClickDeltaEvidence(opts: {
  before: Awaited<ReturnType<typeof captureClickDeltaState>>;
  after: Awaited<ReturnType<typeof captureClickDeltaState>>;
  clickedAriaBefore: { detached: boolean; values: Record<string, string | null> };
  clickedAriaAfter: { detached: boolean; values: Record<string, string | null> };
}): TargetClickDeltaEvidence {
  return {
    before: opts.before,
    after: opts.after,
    clickedAria: {
      detachedAfter: opts.clickedAriaAfter.detached,
      attributes: [...CLICK_DELTA_ARIA_ATTRIBUTES].map((name) => ({
        name,
        before: opts.clickedAriaBefore.values[name] ?? null,
        after: opts.clickedAriaAfter.values[name] ?? null,
      })),
    },
  };
}

