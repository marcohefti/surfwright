import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { readJson, readJsonLines, shortId, slug, stampUtc, writeJson, writeText } from "./io.mjs";

function loadSuite(suitePath) {
  const suite = readJson(suitePath);
  if (suite?.schemaVersion !== 1) {
    throw new Error("suite schemaVersion must be 1");
  }
  if (!Array.isArray(suite.tasks) || suite.tasks.length === 0) {
    throw new Error("suite.tasks must contain at least one task");
  }
  for (const task of suite.tasks) {
    if (!task || typeof task !== "object") {
      throw new Error("suite.tasks entries must be objects");
    }
    if (typeof task.id !== "string" || task.id.trim().length === 0) {
      throw new Error("each task requires non-empty id");
    }
    if (typeof task.prompt !== "string" || task.prompt.trim().length === 0) {
      throw new Error(`task ${task.id} requires non-empty prompt`);
    }
  }
  return suite;
}

function findExecutable(binName, envPath) {
  const isPathLike = binName.includes("/") || binName.includes("\\");
  if (isPathLike) {
    const absolute = path.resolve(binName);
    fs.accessSync(absolute, fs.constants.X_OK);
    return absolute;
  }
  const searchPath = envPath ?? process.env.PATH ?? "";
  for (const dir of searchPath.split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = path.join(dir, binName);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // continue
    }
  }
  throw new Error(`unable to resolve executable on PATH: ${binName}`);
}

function buildPrompt(suite, task, includeFeedbackInstruction, feedbackPrefix) {
  const lines = [];
  if (typeof suite.agentPreamble === "string" && suite.agentPreamble.trim().length > 0) {
    lines.push(suite.agentPreamble.trim());
  }
  lines.push(task.prompt.trim());
  if (includeFeedbackInstruction) {
    lines.push(
      [
        "At the very end, emit one line that starts exactly with:",
        `${feedbackPrefix} {\"confidence\":0.0,\"friction\":\"...\",\"missingCommand\":\"...\",\"suggestion\":\"...\"}`,
      ].join("\n"),
    );
  }
  return `${lines.join("\n\n")}\n`;
}

function interpolate(template, values) {
  return template.replace(/\{([a-z_]+)\}/g, (match, key) => {
    const value = values[key];
    return typeof value === "string" ? value : match;
  });
}

function buildShimScript({ traceFile, binName, realCommand }) {
  return `#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { spawnSync } from "node:child_process";

const TRACE_FILE = ${JSON.stringify(traceFile)};
const BIN_NAME = ${JSON.stringify(binName)};
const REAL = ${JSON.stringify(realCommand)};
const startedAt = Date.now();
const args = process.argv.slice(2);
const result = spawnSync(REAL[0], [...REAL.slice(1), ...args], {
  encoding: "utf8",
  stdio: ["inherit", "pipe", "pipe"],
  env: process.env,
  cwd: process.cwd(),
});
if (typeof result.stdout === "string" && result.stdout.length > 0) {
  process.stdout.write(result.stdout);
}
if (typeof result.stderr === "string" && result.stderr.length > 0) {
  process.stderr.write(result.stderr);
}
const event = {
  ts: new Date(startedAt).toISOString(),
  bin: BIN_NAME,
  argv: args,
  cwd: process.cwd(),
  status: typeof result.status === "number" ? result.status : 1,
  signal: result.signal ?? null,
  durationMs: Date.now() - startedAt,
  stdoutPreview: (result.stdout ?? "").slice(0, 2000),
  stderrPreview: (result.stderr ?? "").slice(0, 2000),
};
try {
  fs.appendFileSync(TRACE_FILE, JSON.stringify(event) + "\\n", "utf8");
} catch {
  // best-effort tracing
}
if (result.error) {
  process.stderr.write(String(result.error.message || result.error) + "\\n");
}
if (typeof result.status === "number") {
  process.exit(result.status);
}
process.exit(1);
`;
}

function setupShims(attemptDir, traceBins) {
  const shimDir = path.join(attemptDir, "bin");
  const traceFile = path.join(attemptDir, "commands.jsonl");
  fs.mkdirSync(shimDir, { recursive: true });
  fs.writeFileSync(traceFile, "", "utf8");

  for (const binName of traceBins) {
    const sanitized = binName.replace(/[^a-zA-Z0-9._-]/g, "");
    if (!sanitized || sanitized !== binName) {
      throw new Error(`invalid trace bin name: ${binName}`);
    }
    const realCommand =
      binName === "surfwright" ? [process.execPath, path.join(process.cwd(), "dist", "cli.js")] : [findExecutable(binName)];
    if (binName === "surfwright" && !fs.existsSync(realCommand[1])) {
      throw new Error("dist/cli.js not found. Build first with: pnpm -s build");
    }
    const shimPath = path.join(shimDir, binName);
    fs.writeFileSync(shimPath, buildShimScript({ traceFile, binName, realCommand }), "utf8");
    fs.chmodSync(shimPath, 0o755);
  }

  return {
    traceFile,
    shimDir,
  };
}

function parseFeedback(stdoutText, feedbackPrefix) {
  const lines = stdoutText.split("\n");
  const raw = [...lines].reverse().find((line) => line.trim().startsWith(feedbackPrefix));
  if (!raw) {
    return { found: false, value: null, parseError: null };
  }
  const jsonText = raw.trim().slice(feedbackPrefix.length).trim();
  try {
    return { found: true, value: JSON.parse(jsonText), parseError: null };
  } catch {
    return { found: true, value: null, parseError: "invalid-json" };
  }
}

function evaluateTask(task, attempt) {
  const checks = [];
  const expect = task.expect && typeof task.expect === "object" ? task.expect : {};

  if (Array.isArray(expect.stdoutIncludes)) {
    for (const needle of expect.stdoutIncludes) {
      const ok = typeof needle === "string" && attempt.stdout.includes(needle);
      checks.push({ kind: "stdoutIncludes", target: needle, ok });
    }
  }
  if (typeof expect.stdoutRegex === "string" && expect.stdoutRegex.length > 0) {
    let ok = false;
    try {
      ok = new RegExp(expect.stdoutRegex, "m").test(attempt.stdout);
    } catch {
      ok = false;
    }
    checks.push({ kind: "stdoutRegex", target: expect.stdoutRegex, ok });
  }
  if (typeof expect.maxCliCommands === "number") {
    checks.push({ kind: "maxCliCommands", target: expect.maxCliCommands, ok: attempt.traceEvents.length <= expect.maxCliCommands });
  }
  if (expect.requireFeedback === true) {
    checks.push({ kind: "requireFeedback", target: true, ok: attempt.feedback.found && attempt.feedback.parseError === null });
  }

  const baseOk = attempt.exitCode === 0;
  const checksOk = checks.every((check) => check.ok);
  return {
    passed: baseOk && checksOk,
    checks,
  };
}

function summarizeResults(attempts) {
  const total = attempts.length;
  const passed = attempts.filter((entry) => entry.passed).length;
  const avgDurationMs = total > 0 ? Math.round(attempts.reduce((acc, entry) => acc + entry.durationMs, 0) / total) : 0;
  const avgCliCommands = total > 0 ? Number((attempts.reduce((acc, entry) => acc + entry.traceEvents.length, 0) / total).toFixed(2)) : 0;
  const avgCliFailures =
    total > 0
      ? Number(
          (
            attempts.reduce((acc, entry) => acc + entry.traceEvents.filter((event) => typeof event.status === "number" && event.status !== 0).length, 0) /
            total
          ).toFixed(2),
        )
      : 0;

  const friction = new Map();
  for (const attempt of attempts) {
    const text = typeof attempt.feedback?.value?.friction === "string" ? attempt.feedback.value.friction.trim() : "";
    if (!text) {
      continue;
    }
    friction.set(text, (friction.get(text) ?? 0) + 1);
  }
  const topFriction = [...friction.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([text, count]) => ({ text, count }));

  return {
    total,
    passed,
    failed: total - passed,
    passRate: total === 0 ? 0 : Number(((passed / total) * 100).toFixed(2)),
    avgDurationMs,
    avgCliCommands,
    avgCliFailures,
    topFriction,
  };
}

export function runHarness(opts) {
  const suitePath = path.resolve(opts.suitePath);
  const suite = loadSuite(suitePath);
  const runId = `${stampUtc()}-${shortId()}`;
  const labelPart = opts.label ? `-${slug(opts.label)}` : "";
  const runDir = path.resolve(opts.outRoot, `${runId}${labelPart}`);

  if (opts.dryRun) {
    const plan = [];
    let planIndex = 0;
    for (const task of suite.tasks) {
      for (let repeat = 1; repeat <= opts.repeat; repeat += 1) {
        planIndex += 1;
        const attemptId = `${slug(task.id) || "task"}-r${repeat}`;
        const attemptDir = path.join(runDir, "attempts", `${String(planIndex).padStart(3, "0")}-${attemptId}`);
        const promptFile = path.join(attemptDir, "prompt.txt");
        plan.push({
          taskId: task.id,
          attempt: repeat,
          attemptId,
          attemptDir,
          command: interpolate(opts.agentCmd, {
            prompt_file: promptFile,
            task_id: task.id,
            run_id: runId,
            attempt_id: attemptId,
            attempt_dir: attemptDir,
          }),
        });
      }
    }
    const dryResult = {
      ok: true,
      mode: "dry-run",
      runId,
      runDir,
      suite: suite.name ?? path.basename(suitePath),
      attemptsPlanned: plan.length,
      plan,
    };
    process.stdout.write(`${opts.json ? JSON.stringify(dryResult, null, 2) : JSON.stringify(dryResult)}\n`);
    return;
  }

  fs.mkdirSync(runDir, { recursive: true });
  writeJson(path.join(runDir, "suite.snapshot.json"), suite);
  const attempts = [];
  let ordinal = 0;

  for (const task of suite.tasks) {
    for (let repeat = 1; repeat <= opts.repeat; repeat += 1) {
      ordinal += 1;
      const attemptId = `${slug(task.id) || "task"}-r${repeat}`;
      const attemptDir = path.join(runDir, "attempts", `${String(ordinal).padStart(3, "0")}-${attemptId}`);
      fs.mkdirSync(attemptDir, { recursive: true });

      const promptText = buildPrompt(suite, task, opts.includeFeedbackInstruction, opts.feedbackPrefix);
      const promptFile = path.join(attemptDir, "prompt.txt");
      writeText(promptFile, promptText);

      const shims = setupShims(attemptDir, opts.traceBins);
      const commandText = interpolate(opts.agentCmd, {
        prompt_file: promptFile,
        task_id: task.id,
        run_id: runId,
        attempt_id: attemptId,
        attempt_dir: attemptDir,
      });

      const stateDir = path.join(attemptDir, "state");
      fs.mkdirSync(stateDir, { recursive: true });
      const env = {
        ...process.env,
        PATH: `${shims.shimDir}${path.delimiter}${process.env.PATH ?? ""}`,
        SURFWRIGHT_STATE_DIR: stateDir,
        ZCL_RUN_ID: runId,
        ZCL_TASK_ID: task.id,
        ZCL_ATTEMPT_ID: attemptId,
      };

      const startedAt = Date.now();
      const spawn = spawnSync(commandText, {
        shell: true,
        encoding: "utf8",
        env,
        cwd: process.cwd(),
        timeout: opts.timeoutMs > 0 ? opts.timeoutMs : undefined,
        maxBuffer: 20 * 1024 * 1024,
      });
      const durationMs = Date.now() - startedAt;
      const stdout = spawn.stdout ?? "";
      const stderr = spawn.stderr ?? "";
      writeText(path.join(attemptDir, "agent.stdout.log"), stdout);
      writeText(path.join(attemptDir, "agent.stderr.log"), stderr);
      writeText(path.join(attemptDir, "agent.command.txt"), `${commandText}\n`);

      const traceEvents = readJsonLines(shims.traceFile);
      const feedback = parseFeedback(stdout, opts.feedbackPrefix);
      writeJson(path.join(attemptDir, "feedback.json"), feedback);

      const attempt = {
        taskId: task.id,
        attempt: repeat,
        attemptId,
        attemptDir,
        startedAt: new Date(startedAt).toISOString(),
        durationMs,
        exitCode: typeof spawn.status === "number" ? spawn.status : 1,
        signal: spawn.signal ?? null,
        timedOut: Boolean(spawn.error && opts.timeoutMs > 0 && durationMs >= opts.timeoutMs),
        stdout,
        stderr,
        feedback,
        traceEvents,
      };
      const evaluation = evaluateTask(task, attempt);
      attempts.push({
        ...attempt,
        passed: evaluation.passed,
        checks: evaluation.checks,
      });

      process.stdout.write(
        `zcl run ${ordinal}/${suite.tasks.length * opts.repeat} task=${task.id} attempt=${repeat} exit=${attempt.exitCode} passed=${evaluation.passed}\n`,
      );
    }
  }

  const summary = summarizeResults(attempts);
  const runReport = {
    ok: true,
    name: "ZeroContext Lab",
    runId,
    runDir,
    createdAt: new Date().toISOString(),
    suite: {
      name: suite.name ?? path.basename(suitePath),
      path: suitePath,
      taskCount: suite.tasks.length,
    },
    options: {
      repeat: opts.repeat,
      timeoutMs: opts.timeoutMs,
      traceBins: opts.traceBins,
      includeFeedbackInstruction: opts.includeFeedbackInstruction,
      feedbackPrefix: opts.feedbackPrefix,
      host: os.hostname(),
      platform: process.platform,
      node: process.version,
    },
    summary,
    attempts: attempts.map((entry) => ({
      taskId: entry.taskId,
      attempt: entry.attempt,
      attemptId: entry.attemptId,
      attemptDir: entry.attemptDir,
      exitCode: entry.exitCode,
      durationMs: entry.durationMs,
      passed: entry.passed,
      checks: entry.checks,
      feedback: entry.feedback,
      traceCounts: {
        total: entry.traceEvents.length,
        failed: entry.traceEvents.filter((event) => typeof event.status === "number" && event.status !== 0).length,
      },
    })),
  };

  writeJson(path.join(runDir, "run.json"), runReport);
  const output = opts.json ? JSON.stringify(runReport, null, 2) : JSON.stringify(runReport);
  process.stdout.write(`${output}\n`);

  if (opts.failOnFail && summary.failed > 0) {
    process.exit(1);
  }
}
