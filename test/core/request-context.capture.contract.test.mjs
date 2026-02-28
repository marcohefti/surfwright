import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runNodeModule(code) {
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
}

function parseJsonLine(stdout) {
  const text = String(stdout ?? "").trim();
  assert.notEqual(text.length, 0, "expected JSON output");
  return JSON.parse(text);
}

test("captured request context output is deterministically truncated at configured byte cap", () => {
  const result = runNodeModule(`
    import process from "node:process";
    import { withCapturedRequestContext } from "./src/core/request-context.ts";

    const payload = await withCapturedRequestContext({
      maxCapturedOutputBytes: 32,
      run: async () => {
        process.stdout.write("x".repeat(100));
        process.stderr.write("y".repeat(80));
        return 0;
      },
    });
    console.log(JSON.stringify({ stdout: payload.stdout, stderr: payload.stderr }));
  `);
  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(typeof payload.stdout, "string");
  assert.equal(typeof payload.stderr, "string");
  assert.equal(payload.stdout.includes("truncated at 32 bytes"), true);
  assert.equal(payload.stdout.includes("(68 bytes omitted)"), true);
  assert.equal(payload.stderr.includes("truncated at 32 bytes"), true);
  assert.equal(payload.stderr.includes("(48 bytes omitted)"), true);
});
