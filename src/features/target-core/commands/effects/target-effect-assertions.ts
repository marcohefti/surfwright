import {
  parseFieldsCsv,
  projectReportFields,
  targetHover,
  targetMotionDetect,
  targetScrollRevealScan,
  targetStickyCheck,
  targetTransitionAssert,
} from "../../../../core/usecases.js";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../../core/types.js";
import { targetCommandMeta } from "../../manifest.js";
import type { TargetCommandSpec } from "../types.js";

const hoverMeta = targetCommandMeta("target.hover");
const stickyCheckMeta = targetCommandMeta("target.sticky-check");
const motionDetectMeta = targetCommandMeta("target.motion-detect");
const transitionAssertMeta = targetCommandMeta("target.transition-assert");
const scrollRevealScanMeta = targetCommandMeta("target.scroll-reveal-scan");

export const targetHoverCommandSpec: TargetCommandSpec = {
  id: hoverMeta.id,
  usage: hoverMeta.usage,
  summary: hoverMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("hover")
      .description(hoverMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--text <query>", "Text query to match target element")
      .option("--selector <query>", "Selector query to match target element")
      .option("--contains <text>", "Optional contains filter when using --selector")
      .option("--visible-only", "Require hovered target to be visible", false)
      .option("--properties <csv>", "Comma-separated computed style properties", "color,background-color,box-shadow,transform,opacity")
      .option("--settle-ms <ms>", "Delay after hover in milliseconds", "180")
      .option("--timeout-ms <ms>", "Command timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            text?: string;
            selector?: string;
            contains?: string;
            visibleOnly?: boolean;
            properties: string;
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
            const report = await targetHover({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              textQuery: options.text,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
              propertiesCsv: options.properties,
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

export const targetStickyCheckCommandSpec: TargetCommandSpec = {
  id: stickyCheckMeta.id,
  usage: stickyCheckMeta.usage,
  summary: stickyCheckMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("sticky-check")
      .description(stickyCheckMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--selector <query>", "Selector query for potential sticky element", "header")
      .option("--contains <text>", "Optional contains filter when using --selector")
      .option("--visible-only", "Require candidate target to be visible", false)
      .option("--steps <csv>", "Comma-separated requested scrollY positions", "0,220,640,0")
      .option("--settle-ms <ms>", "Settle delay after each scroll step in milliseconds", "300")
      .option("--timeout-ms <ms>", "Command timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            selector: string;
            contains?: string;
            visibleOnly?: boolean;
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
            const report = await targetStickyCheck({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
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

export const targetMotionDetectCommandSpec: TargetCommandSpec = {
  id: motionDetectMeta.id,
  usage: motionDetectMeta.usage,
  summary: motionDetectMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("motion-detect")
      .description(motionDetectMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--selector <query>", "Selector query for element to observe")
      .option("--contains <text>", "Optional contains filter when using --selector")
      .option("--visible-only", "Require observed target to be visible", false)
      .option("--property <name>", "Property to sample (computed style by default)", "transform")
      .option("--interval-ms <ms>", "Sampling interval in milliseconds", "350")
      .option("--duration-ms <ms>", "Capture window in milliseconds", "2800")
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
            const report = await targetMotionDetect({
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

export const targetTransitionAssertCommandSpec: TargetCommandSpec = {
  id: transitionAssertMeta.id,
  usage: transitionAssertMeta.usage,
  summary: transitionAssertMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("transition-assert")
      .description(transitionAssertMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--cycles <n>", "Number of trigger cycles to run", "2")
      .option("--capture-ms <ms>", "Capture window after each trigger in milliseconds", "2500")
      .option("--max-events <n>", "Maximum events to return for each cycle", "120")
      .option("--click-text <query>", "Text query to click for each cycle")
      .option("--click-selector <query>", "Selector query to click for each cycle")
      .option("--contains <text>", "Optional contains filter when using --click-selector")
      .option("--visible-only", "Require click target to be visible", false)
      .option("--timeout-ms <ms>", "Command timeout in milliseconds", ctx.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
      .option("--no-persist", "Skip writing target metadata to local state")
      .option("--fields <csv>", "Return only selected top-level fields")
      .action(
        async (
          targetId: string,
          options: {
            cycles: string;
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
            const report = await targetTransitionAssert({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              cycles: Number.parseInt(options.cycles, 10),
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

export const targetScrollRevealScanCommandSpec: TargetCommandSpec = {
  id: scrollRevealScanMeta.id,
  usage: scrollRevealScanMeta.usage,
  summary: scrollRevealScanMeta.summary,
  register: (ctx) => {
    ctx.target
      .command("scroll-reveal-scan")
      .description(scrollRevealScanMeta.summary)
      .argument("<targetId>", "Target handle returned by open/target list")
      .option("--selector <query>", "Optional selector to scan (auto-discovery when omitted)")
      .option("--contains <text>", "Optional contains filter when using --selector")
      .option("--visible-only", "Require scanned targets to be visible", false)
      .option("--max-candidates <n>", "Maximum candidates to scan", "6")
      .option("--steps <csv>", "Comma-separated requested scrollY positions", "0,260,620")
      .option("--settle-ms <ms>", "Settle delay after each scroll step in milliseconds", "260")
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
            maxCandidates: string;
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
            const report = await targetScrollRevealScan({
              targetId,
              timeoutMs: options.timeoutMs,
              sessionId: typeof globalOpts.session === "string" ? globalOpts.session : undefined,
              selectorQuery: options.selector,
              containsQuery: options.contains,
              visibleOnly: Boolean(options.visibleOnly),
              maxCandidates: Number.parseInt(options.maxCandidates, 10),
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
