import type { Command } from "commander";
import { DEFAULT_TARGET_TIMEOUT_MS } from "../../../core/types.js";
import { expEffectsCommandMeta } from "./manifest.js";

type OutputOpts = {
  json: boolean;
  pretty: boolean;
};

type RegisterExpEffectsCommandsOptions = {
  program: Command;
  parseTimeoutMs: (input: string) => number;
  globalOutputOpts: () => OutputOpts;
  handleFailure: (error: unknown, outputOpts: OutputOpts) => void;
};

function writeJson(value: unknown, opts: { pretty: boolean }) {
  process.stdout.write(`${JSON.stringify(value, null, opts.pretty ? 2 : 0)}\n`);
}

function printExpEffectsReport(report: Record<string, unknown>, opts: OutputOpts) {
  if (opts.json) {
    writeJson(report, { pretty: opts.pretty });
    return;
  }

  const observedCount = Array.isArray(report.observedEffects) ? report.observedEffects.length : 0;
  const declaredCount = Array.isArray(report.declaredEffects) ? report.declaredEffects.length : 0;
  const profile = typeof report.profile === "string" ? report.profile : "fast";
  const targetId = typeof report.targetId === "string" ? report.targetId : "unknown";

  process.stdout.write(
    [
      "ok",
      "stability=experimental",
      `targetId=${targetId}`,
      `profile=${profile}`,
      `observed=${observedCount}`,
      `declared=${declaredCount}`,
    ].join(" ") + "\n",
  );
}

function ensureExpCommand(program: Command): Command {
  const existing = program.commands.find((entry) => entry.name() === "exp");
  if (existing) {
    return existing;
  }
  return program.command("exp").description("Experimental feature surface");
}

export function registerExpEffectsCommands(opts: RegisterExpEffectsCommandsOptions) {
  const exp = ensureExpCommand(opts.program);
  const meta = expEffectsCommandMeta("exp.effects");

  exp
    .command("effects")
    .description(meta.summary)
    .argument("<targetId>", "Target handle returned by open/target list")
    .option("--profile <preset>", "Probe profile to run (fast|comprehensive)", "fast")
    .option("--include-declared", "Include declared CSS effect candidates", false)
    .option("--timeout-ms <ms>", "Probe timeout budget in milliseconds", opts.parseTimeoutMs, DEFAULT_TARGET_TIMEOUT_MS)
    .action(
      async (
        targetId: string,
        options: {
          profile?: string;
          includeDeclared?: boolean;
          timeoutMs: number;
        },
      ) => {
        const output = opts.globalOutputOpts();
        const globalOpts = opts.program.opts<{ session?: string }>();
        try {
          const report = {
            ok: true,
            stability: "experimental",
            targetId,
            sessionId: typeof globalOpts.session === "string" ? globalOpts.session : null,
            profile: options.profile === "comprehensive" ? "comprehensive" : "fast",
            timeoutMs: options.timeoutMs,
            observedEffects: [],
            declaredEffects: options.includeDeclared ? [] : [],
            unobservedCandidates: [],
            coverage: {
              stimuli: ["idle"],
              viewport: null,
              durationMs: 0,
            },
            blindSpots: [
              "No active probes are executed yet; this command is a plugin scaffold.",
              "Use target.eval for custom instrumentation until probes are implemented.",
            ],
          } as const;
          printExpEffectsReport(report as unknown as Record<string, unknown>, output);
        } catch (error) {
          opts.handleFailure(error, output);
        }
      },
    );
}
