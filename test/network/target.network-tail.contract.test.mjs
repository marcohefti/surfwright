import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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

  const result = spawnSync(process.execPath, ["dist/cli.js", "--json", "doctor"], { encoding: "utf8" });
  if (result.status !== 0) {
    hasBrowserCache = false;
    return hasBrowserCache;
  }
  const payload = parseJson(result.stdout);
  hasBrowserCache = payload?.chrome?.found === true;
  return hasBrowserCache;
}

test("target network-tail --failed-only emits only failed request events", { skip: !hasBrowser() }, () => {
  const dataHtml = [
    "<!doctype html>",
    "<meta charset=utf-8>",
    "<title>Network Tail</title>",
    '<img src="https://example.com/" alt="ok">',
    '<script src="https://example.invalid/fail.js"></script>',
  ].join("");
  const url = `data:text/html,${encodeURIComponent(dataHtml)}`;

  const tailStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-network-tail-contract-"));
  const runCliTail = (args) =>
    spawnSync(process.execPath, ["dist/cli.js", ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        SURFWRIGHT_STATE_DIR: tailStateDir,
      },
    });

  try {
    const ensureResult = runCliTail(["--json", "session", "ensure", "--timeout-ms", "6000"]);
    assert.equal(ensureResult.status, 0, ensureResult.stdout || ensureResult.stderr);
    const ensurePayload = parseJson(ensureResult.stdout);

    const openResult = runCliTail([
      "--json",
      "--session",
      ensurePayload.sessionId,
      "open",
      url,
      "--timeout-ms",
      "20000",
    ]);
    assert.equal(openResult.status, 0, openResult.stdout || openResult.stderr);
    const openPayload = parseJson(openResult.stdout);

    const tail = runCliTail([
      "--json",
      "--session",
      ensurePayload.sessionId,
      "target",
      "network-tail",
      openPayload.targetId,
      "--capture-ms",
      "4000",
      "--max-events",
      "50",
      "--failed-only",
      "--reload",
      "--timeout-ms",
      "20000",
    ]);
    assert.equal(tail.status, 0, tail.stdout || tail.stderr);

    const lines = tail.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    assert.equal(lines.length > 0, true);
    const events = lines.map((line) => JSON.parse(line));

    assert.equal(events.some((e) => e?.type === "capture" && e?.phase === "end"), true);
    assert.equal(events.some((e) => e?.type === "request" && e?.phase === "failed"), true);
    assert.equal(events.some((e) => e?.type === "request" && e?.phase === "start"), false);
    assert.equal(events.some((e) => e?.type === "request" && e?.phase === "end"), false);
  } finally {
    try {
      const statePath = path.join(tailStateDir, "state.json");
      if (fs.existsSync(statePath)) {
        const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
        const sessions = state?.sessions ?? {};
        for (const session of Object.values(sessions)) {
          if (!session || typeof session !== "object") {
            continue;
          }
          if (session.kind !== "managed") {
            continue;
          }
          if (typeof session.browserPid !== "number" || !Number.isFinite(session.browserPid) || session.browserPid <= 0) {
            continue;
          }
          try {
            process.kill(session.browserPid, "SIGTERM");
          } catch {
            // ignore already-dead processes
          }
        }
      }
    } catch {
      // ignore cleanup failures
    }
    try {
      fs.rmSync(tailStateDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
