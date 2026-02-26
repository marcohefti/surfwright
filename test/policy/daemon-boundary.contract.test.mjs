import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const WORKER_PATH = "src/core/daemon/infra/worker.ts";
const APP_RUN_PATH = "src/core/daemon/app/run-orchestrator.ts";
const DOMAIN_INDEX_PATH = "src/core/daemon/domain/index.ts";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

test("daemon worker delegates request classification to app layer", () => {
  const worker = read(WORKER_PATH);
  assert.equal(worker.includes('from "../app/index.js"'), true);
  assert.equal(worker.includes("orchestrateDaemonWorkerRequest"), true);
  assert.equal(worker.includes("request.kind ==="), false);
});

test("daemon app run orchestrator depends on domain scheduler contract", () => {
  const appRun = read(APP_RUN_PATH);
  assert.equal(appRun.includes('from "../domain/index.js"'), true);
  assert.equal(appRun.includes("createInlineDaemonScheduler"), true);
  assert.equal(appRun.includes("scheduler.enqueue"), true);
});

test("daemon domain entrypoint exports scheduler contract entrypoint", () => {
  const domainIndex = read(DOMAIN_INDEX_PATH);
  assert.equal(domainIndex.includes("createInlineDaemonScheduler"), true);
  assert.equal(domainIndex.includes("DaemonScheduler"), true);
});
