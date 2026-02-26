import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runNodeModule(code) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", code],
    { encoding: "utf8", cwd: process.cwd() },
  );
}

function parseJsonLine(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON on stdout");
  return JSON.parse(text);
}

test("lane resolver: sessionId takes precedence over profile/origin fallbacks", () => {
  const result = runNodeModule(`
    import { resolveDaemonLaneKey } from "./src/core/daemon/domain/lane-key-resolver.ts";
    const resolved = resolveDaemonLaneKey({
      argv: ["node", "dist/cli.js", "open", "https://example.com", "--session", "s-main", "--profile", "auth"],
    });
    console.log(JSON.stringify(resolved));
  `);
  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.source, "sessionId");
  assert.equal(payload.laneKey, "session:s-main");
});

test("lane resolver: open/run derive origin lane from profile/shared isolation", () => {
  const result = runNodeModule(`
    import { resolveDaemonLaneKey } from "./src/core/daemon/domain/lane-key-resolver.ts";
    const openProfile = resolveDaemonLaneKey({
      argv: ["node", "dist/cli.js", "open", "https://example.com", "--profile", "auth"],
    });
    const runShared = resolveDaemonLaneKey({
      argv: ["node", "dist/cli.js", "run", "--plan-json", "{\\"steps\\":[]}", "--isolation", "shared"],
    });
    console.log(JSON.stringify({ openProfile, runShared }));
  `);
  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.openProfile.source, "cdpOrigin");
  assert.equal(payload.openProfile.laneKey, "origin:profile:auth");
  assert.equal(payload.runShared.source, "cdpOrigin");
  assert.equal(payload.runShared.laneKey, "origin:shared");
});

test("lane resolver: session.attach derives hashed origin lane from --cdp", () => {
  const result = runNodeModule(`
    import { resolveDaemonLaneKey } from "./src/core/daemon/domain/lane-key-resolver.ts";
    const resolved = resolveDaemonLaneKey({
      argv: ["node", "dist/cli.js", "session", "attach", "--cdp", "wss://browser.example.com/devtools/browser/abc?token=secret"],
    });
    console.log(JSON.stringify(resolved));
  `);
  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.family, "session.attach");
  assert.equal(payload.source, "cdpOrigin");
  assert.equal(typeof payload.laneKey, "string");
  assert.equal(payload.laneKey.startsWith("origin:"), true);
  assert.equal(payload.laneKey.includes("secret"), false);
});

test("lane resolver: target.* and non-session commands fall back to control lane", () => {
  const result = runNodeModule(`
    import { DAEMON_CONTROL_LANE_KEY, resolveDaemonLaneKey } from "./src/core/daemon/domain/lane-key-resolver.ts";
    const targetWithoutSession = resolveDaemonLaneKey({
      argv: ["node", "dist/cli.js", "target", "snapshot", "t-1"],
    });
    const controlCommand = resolveDaemonLaneKey({
      argv: ["node", "dist/cli.js", "contract"],
    });
    console.log(JSON.stringify({ targetWithoutSession, controlCommand, controlKey: DAEMON_CONTROL_LANE_KEY }));
  `);
  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.targetWithoutSession.source, "control");
  assert.equal(payload.targetWithoutSession.laneKey, payload.controlKey);
  assert.equal(payload.controlCommand.source, "control");
  assert.equal(payload.controlCommand.laneKey, payload.controlKey);
});
