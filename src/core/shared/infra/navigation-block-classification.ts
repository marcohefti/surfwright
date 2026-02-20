import type { Page } from "playwright-core";

export type NavigationBlockType = "auth" | "captcha" | "consent" | "unknown";

const MAX_SIGNALS = 6;

type BlockScores = {
  auth: number;
  captcha: number;
  consent: number;
};

export async function classifyNavigationBlockType(page: Page): Promise<{
  blockType: NavigationBlockType;
  scores: BlockScores;
  signals: string[];
}> {
  const pageUrl = page.url();
  try {
    return await page.evaluate(
      ({ pageUrl, maxSignals }: { pageUrl: string; maxSignals: number }) => {
        const runtime = globalThis as unknown as {
          document?: {
            body?: { innerText?: string | null } | null;
            querySelectorAll?: (selector: string) => { length?: number } | null;
          } | null;
        };

        const scores: BlockScores = { auth: 0, captcha: 0, consent: 0 };
        const signals: string[] = [];
        const lower = (value: string): string => value.toLowerCase();

        const addSignal = (type: keyof BlockScores, weight: number, label: string) => {
          scores[type] += weight;
          if (signals.length < maxSignals) {
            signals.push(`${type}:${label}`);
          }
        };

        let parsedUrl: URL | null = null;
        try {
          parsedUrl = new URL(pageUrl);
        } catch {
          parsedUrl = null;
        }
        const urlPath = lower(`${parsedUrl?.pathname ?? ""} ${parsedUrl?.search ?? ""}`);
        if (/(^|[\/?&=_-])(login|signin|sign-in|auth|oauth|2fa|mfa|verify)([\/?&=_-]|$)/.test(urlPath)) {
          addSignal("auth", 2, "url-path");
        }
        if (/(captcha|recaptcha|hcaptcha|challenge|cf_chl)/.test(urlPath)) {
          addSignal("captcha", 2, "url-path");
        }
        if (/(cookie|consent|privacy)/.test(urlPath)) {
          addSignal("consent", 1, "url-path");
        }

        const text = lower(String(runtime.document?.body?.innerText ?? "").replace(/\s+/g, " ").trim());
        if (text.includes("sign in") || text.includes("log in") || text.includes("two-factor") || text.includes("verification code")) {
          addSignal("auth", 2, "body-text");
        }
        if (text.includes("verify you are human") || text.includes("i am human") || text.includes("security check") || text.includes("unusual traffic")) {
          addSignal("captcha", 2, "body-text");
        }
        if (text.includes("cookie") || text.includes("privacy choices") || text.includes("accept all") || text.includes("reject all")) {
          addSignal("consent", 2, "body-text");
        }

        const countSelector = (selector: string): number => {
          try {
            const list = runtime.document?.querySelectorAll?.(selector);
            return Number(list?.length ?? 0);
          } catch {
            return 0;
          }
        };

        if (countSelector("input[type='password'],input[name*='password' i],form[action*='login' i]") > 0) {
          addSignal("auth", 2, "auth-controls");
        }
        if (countSelector("iframe[src*='captcha' i],[id*='captcha' i],[class*='captcha' i],textarea[name*='captcha' i],[data-sitekey]") > 0) {
          addSignal("captcha", 3, "captcha-controls");
        }
        if (countSelector("[id*='cookie' i],[class*='cookie' i],[id*='consent' i],[class*='consent' i],[aria-label*='cookie' i]") > 0) {
          addSignal("consent", 2, "consent-controls");
        }

        const ranked = (Object.entries(scores) as Array<[NavigationBlockType, number]>)
          .filter(([type]) => type === "auth" || type === "captcha" || type === "consent")
          .sort((a, b) => b[1] - a[1]);
        const best = ranked[0] ?? ["unknown", 0];
        const second = ranked[1] ?? ["unknown", 0];
        const blockType: NavigationBlockType =
          best[1] >= 2 && best[1] > second[1]
            ? best[0]
            : "unknown";

        return {
          blockType,
          scores,
          signals,
        };
      },
      {
        pageUrl,
        maxSignals: MAX_SIGNALS,
      },
    );
  } catch {
    return {
      blockType: "unknown",
      scores: { auth: 0, captcha: 0, consent: 0 },
      signals: [],
    };
  }
}
