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

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output");
  return JSON.parse(text);
}

test("weak-permission daemon metadata is rejected and cleaned up", () => {
  const result = runNodeModule(`
    import fs from "node:fs";
    import os from "node:os";
    import path from "node:path";
    import process from "node:process";
    import { providers, resetProvidersForTest, setProvidersForTest } from "./src/core/providers/index.ts";
    import { runViaDaemon } from "./src/core/daemon/infra/daemon.ts";
    import { withRequestContext } from "./src/core/request-context.ts";

    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-weak-meta-"));
    const metaPath = path.join(stateDir, "daemon.json");
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        version: 1,
        pid: process.pid,
        host: "127.0.0.1",
        port: 49999,
        token: "token",
        startedAt: new Date().toISOString(),
      }) + "\\n",
      { encoding: "utf8", mode: 0o644 },
    );
    if (process.platform !== "win32") {
      fs.chmodSync(metaPath, 0o644);
    }

    const base = providers();
    setProvidersForTest({
      ...base,
      childProcess: {
        ...base.childProcess,
        spawn: () => {
          throw new Error("spawn blocked for metadata validation test");
        },
      },
    });

    process.env.SURFWRIGHT_STATE_DIR = stateDir;
    process.env.SURFWRIGHT_DAEMON = "1";

    try {
      let outcomeKind = "threw";
      try {
        const outcome = await withRequestContext({
          envOverrides: {},
          run: async () => await runViaDaemon(["node", "dist/cli.js", "contract"], process.execPath),
        });
        outcomeKind = outcome.kind;
      } catch {
        outcomeKind = "threw";
      }
      console.log(
        JSON.stringify({
          kind: outcomeKind,
          metaExistsAfter: fs.existsSync(metaPath),
        }),
      );
    } finally {
      resetProvidersForTest();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJson(result.stdout);
  assert.equal(new Set(["unreachable", "threw"]).has(payload.kind), true);
  assert.equal(payload.metaExistsAfter, false);
});

test("ownership-mismatch daemon metadata is rejected and cleaned up", () => {
  const result = runNodeModule(`
    import fs from "node:fs";
    import os from "node:os";
    import path from "node:path";
    import process from "node:process";
    import { providers, resetProvidersForTest, setProvidersForTest } from "./src/core/providers/index.ts";
    import { runViaDaemon } from "./src/core/daemon/infra/daemon.ts";
    import { withRequestContext } from "./src/core/request-context.ts";

    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-owner-meta-"));
    const metaPath = path.join(stateDir, "daemon.json");
    fs.writeFileSync(
      metaPath,
      JSON.stringify({
        version: 1,
        pid: process.pid,
        host: "127.0.0.1",
        port: 49998,
        token: "token",
        startedAt: new Date().toISOString(),
      }) + "\\n",
      { encoding: "utf8", mode: 0o600 },
    );
    if (process.platform !== "win32") {
      fs.chmodSync(metaPath, 0o600);
    }

    const base = providers();
    setProvidersForTest({
      ...base,
      fs: {
        ...base.fs,
        statSync: (filePath) => {
          const stat = base.fs.statSync(filePath);
          if (String(filePath).endsWith("daemon.json")) {
            return {
              mode: stat.mode,
              uid: typeof stat.uid === "number" ? stat.uid + 1 : 123456,
            };
          }
          return stat;
        },
      },
      childProcess: {
        ...base.childProcess,
        spawn: () => {
          throw new Error("spawn blocked for metadata validation test");
        },
      },
    });

    process.env.SURFWRIGHT_STATE_DIR = stateDir;
    process.env.SURFWRIGHT_DAEMON = "1";

    try {
      let outcomeKind = "threw";
      try {
        const outcome = await withRequestContext({
          envOverrides: {},
          run: async () => await runViaDaemon(["node", "dist/cli.js", "contract"], process.execPath),
        });
        outcomeKind = outcome.kind;
      } catch {
        outcomeKind = "threw";
      }
      console.log(
        JSON.stringify({
          kind: outcomeKind,
          metaExistsAfter: fs.existsSync(metaPath),
        }),
      );
    } finally {
      resetProvidersForTest();
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJson(result.stdout);
  assert.equal(new Set(["unreachable", "threw"]).has(payload.kind), true);
  assert.equal(payload.metaExistsAfter, false);
});
