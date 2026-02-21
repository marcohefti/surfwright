import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-open-redirect-");
const { runCliSync, runCliAsync } = createCliRunner({ stateDir: TEST_STATE_DIR });
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

let hasBrowserCache;
function hasBrowser() {
  if (typeof hasBrowserCache === "boolean") {
    return hasBrowserCache;
  }
  const doctor = runCli(["doctor"]);
  const payload = parseJson(doctor.stdout);
  hasBrowserCache =
    payload?.chrome?.found === true && runCli(["session", "ensure", "--timeout-ms", "4000"]).status === 0;
  return hasBrowserCache;
}

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright doctor`)");
}

async function withHttpServer(handler, fn) {
  let baseUrl = "";
  const server = http.createServer((req, res) => handler(req, res, baseUrl));
  baseUrl = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to read local test server address"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
}

test("open reports requestedUrl/finalUrl redirect evidence", async () => {
  requireBrowser();

  await withHttpServer((req, res, baseUrl) => {
    if (req.url === "/start") {
      res.writeHead(302, { location: `${baseUrl}/final` });
      res.end("");
      return;
    }
    if (req.url === "/final") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<title>Final</title><main>ok</main>");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }, async (baseUrl) => {
    const requested = `${baseUrl}/start`;
    const finalUrl = `${baseUrl}/final`;

    const openResult = await runCliAsync(["open", requested, "--timeout-ms", "8000"]);
    assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
    const openPayload = parseJson(openResult.stdout);
    assert.equal(openPayload.ok, true);
    assert.equal(openPayload.requestedUrl, requested);
    assert.equal(openPayload.finalUrl, finalUrl);
    assert.equal(openPayload.url, openPayload.finalUrl);
    assert.equal(openPayload.wasRedirected, true);
    assert.equal(openPayload.redirectChainTruncated, false);
    assert.equal(Array.isArray(openPayload.redirectChain), true);
    assert.equal(openPayload.redirectChain[0], openPayload.requestedUrl);
    assert.equal(openPayload.redirectChain[openPayload.redirectChain.length - 1], openPayload.finalUrl);
  });
});
