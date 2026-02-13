export const DEFAULT_OUT_ROOT = ".zerocontext-lab/runs";
export const DEFAULT_FEEDBACK_PREFIX = "ZCL_FEEDBACK:";

export function usage() {
  return [
    "Usage:",
    "  node scripts/zerocontext-lab.mjs run --suite <path> --agent-cmd <template> [options]",
    "  node scripts/zerocontext-lab.mjs report [--run <runDir|run.json>] [--out-root <dir>] [--json]",
    "",
    "Run options:",
    "  --suite <path>          Suite JSON path (schemaVersion=1)",
    "  --agent-cmd <template>  Shell command template with {prompt_file}",
    "  --repeat <n>            Attempts per task (default: 1)",
    "  --out-root <dir>        Root output directory (default: .zerocontext-lab/runs)",
    "  --label <text>          Optional run label",
    "  --timeout-ms <ms>       Agent command timeout per attempt (0 = no timeout)",
    "  --trace-bin <name>      Additional binary to shim-log (repeatable)",
    "  --feedback-prefix <txt> Feedback line prefix (default: ZCL_FEEDBACK:)",
    "  --no-feedback           Do not append feedback instruction",
    "  --dry-run               Plan only, do not execute",
    "  --fail-on-fail          Exit non-zero if any attempt fails expectations",
    "  --json                  Emit JSON result",
    "",
    "Template placeholders:",
    "  {prompt_file} {task_id} {run_id} {attempt_id} {attempt_dir}",
  ].join("\n");
}

export function parseIntArg(name, value, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export function parseArgs(argv) {
  const sub = argv[0];
  if (!sub || sub === "-h" || sub === "--help") {
    return { mode: "help" };
  }

  if (sub === "run") {
    const opts = {
      suitePath: "",
      agentCmd: "",
      repeat: 1,
      outRoot: DEFAULT_OUT_ROOT,
      label: "",
      timeoutMs: 0,
      traceBins: ["surfwright"],
      includeFeedbackInstruction: true,
      feedbackPrefix: DEFAULT_FEEDBACK_PREFIX,
      dryRun: false,
      failOnFail: false,
      json: false,
    };

    for (let i = 1; i < argv.length; i += 1) {
      const token = argv[i];
      if (token === "--suite") {
        opts.suitePath = argv[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (token === "--agent-cmd") {
        opts.agentCmd = argv[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (token === "--repeat") {
        opts.repeat = parseIntArg("repeat", argv[i + 1] ?? "", 1, 100);
        i += 1;
        continue;
      }
      if (token === "--out-root") {
        opts.outRoot = argv[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (token === "--label") {
        opts.label = argv[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (token === "--timeout-ms") {
        opts.timeoutMs = parseIntArg("timeout-ms", argv[i + 1] ?? "", 0, 24 * 60 * 60 * 1000);
        i += 1;
        continue;
      }
      if (token === "--trace-bin") {
        const value = argv[i + 1] ?? "";
        if (!value) {
          throw new Error("--trace-bin requires a binary name");
        }
        opts.traceBins.push(value);
        i += 1;
        continue;
      }
      if (token === "--feedback-prefix") {
        opts.feedbackPrefix = argv[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (token === "--no-feedback") {
        opts.includeFeedbackInstruction = false;
        continue;
      }
      if (token === "--dry-run") {
        opts.dryRun = true;
        continue;
      }
      if (token === "--fail-on-fail") {
        opts.failOnFail = true;
        continue;
      }
      if (token === "--json") {
        opts.json = true;
        continue;
      }
      if (token === "-h" || token === "--help") {
        return { mode: "help" };
      }
      throw new Error(`Unknown argument: ${token}`);
    }

    if (!opts.suitePath) {
      throw new Error("--suite is required");
    }
    if (!opts.agentCmd) {
      throw new Error("--agent-cmd is required");
    }
    if (!opts.agentCmd.includes("{prompt_file}")) {
      throw new Error("--agent-cmd must include {prompt_file} placeholder");
    }
    if (!opts.feedbackPrefix.trim()) {
      throw new Error("--feedback-prefix cannot be empty");
    }

    opts.traceBins = [...new Set(opts.traceBins.map((entry) => entry.trim()).filter(Boolean))];
    return { mode: "run", ...opts };
  }

  if (sub === "report") {
    const opts = {
      runPath: "",
      outRoot: DEFAULT_OUT_ROOT,
      json: false,
    };

    for (let i = 1; i < argv.length; i += 1) {
      const token = argv[i];
      if (token === "--run") {
        opts.runPath = argv[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (token === "--out-root") {
        opts.outRoot = argv[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (token === "--json") {
        opts.json = true;
        continue;
      }
      if (token === "-h" || token === "--help") {
        return { mode: "help" };
      }
      throw new Error(`Unknown argument: ${token}`);
    }
    return { mode: "report", ...opts };
  }

  throw new Error(`Unknown subcommand: ${sub}`);
}
