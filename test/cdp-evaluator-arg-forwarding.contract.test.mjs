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

test("CDP evaluator forwards arg payload into Runtime.evaluate expression (guards args-drop regressions)", () => {
  // This test is intentionally hermetic: no browser needed.
  //
  // When createCdpEvaluator drops the arg, our pageFunction would receive undefined,
  // and downstream destructuring callsites crash with:
  // - Cannot destructure property 'selectorQuery' of 'undefined'
  // - Cannot destructure property 'focusTextMaxChars' of 'undefined'
  // - Cannot destructure property 'expression' of 'undefined'
  const result = runNodeModule(`
    import { createCdpEvaluator } from "./src/core/target/infra/cdp/index.ts";

    const calls = [];
    const cdp = {
      async send(method, params) {
        calls.push({ method, params });
        if (method === "Page.createIsolatedWorld") {
          return { executionContextId: 1 };
        }
        if (method === "Runtime.evaluate") {
          return { result: { value: params.expression } };
        }
        return {};
      },
    };

    const evaluator = createCdpEvaluator({ cdp, frameCdpId: "frame-1", worldCache: new Map() });
    const arg = { hello: "world", n: 1 };
    const expr = await evaluator.evaluate(({ hello, n }) => ({ hello, n }), arg);

    console.log(JSON.stringify({
      ok: true,
      expr,
      runtimeEvaluateCalls: calls.filter((c) => c.method === "Runtime.evaluate").length,
    }));
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.runtimeEvaluateCalls, 1);
  assert.equal(typeof payload.expr, "string");
  assert.equal(payload.expr.includes(JSON.stringify({ hello: "world", n: 1 })), true);
});

test("managed browser args include Linux resilience flags and optional no-sandbox mode", () => {
  const result = runNodeModule(`
    import { buildManagedBrowserArgs } from "./src/core/browser.ts";
    const base = buildManagedBrowserArgs({
      debugPort: 9222,
      userDataDir: "/tmp/profile",
      browserMode: "headless",
      platform: "linux",
      noSandbox: false,
    });
    const noSandbox = buildManagedBrowserArgs({
      debugPort: 9222,
      userDataDir: "/tmp/profile",
      browserMode: "headless",
      platform: "linux",
      noSandbox: true,
    });
    console.log(JSON.stringify({ base, noSandbox }));
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.base.includes("--disable-dev-shm-usage"), true);
  assert.equal(payload.base.includes("--no-sandbox"), false);
  assert.equal(payload.noSandbox.includes("--no-sandbox"), true);
  assert.equal(payload.noSandbox.includes("--disable-setuid-sandbox"), true);
});
