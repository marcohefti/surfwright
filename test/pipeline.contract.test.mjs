import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-pipeline-"));

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
    },
  });
}

function runCliWithInput(args, input) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
    },
  });
}

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output on stdout");
  return JSON.parse(text);
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("run doctor validates inline plan-json without browser execution", () => {
  const plan = {
    steps: [
      { id: "open", url: "https://example.com" },
      { id: "snapshot" },
    ],
  };
  const result = runCli(["run",
    "--doctor",
    "--plan-json",
    JSON.stringify(plan),
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "doctor");
  assert.equal(payload.valid, true);
  assert.equal(typeof payload.stepCount, "number");
});

test("run doctor returns exit code 1 for lint-invalid plan", () => {
  const invalid = { steps: [{ id: "open" }] };
  const result = runCli(["run",
    "--doctor",
    "--plan-json",
    JSON.stringify(invalid),
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "doctor");
  assert.equal(payload.valid, false);
  assert.equal(Array.isArray(payload.issues), true);
  assert.equal(payload.issues.length > 0, true);
});

test("run doctor accepts stdin plan source", () => {
  const plan = { steps: [{ id: "open", url: "https://example.com" }] };
  const result = runCliWithInput(
    ["run", "--doctor", "--plan", "-", "--timeout-ms", "5000"],
    JSON.stringify(plan),
  );
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "doctor");
});

test("run doctor rejects invalid plan-json JSON with typed failure", () => {
  const result = runCli(["run", "--doctor", "--plan-json", "{", "--timeout-ms", "5000"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("run doctor rejects invalid plan file JSON with typed failure", () => {
  const planPath = path.join(TEST_STATE_DIR, "invalid-plan.json");
  fs.writeFileSync(planPath, "{", "utf8");
  const result = runCli(["run", "--doctor", "--plan", planPath, "--timeout-ms", "5000"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("run rejects invalid step shapes before session resolution", () => {
  const plan = { steps: [{ id: "open", url: "https://example.com" }, { id: "snapshot", targetId: 42 }] };
  const result = runCli(["run", "--plan-json", JSON.stringify(plan), "--timeout-ms", "5000"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_QUERY_INVALID");
});

test("run doctor accepts fill/upload step shapes", () => {
  const plan = {
    steps: [
      { id: "open", url: "https://example.com" },
      { id: "fill", selector: "#email", value: "agent@example.com" },
      { id: "upload", selector: "input[type=file]", files: ["./fixture.txt"] },
    ],
  };
  const result = runCli(["run",
    "--doctor",
    "--plan-json",
    JSON.stringify(plan),
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "doctor");
  assert.equal(payload.valid, true);
});

test("run doctor accepts click-read step shape", () => {
  const plan = {
    steps: [
      { id: "open", url: "https://example.com" },
      { id: "click-read", selector: "a.docs", readSelector: "main", chunkSize: 800, chunk: 1 },
    ],
  };
  const result = runCli(["run",
    "--doctor",
    "--plan-json",
    JSON.stringify(plan),
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "doctor");
  assert.equal(payload.valid, true);
});

test("run doctor accepts count step shape", () => {
  const plan = {
    steps: [
      { id: "open", url: "https://example.com" },
      { id: "count", selector: ".row", visibleOnly: true },
    ],
  };
  const result = runCli(["run",
    "--doctor",
    "--plan-json",
    JSON.stringify(plan),
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "doctor");
  assert.equal(payload.valid, true);
});

test("run doctor accepts scroll-plan step shape", () => {
  const plan = {
    steps: [
      { id: "open", url: "https://example.com" },
      { id: "scroll-plan", steps: "0,1,1", countSelector: ".row", settleMs: 200 },
    ],
  };
  const result = runCli(["run",
    "--doctor",
    "--plan-json",
    JSON.stringify(plan),
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "doctor");
  assert.equal(payload.valid, true);
});

test("run doctor accepts repeat-until step shape", () => {
  const plan = {
    steps: [
      { id: "open", url: "https://example.com" },
      {
        id: "repeat-until",
        step: { id: "count", selector: ".row" },
        untilPath: "count",
        untilGte: 3,
        maxAttempts: 4,
      },
    ],
  };
  const result = runCli(["run",
    "--doctor",
    "--plan-json",
    JSON.stringify(plan),
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "doctor");
  assert.equal(payload.valid, true);
});

test("run doctor rejects repeat-until without condition", () => {
  const plan = {
    steps: [
      { id: "open", url: "https://example.com" },
      {
        id: "repeat-until",
        step: { id: "count", selector: ".row" },
        untilPath: "count",
      },
    ],
  };
  const result = runCli(["run",
    "--doctor",
    "--plan-json",
    JSON.stringify(plan),
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "doctor");
  assert.equal(payload.valid, false);
});

test("run doctor accepts result projection map shape", () => {
  const plan = {
    steps: [
      { id: "open", url: "https://example.com" },
      { id: "count", selector: "a", as: "links" },
    ],
    result: {
      linkCount: "steps.links.count",
    },
  };
  const result = runCli(["run",
    "--doctor",
    "--plan-json",
    JSON.stringify(plan),
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(result.status, 0);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "doctor");
  assert.equal(payload.valid, true);
  assert.equal(payload.resultMapFields, 1);
});

test("run doctor rejects result projection with non-string path", () => {
  const plan = {
    steps: [
      { id: "open", url: "https://example.com" },
    ],
    result: {
      linkCount: 42,
    },
  };
  const result = runCli(["run",
    "--doctor",
    "--plan-json",
    JSON.stringify(plan),
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, "doctor");
  assert.equal(payload.valid, false);
});
