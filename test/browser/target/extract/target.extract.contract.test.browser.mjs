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
  const doctor = runCli(["doctor"]);
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
  const openResult = runCli(["open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
  const openPayload = parseJson(openResult.stdout);

  const extractResult = runCli(["target",
    "extract",
    openPayload.targetId,
    "--kind",
    "table-rows",
    "--schema-json",
    "{\"name\":\"record.Company\",\"score\":\"record.Score\"}",
    "--dedupe-by",
    "name,score",
    "--summary",
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
  assert.equal(typeof payload.summary, "object");
  assert.equal(payload.summary.itemCount, 2);
  assert.equal(payload.summary.totalRawCount, 3);
  assert.equal(payload.summary.firstTitle, "SurfWright");
  assert.equal(payload.summary.firstCommand, null);
  assert.equal(typeof payload.proof, "object");
  assert.deepEqual(payload.records[0], { name: "SurfWright", score: "99" });
  assert.deepEqual(payload.records[1], { name: "Chrome MCP", score: "72" });
});

test("target extract table-rows works when selector points directly to a table", () => {
  requireBrowser();
  const html = `
    <title>Extract Table Selector Root</title>
    <table id="scores">
      <thead><tr><th>Company</th><th>Score</th></tr></thead>
      <tbody>
        <tr><td>SurfWright</td><td>99</td></tr>
        <tr><td>Chrome MCP</td><td>72</td></tr>
      </tbody>
    </table>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
  const openPayload = parseJson(openResult.stdout);

  const extractResult = runCli(["target",
    "extract",
    openPayload.targetId,
    "--kind",
    "table-rows",
    "--selector",
    "#scores",
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
  assert.equal(Array.isArray(payload.records), true);
  assert.equal(payload.records.length, 2);
  assert.deepEqual(payload.records[0], { name: "SurfWright", score: "99" });
  assert.deepEqual(payload.records[1], { name: "Chrome MCP", score: "72" });
});

test("target extract --output-shape proof derives compact proof without --summary", () => {
  requireBrowser();
  const html = `
    <title>Extract Docs Commands</title>
    <main>
      <h2>Install</h2>
      <pre><code>curl -LsSf http://127.0.0.1/install.sh | sh</code></pre>
      <pre><code>uv python install 3.13</code></pre>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
  const openPayload = parseJson(openResult.stdout);

  const extractResult = runCli(["--output-shape",
    "proof",
    "target",
    "extract",
    openPayload.targetId,
    "--kind",
    "docs-commands",
    "--selector",
    "main",
    "--limit",
    "10",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(extractResult.status, 0, extractResult.stdout || extractResult.stderr);
  const payload = parseJson(extractResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.targetId, openPayload.targetId);
  assert.equal(typeof payload.proof, "object");
  assert.equal(payload.proof.count >= 2, true);
  assert.equal(payload.proof.firstCommand, "curl");
});

test("target extract --kind command-lines returns normalized runnable commands", () => {
  requireBrowser();
  const html = `
    <title>Extract Command Lines</title>
    <main>
      <h2>Install</h2>
      <pre><code>$ uv tool install surfwright
uv python install 3.13</code></pre>
      <pre><code># comment
curl -LsSf http://127.0.0.1/install.sh | sh</code></pre>
    </main>
  `;
  const dataUrl = `data:text/html,${encodeURIComponent(html)}`;
  const openResult = runCli(["open", dataUrl, "--timeout-ms", "5000"]);
  assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
  const openPayload = parseJson(openResult.stdout);

  const extractResult = runCli(["target",
    "extract",
    openPayload.targetId,
    "--kind",
    "command-lines",
    "--selector",
    "main",
    "--limit",
    "10",
    "--timeout-ms",
    "5000",
  ]);
  assert.equal(extractResult.status, 0, extractResult.stdout || extractResult.stderr);
  const payload = parseJson(extractResult.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.kind, "command-lines");
  assert.equal(Array.isArray(payload.items), true);
  assert.equal(payload.items.length >= 3, true);
  assert.equal(payload.items[0].command, "uv tool install surfwright");
  assert.equal(payload.items[1].command, "uv python install 3.13");
  assert.equal(payload.items[2].command, "curl -LsSf http://127.0.0.1/install.sh | sh");
});
