import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { parseTraceStats } from "../../scripts/bench/lib/score-helpers.mjs";

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-headless-guard-"));
const WRAPPER_PATH = path.resolve("scripts/bench/surfwright-headless-wrapper.sh");

function writeFakeSurfwright() {
  const fakeBin = path.join(TMP_DIR, "fake-surfwright.sh");
  const fakeArgsOut = path.join(TMP_DIR, "fake-args.txt");
  fs.writeFileSync(
    fakeBin,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "printf '%s\\n' \"$@\" > \"${FAKE_ARGS_OUT}\"",
      "exit 0",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.chmodSync(fakeBin, 0o755);
  return { fakeBin, fakeArgsOut };
}

test("headless wrapper rejects headed browser mode before launch", () => {
  const { fakeBin, fakeArgsOut } = writeFakeSurfwright();
  try {
    fs.rmSync(fakeArgsOut, { force: true });
  } catch {
    // ignore
  }

  const headed = spawnSync(WRAPPER_PATH, ["open", "https://example.com", "--browser-mode", "headed"], {
    encoding: "utf8",
    env: {
      ...process.env,
      ZCL_BENCH_SURFWRIGHT_REAL_BIN: fakeBin,
      FAKE_ARGS_OUT: fakeArgsOut,
    },
  });
  assert.equal(headed.status, 64);
  assert.equal(headed.stderr.includes("headed mode is not allowed"), true);
  assert.equal(fs.existsSync(fakeArgsOut), false);

  const headless = spawnSync(WRAPPER_PATH, ["open", "https://example.com", "--browser-mode", "headless"], {
    encoding: "utf8",
    env: {
      ...process.env,
      ZCL_BENCH_SURFWRIGHT_REAL_BIN: fakeBin,
      FAKE_ARGS_OUT: fakeArgsOut,
    },
  });
  assert.equal(headless.status, 0);
  const args = fs.readFileSync(fakeArgsOut, "utf8");
  assert.equal(args.includes("--browser-mode"), true);
  assert.equal(args.includes("headless"), true);
});

test("trace scoring counts only successful headed executions", () => {
  const tracePath = path.join(TMP_DIR, "tool.calls.jsonl");
  const lines = [
    {
      op: "exec_command_begin",
      input: {
        payload: {
          msg: {
            command: ["/bin/zsh", "-lc", "surfwright open https://example.com --browser-mode headed"],
          },
        },
      },
    },
    {
      op: "item_completed",
      input: {
        payload: {
          item: {
            type: "commandExecution",
            durationMs: 1000,
            exitCode: 64,
            command: "/bin/zsh -lc 'surfwright open https://example.com --browser-mode headed'",
          },
        },
      },
    },
    {
      op: "exec_command_begin",
      input: {
        payload: {
          msg: {
            command: ["/bin/zsh", "-lc", "surfwright open https://example.com --browser-mode headed --wait-until load"],
          },
        },
      },
    },
    {
      op: "item_completed",
      input: {
        payload: {
          item: {
            type: "commandExecution",
            durationMs: 1200,
            exitCode: 0,
            command: "/bin/zsh -lc 'surfwright open https://example.com --browser-mode headed --wait-until load'",
          },
        },
      },
    },
  ];
  fs.writeFileSync(tracePath, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  const stats = parseTraceStats(tracePath, "018-infinite-scroll-chunks", "attempt-1");
  assert.equal(stats.surfwrightCliCalls, 2);
  assert.equal(stats.headedBrowserModeCalls, 1);
});

process.on("exit", () => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});
