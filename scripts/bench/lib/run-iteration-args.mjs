import path from "node:path";
import process from "node:process";

export function parseRunIterationArgs(argv, die) {
  const out = {
    configPath: path.resolve(process.cwd(), "bench/agent-loop/config.json"),
    historyPath: "",
    loopId: "",
    scopeId: "",
    missionId: "",
    missionIdsCsv: "",
    label: "",
    hypothesis: "",
    change: "",
    tags: "",
    regenerateExamPack: null,
    skipPreflight: false,
    noHistory: false,
    dryRun: false,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--config") {
      out.configPath = argv[i + 1] ? path.resolve(process.cwd(), argv[i + 1]) : out.configPath;
      i += 1;
      continue;
    }
    if (token === "--history") {
      out.historyPath = argv[i + 1] ? path.resolve(process.cwd(), argv[i + 1]) : "";
      i += 1;
      continue;
    }
    if (token === "--loop-id") {
      out.loopId = argv[i + 1] || out.loopId;
      i += 1;
      continue;
    }
    if (token === "--scope-id") {
      out.scopeId = argv[i + 1] || out.scopeId;
      i += 1;
      continue;
    }
    if (token === "--mission-id") {
      out.missionId = argv[i + 1] || out.missionId;
      i += 1;
      continue;
    }
    if (token === "--mission-ids") {
      out.missionIdsCsv = argv[i + 1] || out.missionIdsCsv;
      i += 1;
      continue;
    }
    if (token === "--label") {
      out.label = argv[i + 1] || out.label;
      i += 1;
      continue;
    }
    if (token === "--hypothesis") {
      out.hypothesis = argv[i + 1] || out.hypothesis;
      i += 1;
      continue;
    }
    if (token === "--change") {
      out.change = argv[i + 1] || out.change;
      i += 1;
      continue;
    }
    if (token === "--tags") {
      out.tags = argv[i + 1] || out.tags;
      i += 1;
      continue;
    }
    if (token === "--regenerate-exam-pack") {
      out.regenerateExamPack = true;
      continue;
    }
    if (token === "--skip-regenerate-exam-pack") {
      out.regenerateExamPack = false;
      continue;
    }
    if (token === "--skip-preflight") {
      out.skipPreflight = true;
      continue;
    }
    if (token === "--no-history") {
      out.noHistory = true;
      continue;
    }
    if (token === "--dry-run") {
      out.dryRun = true;
      continue;
    }
    if (token === "--json") {
      out.json = true;
      continue;
    }
    if (token === "-h" || token === "--help") {
      process.stdout.write(
        [
          "Usage: node scripts/bench/run-iteration.mjs [options]",
          "",
          "One invocation = one campaign run = one mission scope (single mission or cluster).",
          "",
          "Options:",
          "  --config <path>                 Loop config JSON (default: bench/agent-loop/config.json)",
          "  --history <path>                Override history JSONL path for this scope",
          "  --loop-id <id>                  Override loop id",
          "  --scope-id <id>                 Override scope id (default derived from mission ids)",
          "  --mission-id <id>               Run one mission",
          "  --mission-ids <csv>             Run mission cluster (comma-separated)",
          "  --label <text>                  Iteration label",
          "  --hypothesis <text>             Hypothesis note",
          "  --change <text>                 Change summary",
          "  --tags <csv>                    Change tags",
          "  --regenerate-exam-pack          Rebuild browser-control exam assets before run",
          "  --skip-regenerate-exam-pack     Disable exam pack rebuild",
          "  --skip-preflight                Skip configured preflight commands",
          "  --no-history                    Do not append to history.jsonl",
          "  --dry-run                       Generate spec and metadata only",
          "  --json                          Print JSON result",
        ].join("\n") + "\n",
      );
      process.exit(0);
    }
    die(`unknown argument: ${token}`);
  }

  return out;
}
