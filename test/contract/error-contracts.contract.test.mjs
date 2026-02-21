import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runCli(args, env) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function parseJson(text) {
  const trimmed = text.trim();
  assert.notEqual(trimmed.length, 0, "Expected JSON output on stdout");
  return JSON.parse(trimmed);
}

function extractErrorContractCodes(sourceText) {
  const codes = [];
  const pattern = /code:\s*"([^"]+)"/g;
  let match;
  while ((match = pattern.exec(sourceText)) !== null) {
    codes.push(match[1]);
  }
  return codes;
}

test("contract errors match src/core/contracts/error-contracts.ts codes", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-error-contracts-"));
  try {
    const contractResult = runCli(["contract"], { SURFWRIGHT_STATE_DIR: stateDir });
    assert.equal(contractResult.status, 0);
    const contract = parseJson(contractResult.stdout);
    const contractCodes = new Set((contract?.errors ?? []).map((e) => e.code).filter((c) => typeof c === "string"));

    const srcPath = path.join(process.cwd(), "src", "core", "contracts", "error-contracts.ts");
    const srcText = fs.readFileSync(srcPath, "utf8");
    const sourceCodes = extractErrorContractCodes(srcText);
    assert.ok(sourceCodes.length > 0, "Expected error-contracts.ts to declare at least one code");

    const sourceSet = new Set(sourceCodes);
    assert.equal(sourceSet.size, sourceCodes.length, "Duplicate error codes detected in error-contracts.ts");

    const missingInContract = [...sourceSet].filter((c) => !contractCodes.has(c)).sort();
    const missingInSource = [...contractCodes].filter((c) => !sourceSet.has(c)).sort();
    assert.deepEqual(
      { missingInContract, missingInSource },
      { missingInContract: [], missingInSource: [] },
    );
  } finally {
    try {
      fs.rmSync(stateDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
});
