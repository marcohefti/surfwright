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

test("argv command resolver resolves deep manifest paths and ignores global options", () => {
  const result = runNodeModule(`
    import { resolveArgvCommandId, resolveArgvCommandPath } from "./src/cli/command-path.ts";
    const argv = [
      "node",
      "dist/cli.js",
      "--agent-id",
      "team.alpha",
      "--workspace",
      "/tmp/workspace",
      "target",
      "trace",
      "insight",
      "DEADBEEF",
      "--no-json",
    ];
    console.log(JSON.stringify({
      path: resolveArgvCommandPath(argv),
      id: resolveArgvCommandId(argv),
    }));
  `);
  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.deepEqual(payload.path, ["target", "trace", "insight"]);
  assert.equal(payload.id, "target.trace.insight");
});

test("argv command resolver supports dashed subcommands", () => {
  const result = runNodeModule(`
    import { resolveArgvCommandId } from "./src/cli/command-path.ts";
    const argv = [
      "node",
      "dist/cli.js",
      "workspace",
      "profile-lock-clear",
      "default",
      "--force",
    ];
    console.log(JSON.stringify({ id: resolveArgvCommandId(argv) }));
  `);
  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.id, "workspace.profile-lock-clear");
});
