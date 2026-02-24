import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const EVALUATOR_PATH = path.join(process.cwd(), "scripts", "zcl", "eval-browser-control-oracle.mjs");

function runEvaluator(opts) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-zcl-oracle-"));
  const attemptDir = path.join(tmpDir, "attempt");
  const oraclePath = path.join(tmpDir, "oracle.json");
  fs.mkdirSync(attemptDir, { recursive: true });
  fs.writeFileSync(path.join(attemptDir, "feedback.json"), `${JSON.stringify({ result: opts.proof })}\n`, "utf8");
  fs.writeFileSync(oraclePath, `${JSON.stringify(opts.oracle)}\n`, "utf8");

  const result = spawnSync(process.execPath, [EVALUATOR_PATH], {
    encoding: "utf8",
    env: {
      ...process.env,
      ZCL_ATTEMPT_DIR: attemptDir,
      ZCL_ORACLE_PATH: oraclePath,
    },
  });

  fs.rmSync(tmpDir, { recursive: true, force: true });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout.trim());
  return payload;
}

test("zcl oracle evaluator accepts equivalent value encodings for eq checks", () => {
  const oracle = {
    missionId: "normalization-check",
    collectFields: ["blogUrl", "downloadsItems", "paddingTopPx", "installCommand"],
    rules: [
      { field: "blogUrl", op: "eq", value: "https://blog.heftiweb.ch" },
      { field: "downloadsItems", op: "eq", value: "PDF, CSV, Excel" },
      { field: "paddingTopPx", op: "eq", value: 6 },
      { field: "installCommand", op: "eq", value: "curl -LsSf https://astral.sh/uv/install.sh | sh" },
    ],
  };

  const proof = {
    blogUrl: "https://blog.heftiweb.ch/",
    downloadsItems: ["PDF", "CSV", "Excel"],
    paddingTopPx: "6px",
    installCommand: "$ curl -LsSf https://astral.sh/uv/install.sh | sh",
  };

  const verdict = runEvaluator({ oracle, proof });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.reasonCodes, []);
});

test("zcl oracle evaluator still fails non-equivalent mismatches", () => {
  const oracle = {
    missionId: "strict-mismatch-check",
    collectFields: ["freePlanStandardSupport"],
    rules: [{ field: "freePlanStandardSupport", op: "eq", value: false }],
  };

  const proof = {
    freePlanStandardSupport: true,
  };

  const verdict = runEvaluator({ oracle, proof });
  assert.equal(verdict.ok, false);
  assert.equal(Array.isArray(verdict.reasonCodes), true);
  assert.equal(verdict.reasonCodes.includes("ZCL_E_CAMPAIGN_ORACLE_EVALUATION_FAILED"), true);
});
