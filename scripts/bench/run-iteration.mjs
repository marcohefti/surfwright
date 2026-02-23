#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  appendJsonl,
  fail,
  nowCompact,
  pad3,
  parseJsonStdout,
  readJson,
  readJsonl,
  runShell,
  toTagList,
} from "./lib/common.mjs";
import { getCoreMetrics, buildDelta } from "./lib/run-iteration-metrics.mjs";
import { buildCampaignSpec } from "./lib/run-iteration-spec.mjs";
import { parseRunIterationArgs } from "./lib/run-iteration-args.mjs";
import {
  buildScopeId,
  ensureHistoryFileHeader,
  ensureMissionAssets,
  makeHeadlessShim,
  resolveMissionSelection,
  scopePaths,
} from "./lib/run-iteration-support.mjs";

const die = (message) => fail(message, "bench-loop");

function main() {
  const args = parseRunIterationArgs(process.argv.slice(2), die);
  if (!fs.existsSync(args.configPath)) {
    die(`config not found: ${args.configPath}`);
  }

  const config = readJson(args.configPath);
  const repoRoot = process.cwd();
  const loopId = args.loopId || String(config.loopId || "").trim();
  if (!loopId) {
    die("loop id missing (set in config or --loop-id)");
  }

  let missionIds;
  try {
    missionIds = resolveMissionSelection(config, args);
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }

  const scopeId = String(args.scopeId || buildScopeId(missionIds)).trim();
  if (!scopeId) {
    die("scope id is empty");
  }

  const scoped = scopePaths(repoRoot, scopeId, args.historyPath);
  const historyPath = scoped.historyPath;

  try {
    ensureMissionAssets(repoRoot, missionIds);
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }

  if (!args.noHistory) {
    ensureHistoryFileHeader({ historyPath, loopId, scopeId, missionIds });
  }

  const historyAll = readJsonl(historyPath);
  const historyRows = historyAll
    .filter((row) => row && row.kind === "iteration" && row.loopId === loopId)
    .sort((a, b) => Number(a.iteration || 0) - Number(b.iteration || 0));

  const iteration = historyRows.length > 0 ? Number(historyRows[historyRows.length - 1].iteration || 0) + 1 : 1;
  const iterationId = `${nowCompact()}-i${pad3(iteration)}`;
  const label = args.label || `iter-${pad3(iteration)}`;
  const scopeSlug = scopeId.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
  const campaignId = `${loopId}-${scopeSlug}-i${pad3(iteration)}-${iterationId}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const iterationDir = path.resolve(repoRoot, "tmp/zerocontext/bench-loop", loopId, scopeId, iterationId);
  const logsDir = path.join(iterationDir, "logs");
  const reportDir = path.join(iterationDir, "report");
  const outRoot = path.join(iterationDir, "zcl-out");
  const metadataDir = path.join(iterationDir, "metadata");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });
  fs.mkdirSync(metadataDir, { recursive: true });

  const stageDurations = {};

  try {
    const gitHead = runShell("git rev-parse HEAD", { logPath: path.join(logsDir, "git-head.json") }).stdout.trim();
    const gitStatus = runShell("git status --porcelain", { logPath: path.join(logsDir, "git-status.json") }).stdout.trim();
    const changedFiles = gitStatus ? gitStatus.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
    fs.writeFileSync(path.join(metadataDir, "git.status.porcelain.txt"), `${gitStatus}\n`, "utf8");
    runShell(`git diff --binary > ${JSON.stringify(path.join(metadataDir, "git.diff.patch"))}`, {
      logPath: path.join(logsDir, "git-diff-worktree.json"),
    });
    runShell(`git diff --binary --staged > ${JSON.stringify(path.join(metadataDir, "git.diff.staged.patch"))}`, {
      logPath: path.join(logsDir, "git-diff-staged.json"),
    });

    const regenerateExamPack = args.regenerateExamPack == null ? Boolean(config.regenerateExamPack) : args.regenerateExamPack;
    if (regenerateExamPack) {
      const run = runShell("node scripts/zcl/build-browser-control-exam-pack.mjs", {
        logPath: path.join(logsDir, "stage-regenerate-exam-pack.json"),
      });
      stageDurations.regenerateExamPackMs = run.durationMs;
    }

    if (!args.skipPreflight) {
      const commands = Array.isArray(config.preflightCommands) ? config.preflightCommands : [];
      for (let idx = 0; idx < commands.length; idx += 1) {
        const cmd = String(commands[idx] || "").trim();
        if (!cmd) {
          continue;
        }
        const run = runShell(cmd, {
          logPath: path.join(logsDir, `stage-preflight-${pad3(idx + 1)}.json`),
        });
        stageDurations[`preflight${idx + 1}Ms`] = run.durationMs;
      }
    }

    const shim = makeHeadlessShim({ repoRoot, iterationDir, runShell });

    const specPath = path.join(iterationDir, "campaign.spec.yaml");
    const specText = buildCampaignSpec({
      config,
      loopId,
      campaignId,
      missionIds,
      outRoot,
      repoRoot,
      reportDir,
      shimDir: shim.shimDir,
      pathValue: shim.pathValue,
      surfwrightRealBin: shim.surfwrightRealBin,
    });
    fs.writeFileSync(specPath, `${specText}\n`, "utf8");

    if (args.dryRun) {
      const output = {
        ok: true,
        kind: "dry_run",
        loopId,
        scopeId,
        missionIds,
        iteration,
        iterationId,
        label,
        campaignId,
        historyPath: path.relative(repoRoot, historyPath),
        specPath: path.relative(repoRoot, specPath),
        iterationDir: path.relative(repoRoot, iterationDir),
      };
      if (args.json) {
        process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
      } else {
        process.stdout.write(`bench-loop: dry run ready #${iteration} ${scopeId} (${iterationId})\n`);
      }
      return;
    }

    const lintRun = runShell(`zcl campaign lint --spec ${JSON.stringify(specPath)} --json`, {
      logPath: path.join(logsDir, "stage-zcl-lint.json"),
    });
    stageDurations.zclLintMs = lintRun.durationMs;
    const lintJson = parseJsonStdout(lintRun, "campaign lint");
    fs.writeFileSync(path.join(reportDir, "campaign.lint.json"), `${JSON.stringify(lintJson, null, 2)}\n`, "utf8");

    const doctorRun = runShell(`zcl campaign doctor --spec ${JSON.stringify(specPath)} --json`, {
      logPath: path.join(logsDir, "stage-zcl-doctor.json"),
    });
    stageDurations.zclDoctorMs = doctorRun.durationMs;
    const doctorJson = parseJsonStdout(doctorRun, "campaign doctor");
    fs.writeFileSync(path.join(reportDir, "campaign.doctor.json"), `${JSON.stringify(doctorJson, null, 2)}\n`, "utf8");

    const campaignRun = runShell(`zcl campaign run --spec ${JSON.stringify(specPath)} --json`, {
      logPath: path.join(logsDir, "stage-zcl-run.json"),
      allowFailure: true,
    });
    stageDurations.zclRunMs = campaignRun.durationMs;
    const runJson = parseJsonStdout(campaignRun, "campaign run");
    fs.writeFileSync(path.join(reportDir, "campaign.run.json"), `${JSON.stringify(runJson, null, 2)}\n`, "utf8");

    const campaignReportRun = runShell(`zcl campaign report --spec ${JSON.stringify(specPath)} --json`, {
      logPath: path.join(logsDir, "stage-zcl-report.json"),
      allowFailure: true,
    });
    stageDurations.zclReportMs = campaignReportRun.durationMs;
    const reportJson = parseJsonStdout(campaignReportRun, "campaign report");
    fs.writeFileSync(path.join(reportDir, "campaign.report.json"), `${JSON.stringify(reportJson, null, 2)}\n`, "utf8");

    const runStatePath = path.join(outRoot, "campaigns", campaignId, "campaign.run.state.json");
    if (!fs.existsSync(runStatePath)) {
      throw new Error(`campaign run state not found: ${runStatePath}`);
    }

    const scoreRun = runShell(
      [
        "node scripts/bench/score-iteration.mjs",
        `--state ${JSON.stringify(runStatePath)}`,
        "--flow surfwright",
        `--out-dir ${JSON.stringify(reportDir)}`,
        `--label ${JSON.stringify(label)}`,
        "--json",
      ].join(" "),
      {
        logPath: path.join(logsDir, "stage-score-iteration.json"),
      },
    );
    stageDurations.scoreIterationMs = scoreRun.durationMs;
    const scoreJson = parseJsonStdout(scoreRun, "score iteration");
    fs.writeFileSync(path.join(reportDir, "score.summary.json"), `${JSON.stringify(scoreJson, null, 2)}\n`, "utf8");

    const metricsJsonPath = path.join(reportDir, "metrics.full.json");
    const metricsMdPath = path.join(reportDir, "metrics.summary.md");
    const missionCsvPath = path.join(reportDir, "mission.metrics.csv");
    const commandJsonPath = path.join(reportDir, "trace.command-durations.json");
    const metricsFull = readJson(metricsJsonPath);
    const metricsCore = getCoreMetrics(metricsFull);

    const headedCalls = Number(metricsFull?.aggregate?.actionable?.headedBrowserModeCallsTotal || 0);
    if (headedCalls > 0) {
      throw new Error(`headless guard failed: detected ${headedCalls} headed browser call(s)`);
    }

    const measured = historyRows.filter((row) => Number(row?.metrics?.attempts || 0) > 0);
    const previous = measured.length > 0 ? measured[measured.length - 1] : null;
    const baseline = measured.length > 0 ? measured[0] : null;
    const deltaPrev = previous ? buildDelta(metricsCore, previous.metrics || {}) : buildDelta(metricsCore, null);
    const deltaBaseline = baseline ? buildDelta(metricsCore, baseline.metrics || {}) : buildDelta(metricsCore, null);

    const historyEntry = {
      schemaVersion: 1,
      kind: "iteration",
      loopId,
      scopeId,
      missionScopeType: missionIds.length === 1 ? "single" : "cluster",
      missionId: missionIds.length === 1 ? missionIds[0] : "",
      missionIds,
      comparisonScope: "same-scope",
      iteration,
      iterationId,
      createdAt: new Date().toISOString(),
      label,
      hypothesis: args.hypothesis || "",
      change: args.change || "",
      changeTags: toTagList(args.tags),
      noCommitPush: true,
      git: {
        head: gitHead,
        changedFilesCount: changedFiles.length,
        changedFiles,
        statusPath: path.relative(repoRoot, path.join(metadataDir, "git.status.porcelain.txt")),
        diffPath: path.relative(repoRoot, path.join(metadataDir, "git.diff.patch")),
        stagedDiffPath: path.relative(repoRoot, path.join(metadataDir, "git.diff.staged.patch")),
      },
      run: {
        campaignId: String(reportJson?.campaignId || campaignId),
        runId: String(reportJson?.runId || ""),
        status: String(reportJson?.status || ""),
        gatesPassed: Number(reportJson?.gatesPassed || 0),
        gatesFailed: Number(reportJson?.gatesFailed || 0),
        outRoot: path.relative(repoRoot, outRoot),
        specPath: path.relative(repoRoot, specPath),
      },
      metrics: metricsCore,
      deltas: {
        vsPrev: deltaPrev,
        vsBaseline: deltaBaseline,
      },
      artifacts: {
        iterationDir: path.relative(repoRoot, iterationDir),
        runStatePath: path.relative(repoRoot, runStatePath),
        metricsJsonPath: path.relative(repoRoot, metricsJsonPath),
        metricsMdPath: path.relative(repoRoot, metricsMdPath),
        missionCsvPath: path.relative(repoRoot, missionCsvPath),
        commandJsonPath: path.relative(repoRoot, commandJsonPath),
        reportDir: path.relative(repoRoot, reportDir),
        logsDir: path.relative(repoRoot, logsDir),
      },
      stageDurations,
    };

    fs.writeFileSync(path.join(reportDir, "history.entry.preview.json"), `${JSON.stringify(historyEntry, null, 2)}\n`, "utf8");

    if (!args.noHistory) {
      appendJsonl(historyPath, historyEntry);
      runShell(
        [
          "node scripts/bench/summarize-history.mjs",
          `--history ${JSON.stringify(historyPath)}`,
          `--config ${JSON.stringify(args.configPath)}`,
          `--loop-id ${JSON.stringify(loopId)}`,
          `--scope-id ${JSON.stringify(scopeId)}`,
          `--out-md ${JSON.stringify(scoped.outMd)}`,
          `--out-json ${JSON.stringify(scoped.outJson)}`,
          `--out-brief ${JSON.stringify(scoped.outBrief)}`,
        ].join(" "),
        {
          logPath: path.resolve(iterationDir, "last-summarize-history.json"),
          allowFailure: true,
        },
      );
    }

    const output = {
      ok: true,
      loopId,
      scopeId,
      missionIds,
      iteration,
      iterationId,
      label,
      historyPath: path.relative(repoRoot, historyPath),
      campaignId,
      runStatePath: path.relative(repoRoot, runStatePath),
      metricsJsonPath: path.relative(repoRoot, metricsJsonPath),
      resultSheetPath: path.relative(repoRoot, scoped.outMd),
    };

    if (args.json) {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } else {
      process.stdout.write(`bench-loop: completed #${iteration} ${scopeId} (${iterationId})\n`);
      if (!args.noHistory) {
        process.stdout.write(`bench-loop: history appended to ${path.relative(repoRoot, historyPath)}\n`);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const payload = error instanceof Error && error.payload ? error.payload : null;

    const failureEntry = {
      schemaVersion: 1,
      kind: "iteration",
      loopId,
      scopeId,
      missionScopeType: missionIds.length === 1 ? "single" : "cluster",
      missionId: missionIds.length === 1 ? missionIds[0] : "",
      missionIds,
      comparisonScope: "same-scope",
      iteration,
      iterationId,
      createdAt: new Date().toISOString(),
      label,
      hypothesis: args.hypothesis || "",
      change: args.change || "",
      changeTags: toTagList(args.tags),
      noCommitPush: true,
      status: "failed",
      error: {
        message: errorMessage,
        payload,
      },
    };

    if (!args.noHistory) {
      appendJsonl(historyPath, failureEntry);
      runShell(
        [
          "node scripts/bench/summarize-history.mjs",
          `--history ${JSON.stringify(historyPath)}`,
          `--config ${JSON.stringify(args.configPath)}`,
          `--loop-id ${JSON.stringify(loopId)}`,
          `--scope-id ${JSON.stringify(scopeId)}`,
          `--out-md ${JSON.stringify(scoped.outMd)}`,
          `--out-json ${JSON.stringify(scoped.outJson)}`,
          `--out-brief ${JSON.stringify(scoped.outBrief)}`,
        ].join(" "),
        {
          logPath: path.resolve(iterationDir, "last-summarize-history.json"),
          allowFailure: true,
        },
      );
    }

    const output = {
      ok: false,
      loopId,
      scopeId,
      missionIds,
      iteration,
      iterationId,
      label,
      historyPath: path.relative(repoRoot, historyPath),
      error: errorMessage,
    };

    if (args.json) {
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    } else {
      process.stdout.write(`bench-loop: failed #${iteration} ${scopeId} (${iterationId}): ${errorMessage}\n`);
    }
    process.exit(1);
  }
}

main();
