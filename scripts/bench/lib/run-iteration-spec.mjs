import path from "node:path";

function yamlQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function yamlInlineArray(values) {
  return `[${values.map((v) => yamlQuote(v)).join(", ")}]`;
}

function buildFlowLines({
  flowIds,
  config,
  maxInflightPerStrategy,
  minStartIntervalMs,
  surfwrightRealBin,
  shimDir,
  pathValue,
}) {
  const lines = [];
  for (let idx = 0; idx < flowIds.length; idx += 1) {
    const flowId = flowIds[idx];
    const slot = idx + 1;
    lines.push(`  - flowId: ${flowId}`);
    lines.push("    runner:");
    lines.push("      type: codex_app_server");
    lines.push("      sessionIsolation: native");
    lines.push("      runtimeStrategies: ['codex_app_server']");
    lines.push(`      model: ${config.model}`);
    lines.push(`      modelReasoningEffort: ${config.reasoningEffort}`);
    lines.push(`      modelReasoningPolicy: ${config.reasoningPolicy}`);
    lines.push("      feedbackPolicy: strict");
    lines.push("      mode: discovery");
    lines.push(`      freshAgentPerAttempt: ${config.freshAgentPerAttempt ? "true" : "false"}`);
    lines.push("      toolDriver:");
    lines.push("        kind: mcp_proxy");
    lines.push("      finalization:");
    lines.push("        mode: auto_from_result_json");
    lines.push("        minResultTurn: 3");
    lines.push("        resultChannel:");
    lines.push("          kind: file_json");
    lines.push("          path: mission.result.json");
    lines.push("      mcp:");
    lines.push(`        maxToolCalls: ${config.mcpMaxToolCalls}`);
    lines.push(`        idleTimeoutMs: ${config.mcpIdleTimeoutMs}`);
    lines.push("        shutdownOnComplete: true");
    lines.push("      env:");
    lines.push("        ZCL_BROWSER_SURFACE: surfwright");
    lines.push(`        ZCL_NATIVE_MAX_INFLIGHT_PER_STRATEGY: '${maxInflightPerStrategy}'`);
    lines.push(`        ZCL_NATIVE_MIN_START_INTERVAL_MS: '${minStartIntervalMs}'`);
    lines.push(`        ZCL_BENCH_AGENT_SLOT: '${slot}'`);
    lines.push(`        ZCL_BENCH_SURFWRIGHT_REAL_BIN: ${yamlQuote(surfwrightRealBin)}`);
    lines.push(`        ZCL_BENCH_SURFWRIGHT_SHIM_DIR: ${yamlQuote(shimDir)}`);
    lines.push(`        PATH: ${yamlQuote(pathValue)}`);
  }
  return lines;
}

export function buildCampaignSpec({
  config,
  loopId,
  campaignId,
  missionIds,
  flowIds,
  maxInflightPerStrategy,
  minStartIntervalMs,
  outRoot,
  repoRoot,
  reportDir,
  shimDir,
  pathValue,
  surfwrightRealBin,
}) {
  const promptsPath = path.resolve(repoRoot, "missions/browser-control/prompts");
  const oraclesPath = path.resolve(repoRoot, "missions/browser-control/oracles");
  const evaluatorPath = path.resolve(repoRoot, "scripts/zcl/eval-browser-control-oracle.mjs");
  const missionLines = missionIds.map((id) => `      - ${id}`).join("\n");
  const flowLines = buildFlowLines({
    flowIds,
    config,
    maxInflightPerStrategy,
    minStartIntervalMs,
    surfwrightRealBin,
    shimDir,
    pathValue,
  });

  return [
    "schemaVersion: 1",
    `campaignId: ${campaignId}`,
    `outRoot: ${yamlQuote(outRoot)}`,
    "promptMode: exam",
    "",
    `totalMissions: ${missionIds.length}`,
    `canaryMissions: ${Math.min(2, missionIds.length)}`,
    "failFast: false",
    "",
    "missionSource:",
    "  promptSource:",
    `    path: ${yamlQuote(promptsPath)}`,
    "  oracleSource:",
    `    path: ${yamlQuote(oraclesPath)}`,
    "    visibility: workspace",
    "  selection:",
    "    mode: mission_id",
    "    missionIds:",
    missionLines,
    "",
    "evaluation:",
    "  mode: oracle",
    "  evaluator:",
    "    kind: script",
    `    command: ${yamlInlineArray(["node", evaluatorPath])}`,
    "",
    "execution:",
    `  flowMode: ${flowIds.length > 1 ? "parallel" : "sequence"}`,
    "",
    "pairGate:",
    "  enabled: true",
    "  stopOnFirstMissionFailure: false",
    "  traceProfile: none",
    "",
    "timeouts:",
    `  campaignGlobalTimeoutMs: ${config.campaignGlobalTimeoutMs}`,
    `  defaultAttemptTimeoutMs: ${config.attemptTimeoutMs}`,
    "  cleanupHookTimeoutMs: 10000",
    "  timeoutStart: first_tool_call",
    "",
    "output:",
    `  reportPath: ${yamlQuote(path.join(reportDir, "campaign.report.json"))}`,
    `  summaryPath: ${yamlQuote(path.join(reportDir, "campaign.summary.json"))}`,
    `  resultsMdPath: ${yamlQuote(path.join(reportDir, "RESULTS.md"))}`,
    `  progressJsonl: ${yamlQuote(path.join(reportDir, "campaign.progress.jsonl"))}`,
    "",
    "flows:",
    ...flowLines,
    "",
    `# loopId: ${loopId}`,
  ].join("\n");
}
