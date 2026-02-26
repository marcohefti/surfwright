import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function runCli(args, env = {}) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-runtime-migration-"));
  try {
    return spawnSync(process.execPath, ["dist/cli.js", ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        SURFWRIGHT_DAEMON: "0",
        SURFWRIGHT_STATE_DIR: stateDir,
        ...env,
      },
    });
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output");
  return JSON.parse(text);
}

function runNodeModule(code) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", code],
    { encoding: "utf8", cwd: process.cwd() },
  );
}

test("open runtime-access migration keeps invalid-url failure parity", () => {
  const result = runCli(["open", "camelpay.localhost"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_URL_INVALID");
  assert.equal(payload.message, "URL must be absolute (e.g. https://example.com)");
});

test("target runtime-access migration keeps representative unknown-session parity", () => {
  const result = runCli(["target", "eval", "DEADBEEF", "--expression", "1 + 1"]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(new Set(["E_TARGET_SESSION_UNKNOWN", "E_TARGET_NOT_FOUND"]).has(payload.code), true);
});

test("withSessionBrowser enforces deterministic dual-session acquire/release ordering", () => {
  const result = runNodeModule(`
    import { chromium } from "playwright-core";
    import { withSessionBrowser } from "./src/core/session/infra/runtime-access.ts";

    const events = [];
    const originalConnect = chromium.connectOverCDP.bind(chromium);
    chromium.connectOverCDP = async (cdpOrigin) => ({
      close: async () => {
        events.push("close:" + String(cdpOrigin));
      },
    });

    try {
      await withSessionBrowser({
        sessionId: "session-from",
        cdpOrigin: "ws://source",
        timeoutMs: 100,
        hooks: {
          onAcquire: ({ sessionId }) => {
            events.push("acquire:" + sessionId);
          },
          onRelease: ({ sessionId }) => {
            events.push("release:" + sessionId);
          },
        },
        run: async () =>
          await withSessionBrowser({
            sessionId: "session-to",
            cdpOrigin: "ws://destination",
            timeoutMs: 100,
            hooks: {
              onAcquire: ({ sessionId }) => {
                events.push("acquire:" + sessionId);
              },
              onRelease: ({ sessionId }) => {
                events.push("release:" + sessionId);
              },
            },
            run: async () => {
              events.push("run:cookie-copy-body");
            },
          }),
      });
      console.log(JSON.stringify({ ok: true, events }));
    } finally {
      chromium.connectOverCDP = originalConnect;
    }
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.events, [
    "acquire:session-from",
    "acquire:session-to",
    "run:cookie-copy-body",
    "release:session-to",
    "release:session-from",
  ]);
});

test("runtime-access migration scan gate leaves direct connectOverCDP only in abstraction module", () => {
  const result = spawnSync("rg", ["-n", "chromium\\.connectOverCDP\\(", "src/core"], {
    encoding: "utf8",
    cwd: process.cwd(),
  });

  let matchedFiles = [];
  if (result.status === 0) {
    matchedFiles = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => line.split(":")[0]);
  } else if (result.error && result.error.code === "ENOENT") {
    const root = path.resolve(process.cwd(), "src/core");
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".ts")) {
          continue;
        }
        const text = fs.readFileSync(full, "utf8");
        if (!text.includes("chromium.connectOverCDP(")) {
          continue;
        }
        const rel = path.relative(process.cwd(), full).split(path.sep).join("/");
        matchedFiles.push(rel);
      }
    }
  } else {
    assert.fail(`Expected scan matches. stderr: ${result.stderr}`);
  }

  assert.deepEqual(Array.from(new Set(matchedFiles)), ["src/core/session/infra/runtime-access.ts"]);
});
