import {
  parseFieldsCsv,
  projectReportFields,
  targetObserve,
  targetScrollPlan,
  targetScrollSample,
  targetScrollWatch,
  targetTransitionTrace,
} from "../../../../core/target/public.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../../core/types.js";
import { targetCommandMeta } from "../../manifest.js";
import type { TargetCommandSpec } from "../types.js";

const observeMeta = targetCommandMeta("target.observe");
const scrollPlanMeta = targetCommandMeta("target.scroll-plan");
const scrollSampleMeta = targetCommandMeta("target.scroll-sample");
const scrollWatchMeta = targetCommandMeta("target.scroll-watch");
const transitionTraceMeta = targetCommandMeta("target.transition-trace");

export const targetObserveCommandSpec: TargetCommandSpec = {
  id: observeMeta.id,
  usage: observeMeta.usage,
  summary: observeMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("observe")
      .description(observeMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--selector <query>", "Selector query to observe")
      .option("--contains <text>", "Optional contains filter applied to selector matches")
      .option("--visible-only", "Require observed target to be visible", false)
      .option("--property <name>", "Property to sample (computed style by default)", "transform")
      .option("--interval-ms <ms>", "Sampling interval in milliseconds", "400")
      .option("--duration-ms <ms>", "Total capture window in milliseconds", "3000")
      .option("--max-samples <n>", "Maximum samples to return", "120")
      .option("--timeout-ms <ms>", "Command timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            selector?: string;
            contains?: string;
            visibleOnly?: boolean;
            property: string;
            intervalMs: string;
            durationMs: string;
            maxSamples: string;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          try {
            const report = await targetObserve({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
              property: options.property,
              intervalMs: Number.parseInt(options.intervalMs, 10),
              durationMs: Number.parseInt(options.durationMs, 10),
              maxSamples: Number.parseInt(options.maxSamples, 10),
              persistState: options.persist !== false,
            });
            ctx.printTargetSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};

export const targetScrollPlanCommandSpec: TargetCommandSpec = {
  id: scrollPlanMeta.id,
  usage: scrollPlanMeta.usage,
  summary: scrollPlanMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("scroll-plan")
      .description(scrollPlanMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--steps <csv>", "Comma-separated requested scrollY positions", "0,300,600,900")
      .option("--count-selector <query>", "Optional selector query to count at each scroll step")
      .option("--count-contains <text>", "Optional contains filter applied to --count-selector matches")
      .option("--count-visible-only", "Only include visible matches when using --count-selector", false)
      .option("--settle-ms <ms>", "Settle delay after each scroll step in milliseconds", "300")
      .option("--timeout-ms <ms>", "Command timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(async (
        targetId: string,
        options: {
          steps: string;
          countSelector?: string;
          countContains?: string;
          countVisibleOnly?: boolean;
          settleMs: string;
          timeoutMs: number;
          persist?: boolean;
          fields?: string;
        },
      ) => {
        const output = ctx.globalOutputOpts();
        const globalOpts = ctx.program.opts<{ session?: string }>();
        const fields = parseFieldsCsv(options.fields);
        try {
          const report = await targetScrollPlan({
            targetId,
            timeoutMs: options.timeoutMs,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
            stepsCsv: options.steps,
            countSelectorQuery: options.countSelector,
            countContainsQuery: options.countContains,
            countVisibleOnly: Boolean(options.countVisibleOnly),
            settleMs: Number.parseInt(options.settleMs, 10),
            persistState: options.persist !== false,
          });
          ctx.printTargetSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
        } catch (error) {
          ctx.handleFailure(error, output);
        }
      });
  },
};

export const targetScrollSampleCommandSpec: TargetCommandSpec = {
  id: scrollSampleMeta.id,
  usage: scrollSampleMeta.usage,
  summary: scrollSampleMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("scroll-sample")
      .description(scrollSampleMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--selector <query>", "Selector query to sample during scroll plan")
      .option("--contains <text>", "Optional contains filter applied to selector matches")
      .option("--visible-only", "Require sampled target to be visible", false)
      .option("--property <name>", "Property to sample (computed style by default)", "transform")
      .option("--steps <csv>", "Comma-separated requested scrollY positions", "0,300,600,900")
      .option("--settle-ms <ms>", "Settle delay after each scroll step in milliseconds", "300")
      .option("--timeout-ms <ms>", "Command timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            selector?: string;
            contains?: string;
            visibleOnly?: boolean;
            property: string;
            steps: string;
            settleMs: string;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          try {
            const report = await targetScrollSample({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
              property: options.property,
              stepsCsv: options.steps,
              settleMs: Number.parseInt(options.settleMs, 10),
              persistState: options.persist !== false,
            });
            ctx.printTargetSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};

export const targetScrollWatchCommandSpec: TargetCommandSpec = {
  id: scrollWatchMeta.id,
  usage: scrollWatchMeta.usage,
  summary: scrollWatchMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("scroll-watch")
      .description(scrollWatchMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--selector <query>", "Selector query to watch during scroll plan")
      .option("--contains <text>", "Optional contains filter applied to selector matches")
      .option("--visible-only", "Require watched target to be visible", false)
      .option("--properties <csv>", "Comma-separated computed style properties", "position,top,transform,opacity")
      .option("--steps <csv>", "Comma-separated requested scrollY positions", "0,120,240,480,960")
      .option("--settle-ms <ms>", "Settle delay after each scroll step in milliseconds", "300")
      .option("--max-events <n>", "Maximum transition/animation events to return", "240")
      .option("--timeout-ms <ms>", "Command timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            selector?: string;
            contains?: string;
            visibleOnly?: boolean;
            properties: string;
            steps: string;
            settleMs: string;
            maxEvents: string;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          try {
            const report = await targetScrollWatch({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
              propertiesCsv: options.properties,
              stepsCsv: options.steps,
              settleMs: Number.parseInt(options.settleMs, 10),
              maxEvents: Number.parseInt(options.maxEvents, 10),
              persistState: options.persist !== false,
            });
            ctx.printTargetSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};

export const targetTransitionTraceCommandSpec: TargetCommandSpec = {
  id: transitionTraceMeta.id,
  usage: transitionTraceMeta.usage,
  summary: transitionTraceMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("transition-trace")
      .description(transitionTraceMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--capture-ms <ms>", "Capture window after optional click in milliseconds", "2500")
      .option("--max-events <n>", "Maximum transition/animation events to return", "120")
      .option("--click-text <query>", "Optional text query to click before capture")
      .option("--click-selector <query>", "Optional selector query to click before capture")
      .option("--contains <text>", "Optional contains filter when using --click-selector")
      .option("--visible-only", "Require click target to be visible", false)
      .option("--timeout-ms <ms>", "Command timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            captureMs: string;
            maxEvents: string;
            clickText?: string;
            clickSelector?: string;
            contains?: string;
            visibleOnly?: boolean;
            timeoutMs: number;
            persist?: boolean;
            fields?: string;
          },
        ) => {
          const output = ctx.globalOutputOpts();
          const globalOpts = ctx.program.opts<{ session?: string }>();
          const fields = parseFieldsCsv(options.fields);
          try {
            const report = await targetTransitionTrace({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              captureMs: Number.parseInt(options.captureMs, 10),
              maxEvents: Number.parseInt(options.maxEvents, 10),
              clickText: options.clickText,
              clickSelector: options.clickSelector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
              persistState: options.persist !== false,
            });
            ctx.printTargetSuccess(projectReportFields(report as unknown as Record<string, unknown>, fields), output);
          } catch (error) {
            ctx.handleFailure(error, output);
          }
        },
      );
  },
};
