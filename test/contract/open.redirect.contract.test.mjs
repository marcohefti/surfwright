import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-open-redirect-"));

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
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

let hasBrowserCache;
function hasBrowser() {
  if (typeof hasBrowserCache === "boolean") {
    return hasBrowserCache;
  }
  const doctor = runCli(["--json", "doctor"]);
  const payload = parseJson(doctor.stdout);
  hasBrowserCache =
    payload?.chrome?.found === true && runCli(["--json", "session", "ensure", "--timeout-ms", "4000"]).status === 0;
  return hasBrowserCache;
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("open reports requestedUrl/finalUrl redirect evidence", { skip: !hasBrowser() }, () => {
  const openResult = runCli(["--json", "open", "http://example.com", "--timeout-ms", "20000"]);
  assert.equal(openResult.status, 0);
  const openPayload = parseJson(openResult.stdout);
  assert.equal(openPayload.ok, true);
  assert.equal(openPayload.requestedUrl, "http://example.com/");
  assert.equal(openPayload.finalUrl, "https://example.com/");
  assert.equal(openPayload.url, openPayload.finalUrl);
  assert.equal(openPayload.wasRedirected, true);
  assert.equal(openPayload.redirectChainTruncated, false);
  assert.equal(Array.isArray(openPayload.redirectChain), true);
  assert.equal(openPayload.redirectChain[0], openPayload.requestedUrl);
  assert.equal(openPayload.redirectChain[openPayload.redirectChain.length - 1], openPayload.finalUrl);
});
