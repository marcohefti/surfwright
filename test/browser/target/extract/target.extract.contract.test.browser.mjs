import assert from "node:assert/strict";
import test from "node:test";
import { createCliRunner } from "../../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-target-extract-");
const { runCliSync } = createCliRunner({ stateDir: TEST_STATE_DIR });
test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
});

function runCli(args) {
  return runCliSync(args);
}

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output on stdout");
  return JSON.parse(text);
}

function requireBrowser() {
  const doctor = runCli(["--json", "doctor"]);
  assert.equal(doctor.status, 0, doctor.stdout || doctor.stderr);
  const payload = parseJson(doctor.stdout);
  assert.equal(payload?.chrome?.found === true, true, "Chrome/Chromium not found (required for browser contract tests)");
}

test("target extract supports table-rows schema mapping and deterministic dedupe", () => {
  requireBrowser();
  const html = `
    <title>Extract Table Rows</title>
    <table id="scores">
      <thead><tr><th>Company</th><th>Score</th></tr></thead>
      <tbody>
        <tr><td>SurfWright</td><td>99</td></tr>
        <tr><td>Chrome MCP</td><td>72</td></tr>
        <tr><td>SurfWright</td><td>99</td></tr>
      </tbody>
    </table>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["--json", "open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
  const openPayload = parseJson(openResult.stdout);

  const extractResult = runCli([
    "--json",
    "target",
    "extract",
    openPayload.targetId,
    "--kind",
    "table-rows",
    "--schema-json",
    "{\"name\":\"record.Company\",\"score\":\"record.Score\"}",
    "--dedupe-by",
    "name,score",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(extractResult.status, 0, extractResult.stdout || extractResult.stderr);
  const payload = parseJson(extractResult.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.kind, "table-rows");
  assert.equal(typeof payload.schema, "object");
  assert.equal(Array.isArray(payload.records), true);
  assert.equal(payload.records.length, 2);
  assert.deepEqual(payload.records[0], { name: "SurfWright", score: "99" });
  assert.deepEqual(payload.records[1], { name: "Chrome MCP", score: "72" });
});
