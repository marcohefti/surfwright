import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
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

test("request-context isolation: output-shape stays request-local under parallel runs", () => {
  const result = runNodeModule(`
    import { withRequestContext } from "./src/core/request-context.ts";
    import { projectReportFields } from "./src/core/report-fields.ts";

    const report = {
      ok: true,
      sessionId: "s-1",
      targetId: "t-1",
      url: "https://example.com",
      proof: { done: true },
      summary: { count: 1 },
    };

    const runCompact = withRequestContext({
      envOverrides: { SURFWRIGHT_OUTPUT_SHAPE: "compact" },
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 15));
        return projectReportFields(report, null);
      },
    });

    const runProof = withRequestContext({
      envOverrides: { SURFWRIGHT_OUTPUT_SHAPE: "proof" },
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return projectReportFields(report, null);
      },
    });

    const [compact, proof] = await Promise.all([runCompact, runProof]);
    console.log(JSON.stringify({
      compactHasProof: Object.prototype.hasOwnProperty.call(compact, "proof"),
      proofHasProof: Object.prototype.hasOwnProperty.call(proof, "proof"),
      compactHasSummary: Object.prototype.hasOwnProperty.call(compact, "summary"),
      proofHasSummary: Object.prototype.hasOwnProperty.call(proof, "summary"),
      compactKeys: Object.keys(compact),
      proofKeys: Object.keys(proof),
    }));
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.compactHasProof, true);
  assert.equal(payload.proofHasProof, true);
  assert.equal(payload.compactHasSummary, true);
  assert.equal(payload.proofHasSummary, false);
  assert.equal(payload.compactKeys.includes("proof"), true);
  assert.equal(payload.proofKeys.includes("proof"), true);
});

test("request-context isolation: workspace scope stays request-local under parallel runs", () => {
  const wsA = path.resolve("/tmp/surfwright-ws-a");
  const wsB = path.resolve("/tmp/surfwright-ws-b");
  const result = runNodeModule(`
    import { withRequestContext } from "./src/core/request-context.ts";
    import { resolveWorkspaceDir } from "./src/core/workspace/infra/workspace.ts";

    const runA = withRequestContext({
      envOverrides: { SURFWRIGHT_WORKSPACE_DIR: ${JSON.stringify(wsA)} },
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return resolveWorkspaceDir();
      },
    });

    const runB = withRequestContext({
      envOverrides: { SURFWRIGHT_WORKSPACE_DIR: ${JSON.stringify(wsB)} },
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return resolveWorkspaceDir();
      },
    });

    const [a, b] = await Promise.all([runA, runB]);
    console.log(JSON.stringify({ a, b }));
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.a, wsA);
  assert.equal(payload.b, wsB);
});

test("request-context isolation: agent-id scope stays request-local under parallel runs", () => {
  const result = runNodeModule(`
    import { withRequestContext } from "./src/core/request-context.ts";
    import { stateRootDir } from "./src/core/state/infra/state-store.ts";

    const runA = withRequestContext({
      envOverrides: { SURFWRIGHT_AGENT_ID: "agent.alpha" },
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return stateRootDir();
      },
    });

    const runB = withRequestContext({
      envOverrides: { SURFWRIGHT_AGENT_ID: "agent.beta" },
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 2));
        return stateRootDir();
      },
    });

    const [a, b] = await Promise.all([runA, runB]);
    console.log(JSON.stringify({ a, b }));
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.a.includes(path.join(".surfwright", "agents", "agent.alpha")), true);
  assert.equal(payload.b.includes(path.join(".surfwright", "agents", "agent.beta")), true);
  assert.notEqual(payload.a, payload.b);
});

test("request-context isolation: exit status stays request-local under parallel runs", () => {
  const result = runNodeModule(`
    import { getRequestExitCode, setRequestExitCode, withRequestContext } from "./src/core/request-context.ts";

    const runA = withRequestContext({
      initialExitCode: 0,
      run: async () => {
        setRequestExitCode(7);
        await new Promise((resolve) => setTimeout(resolve, 10));
        return getRequestExitCode(0);
      },
    });

    const runB = withRequestContext({
      initialExitCode: 0,
      run: async () => {
        setRequestExitCode(3);
        await new Promise((resolve) => setTimeout(resolve, 2));
        return getRequestExitCode(0);
      },
    });

    const [a, b] = await Promise.all([runA, runB]);
    console.log(JSON.stringify({ a, b }));
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.a, 7);
  assert.equal(payload.b, 3);
});
