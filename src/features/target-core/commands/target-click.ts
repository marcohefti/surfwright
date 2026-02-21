import {
  parseFieldsCsv,
  projectReportFields,
  queryInvalid,
  targetClick,
  targetClickAt,
} from "../../../core/target/public.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import type { TargetClickReport } from "../../../core/types.js";
import { targetCommandMeta } from "../manifest.js";
import type { TargetCommandSpec } from "./types.js";

function parseRepeatCount(input: string | undefined): number {
  if (typeof input !== "string" || input.trim().length === 0) {
    return 1;
  }
  const raw = input.trim();
  if (!/^\d+$/.test(raw)) {
    throw queryInvalid("repeat must be a positive integer between 1 and 25");
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 25) {
    throw queryInvalid("repeat must be a positive integer between 1 and 25");
  }
  return parsed;
}

const meta = targetCommandMeta("target.click");
export const targetClickCommandSpec: TargetCommandSpec = {
  id: meta.id,
  usage: meta.usage,
  summary: meta.summary,
  register: (ctx) => {
    ctx.target
      .command("click")
      .description(meta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--text <query>", "Text query for fuzzy text match")
      .option("--selector <query>", "CSS/Playwright selector query")
      .option("--contains <text>", "Text filter to apply with --selector")
      .option("--handle <handle>", "Element handle (from target snapshot --mode a11y)")
      .option("--visible-only", "Only match visible elements")
      .option("--within <selector>", "Scope query resolution to descendants of selector")
      .option("--frame-scope <scope>", "Frame scope: main|all", "main")
      .option("--index <n>", "Pick the Nth match (0-based) instead of first match")
      .option("--repeat <n>", "Repeat click action N times (1-25); returns final click report plus repeat metadata")
      .option("--explain", "Explain match selection/rejection without clicking", false)
      .option("--wait-for-text <text>", "After click, wait until text becomes visible")
      .option("--wait-for-selector <query>", "After click, wait until selector becomes visible")
      .option("--wait-network-idle", "After click, wait for network idle")
      .option("--wait-timeout-ms <ms>", "Post-click wait timeout budget in milliseconds", ctx.parseTimeoutMs)
      .option("--snapshot", "Include compact post-click text preview")
      .option("--delta", "Include bounded evidence-based delta after click", false)
      .option("--proof", "Include one-shot evidence payload (implies --snapshot and --delta)", false)
      .option("--proof-check-state", "Include checkbox/radio check-state evidence in proof payload", false)
      .option("--assert-url-prefix <prefix>", "Post-click assertion: final URL must start with prefix")
      .option("--assert-selector <query>", "Post-click assertion: selector must be visible")
      .option("--assert-text <text>", "Post-click assertion: text must be present in page body")
      .option("--timeout-ms <ms>", "Click timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            text?: string;
            selector?: string;
            contains?: string;
            handle?: string;
            visibleOnly?: boolean;
            within?: string;
            frameScope?: string;
            index?: string;
            repeat?: string;
            explain?: boolean;
            waitForText?: string;
            waitForSelector?: string;
            waitNetworkIdle?: boolean;
            waitTimeoutMs?: number;
            snapshot?: boolean;
            delta?: boolean;
            proof?: boolean;
            proofCheckState?: boolean;
            assertUrlPrefix?: string;
            assertSelector?: string;
            assertText?: string;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          const index = typeof options.index === "string" ? Number.parseInt(options.index, 10) : undefined;
          const repeat = parseRepeatCount(options.repeat);
          try {
            if (Boolean(options.explain) && repeat > 1) {
              throw queryInvalid("--repeat cannot be combined with --explain");
            }
            const clickOpts = {
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              textQuery: options.text,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              handle: options.handle,
              visibleOnly: Boolean(options.visibleOnly),
              withinSelector: options.within,
              frameScope: options.frameScope,
              index,
              explain: Boolean(options.explain),
              waitForText: options.waitForText,
              waitForSelector: options.waitForSelector,
              waitNetworkIdle: Boolean(options.waitNetworkIdle),
              waitTimeoutMs: options.waitTimeoutMs,
              snapshot: Boolean(options.snapshot),
              delta: Boolean(options.delta),
              proof: Boolean(options.proof),
              proofCheckState: Boolean(options.proofCheckState),
              assertUrlPrefix: options.assertUrlPrefix,
              assertSelector: options.assertSelector,
              assertText: options.assertText,
              persistState: options.persist !== false,
            };
            if (repeat === 1) {
              const report = await targetClick({
                targetId,
                ...clickOpts,
              });
              ctx.printTargetSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
              return;
            }

            let currentTargetId = targetId;
            let lastReport: TargetClickReport | null = null;
            const actionIds: string[] = [];
            const pickedIndices: number[] = [];
            for (let iteration = 0; iteration < repeat; iteration += 1) {
              const report = await targetClick({
                targetId: currentTargetId,
                ...clickOpts,
              });
              if (!("actionId" in report)) {
                throw queryInvalid("--repeat only supports click execution mode");
              }
              lastReport = report as TargetClickReport;
              actionIds.push(lastReport.actionId);
              pickedIndices.push(lastReport.pickedIndex);
              if (!lastReport.handoff.sameTarget && typeof lastReport.handoff.openedTargetId === "string" && lastReport.handoff.openedTargetId.length > 0) {
                currentTargetId = lastReport.handoff.openedTargetId;
              }
            }
            if (!lastReport) {
              throw queryInvalid("repeat execution did not produce a click report");
            }
            const repeatReport = {
              ...lastReport,
              repeat: {
                requested: repeat,
                completed: actionIds.length,
                actionIds,
                pickedIndices,
              },
            };
            ctx.printTargetSuccess(projectReportFields(repeatReport as unknown as Record<string, unknown>, fields), output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};

const clickAtMeta = targetCommandMeta("target.click-at");
export const targetClickAtCommandSpec: TargetCommandSpec = {
  id: clickAtMeta.id,
  usage: clickAtMeta.usage,
  summary: clickAtMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("click-at")
      .description(clickAtMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .requiredOption("--x <n>", "Viewport x coordinate")
      .requiredOption("--y <n>", "Viewport y coordinate")
      .option("--button <button>", "Mouse button: left|middle|right", "left")
      .option("--click-count <n>", "Number of clicks to send", "1")
      .option("--timeout-ms <ms>", "Click timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(async (targetId: string, options: { x: string; y: string; button?: string; clickCount?: string; timeoutMs: number; persist?: boolean; fields?: string }) => {
        const output = ctx.globalOutputOpts();
        const globalOpts = ctx.program.opts<{ session?: string }>();
        const fields = parseFieldsCsv(options.fields);
        try {
          const report = await targetClickAt({
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            x: Number.parseFloat(options.x),
            y: Number.parseFloat(options.y),
            button: options.button,
            clickCount: typeof options.clickCount === "string" ? Number.parseInt(options.clickCount, 10) : undefined,
            persistState: options.persist !== false,
          });
          ctx.printTargetSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      });
  },
};
