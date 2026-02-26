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
  assert.notEqual(text.length, 0, "Expected JSON stdout payload");
  return JSON.parse(text);
}

test("runtime pool prevents same-key double warm under concurrent acquires", () => {
  const result = runNodeModule(`
    import { createSessionRuntimePool } from "./src/core/session/infra/runtime-pool.ts";

    let warmCount = 0;
    let closeCount = 0;
    const pool = createSessionRuntimePool({
      connect: async () => {
        warmCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return {
          close: async () => {
            closeCount += 1;
          },
        };
      },
    });

    const [left, right] = await Promise.all([
      pool.acquire({ sessionId: "s-main", cdpOrigin: "ws://main", timeoutMs: 200 }),
      pool.acquire({ sessionId: "s-main", cdpOrigin: "ws://main", timeoutMs: 200 }),
    ]);
    await Promise.all([left.release(), right.release()]);
    console.log(JSON.stringify({ warmCount, closeCount, snapshot: pool.snapshot() }));
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.warmCount, 1);
  assert.equal(payload.snapshot.length, 1);
  assert.equal(payload.snapshot[0].borrowCount, 0);
});

test("runtime pool withLease enforces release in finally on success and failure", () => {
  const result = runNodeModule(`
    import { createSessionRuntimePool } from "./src/core/session/infra/runtime-pool.ts";

    const pool = createSessionRuntimePool({
      connect: async () => ({
        close: async () => {},
      }),
    });

    await pool.withLease({
      sessionId: "s-1",
      cdpOrigin: "ws://one",
      timeoutMs: 200,
      run: async () => "ok",
    });

    try {
      await pool.withLease({
        sessionId: "s-1",
        cdpOrigin: "ws://one",
        timeoutMs: 200,
        run: async () => {
          throw new Error("boom");
        },
      });
    } catch {
      // expected
    }

    console.log(JSON.stringify({ snapshot: pool.snapshot() }));
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.snapshot.length, 1);
  assert.equal(payload.snapshot[0].borrowCount, 0);
  assert.equal(payload.snapshot[0].state, "ready");
});

test("runtime pool timeout handling degrades and recycles unresolved cancel paths", () => {
  const result = runNodeModule(`
    import { createSessionRuntimePool } from "./src/core/session/infra/runtime-pool.ts";

    let warmCount = 0;
    let closeCount = 0;
    const pool = createSessionRuntimePool({
      connect: async () => {
        warmCount += 1;
        return {
          close: async () => {
            closeCount += 1;
          },
        };
      },
    });

    const lease = await pool.acquire({ sessionId: "s-1", cdpOrigin: "ws://one", timeoutMs: 200 });
    await lease.release();
    await pool.handleTimeout({
      key: "session:s-1",
      bestEffortCancel: async () => false,
    });

    const postTimeout = pool.snapshot();
    const second = await pool.acquire({ sessionId: "s-1", cdpOrigin: "ws://one", timeoutMs: 200 });
    await second.release();

    console.log(JSON.stringify({ warmCount, closeCount, postTimeout, postAcquire: pool.snapshot() }));
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(Array.isArray(payload.postTimeout), true);
  assert.equal(payload.postTimeout.length, 0);
  assert.equal(payload.warmCount, 2);
  assert.equal(payload.closeCount >= 1, true);
  assert.equal(payload.postAcquire.length, 1);
});

test("runtime pool repeated timeout threshold forces hard close before next warm", () => {
  const result = runNodeModule(`
    import { createSessionRuntimePool } from "./src/core/session/infra/runtime-pool.ts";

    let warmCount = 0;
    const pool = createSessionRuntimePool({
      timeoutHardCloseThreshold: 2,
      connect: async () => {
        warmCount += 1;
        return {
          close: async () => {},
        };
      },
    });

    const first = await pool.acquire({ sessionId: "s-1", cdpOrigin: "ws://one", timeoutMs: 200 });
    await first.release();
    await pool.handleTimeout({
      key: "session:s-1",
      bestEffortCancel: async () => true,
    });
    await pool.handleTimeout({
      key: "session:s-1",
      bestEffortCancel: async () => true,
    });

    const afterHardClose = pool.snapshot();
    const second = await pool.acquire({ sessionId: "s-1", cdpOrigin: "ws://one", timeoutMs: 200 });
    await second.release();
    console.log(JSON.stringify({ warmCount, afterHardClose, finalSnapshot: pool.snapshot() }));
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.afterHardClose.length, 0);
  assert.equal(payload.warmCount, 2);
  assert.equal(payload.finalSnapshot.length, 1);
});

test("runtime pool executes uncached one-off when all entries are busy at cap", () => {
  const result = runNodeModule(`
    import { createSessionRuntimePool } from "./src/core/session/infra/runtime-pool.ts";

    let warmCount = 0;
    const pool = createSessionRuntimePool({
      maxEntries: 1,
      connect: async ({ cdpOrigin }) => {
        warmCount += 1;
        return {
          close: async () => {},
          label: cdpOrigin,
        };
      },
    });

    const a = await pool.acquire({ sessionId: "s-a", cdpOrigin: "ws://a", timeoutMs: 200 });
    const b = await pool.acquire({ sessionId: "s-b", cdpOrigin: "ws://b", timeoutMs: 200 });
    const snapshotWhileBusy = pool.snapshot();
    await b.release();
    await a.release();

    console.log(JSON.stringify({
      warmCount,
      bPooled: b.pooled,
      snapshotWhileBusy,
      snapshotAfterRelease: pool.snapshot(),
    }));
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.warmCount, 2);
  assert.equal(payload.bPooled, false);
  assert.equal(payload.snapshotWhileBusy.length, 1);
});

test("runtime pool fails closed on session-key authority mismatch", () => {
  const result = runNodeModule(`
    import { createSessionRuntimePool } from "./src/core/session/infra/runtime-pool.ts";

    const pool = createSessionRuntimePool({
      connect: async () => ({
        close: async () => {},
      }),
    });

    const first = await pool.acquire({
      sessionId: "session-1",
      cdpOrigin: "ws://one",
      timeoutMs: 200,
    });
    await first.release();

    try {
      await pool.acquire({
        sessionId: "session-1",
        cdpOrigin: "ws://different-origin",
        timeoutMs: 200,
      });
      console.log(JSON.stringify({ ok: false, reason: "expected-mismatch-error" }));
    } catch (error) {
      console.log(JSON.stringify({ ok: true, code: error?.code ?? null }));
    }
  `);

  assert.equal(result.status, 0, `Expected subprocess exit 0. stderr: ${result.stderr}`);
  const payload = parseJsonLine(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.code, "E_RUNTIME_POOL_SESSION_MISMATCH");
});
