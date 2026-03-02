import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readRuntimeState } from "../../core/state-storage.mjs";
import { createCliRunner } from "../helpers/cli-runner.mjs";
import { cleanupStateDir } from "../helpers/managed-cleanup.mjs";
import { mkBrowserTestStateDir } from "../helpers/test-tmp.mjs";

const TEST_STATE_DIR = mkBrowserTestStateDir("surfwright-profile-extensions-");
const TEST_WORKSPACE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-workspace-extensions-"));
const { runCliSync, runCliAsync } = createCliRunner({
  stateDir: TEST_STATE_DIR,
  env: {
    SURFWRIGHT_WORKSPACE_DIR: TEST_WORKSPACE_DIR,
  },
});

function runCli(args) {
  return runCliSync(args);
}

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output on stdout");
  return JSON.parse(text);
}

function writeExtensionBuild(extensionDir, sourceText) {
  const manifest = {
    manifest_version: 3,
    name: "Test Runtime Extension",
    version: "1.0.0",
    background: {
      service_worker: "background.js",
    },
    permissions: ["storage"],
  };
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.writeFileSync(path.join(extensionDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(extensionDir, "background.js"), `${sourceText}\n`, "utf8");
}

let hasBrowserCache;
function hasBrowser() {
  if (typeof hasBrowserCache === "boolean") {
    return hasBrowserCache;
  }
  const doctor = runCli(["doctor"]);
  const payload = parseJson(doctor.stdout);
  hasBrowserCache = payload?.chrome?.found === true && runCli(["session", "ensure", "--timeout-ms", "5000"]).status === 0;
  return hasBrowserCache;
}

function requireBrowser() {
  assert.equal(hasBrowser(), true, "Browser contract tests require a local Chrome/Chromium (run `surfwright doctor`)");
}

test.after(async () => {
  await cleanupStateDir(TEST_STATE_DIR);
  fs.rmSync(TEST_WORKSPACE_DIR, { recursive: true, force: true });
});

test("profile session restarts on extension build drift and reports runtime-installed state", async () => {
  requireBrowser();

  const extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-extension-build-"));
  try {
    writeExtensionBuild(extensionDir, "console.log('build-one');");

    const loadResult = runCli(["extension", "load", extensionDir]);
    assert.equal(loadResult.status, 0, loadResult.stdout || loadResult.stderr);
    const loadPayload = parseJson(loadResult.stdout);
    assert.equal(loadPayload.ok, true);
    assert.equal(typeof loadPayload.extensionSetFingerprint, "string");

    const firstOpenResult = await runCliAsync(["open", "about:blank", "--profile", "auth", "--timeout-ms", "12000"]);
    assert.equal(firstOpenResult.status, 0, firstOpenResult.stdout || firstOpenResult.stderr);
    const firstOpenPayload = parseJson(firstOpenResult.stdout);
    assert.equal(firstOpenPayload.ok, true);
    assert.equal(firstOpenPayload.sessionId, "p.auth");
    assert.equal(Array.isArray(firstOpenPayload.appliedExtensions), true);
    assert.equal(firstOpenPayload.appliedExtensions.length, 1);
    assert.equal(firstOpenPayload.appliedExtensions[0].state, "runtime-installed");
    assert.equal(typeof firstOpenPayload.extensionSetFingerprint, "string");

    const stateAfterFirstOpen = readRuntimeState(TEST_STATE_DIR);
    const firstSession = stateAfterFirstOpen.sessions[firstOpenPayload.sessionId];
    assert.ok(firstSession, "Expected profile session in state after first open");
    const firstBrowserPid = firstSession.browserPid;
    const firstFingerprint = firstOpenPayload.extensionSetFingerprint;

    await new Promise((resolve) => setTimeout(resolve, 25));
    writeExtensionBuild(extensionDir, "console.log('build-two');");

    const reloadResult = runCli(["extension", "reload", loadPayload.extension.id]);
    assert.equal(reloadResult.status, 0, reloadResult.stdout || reloadResult.stderr);
    const reloadPayload = parseJson(reloadResult.stdout);
    assert.equal(reloadPayload.ok, true);
    assert.equal(reloadPayload.reloaded, true);

    const secondOpenResult = await runCliAsync(["open", "about:blank", "--profile", "auth", "--timeout-ms", "12000"]);
    assert.equal(secondOpenResult.status, 0, secondOpenResult.stdout || secondOpenResult.stderr);
    const secondOpenPayload = parseJson(secondOpenResult.stdout);
    assert.equal(secondOpenPayload.ok, true);
    assert.equal(secondOpenPayload.sessionId, firstOpenPayload.sessionId);
    assert.equal(Array.isArray(secondOpenPayload.appliedExtensions), true);
    assert.equal(secondOpenPayload.appliedExtensions.length, 1);
    assert.equal(secondOpenPayload.appliedExtensions[0].state, "runtime-installed");
    assert.notEqual(secondOpenPayload.extensionSetFingerprint, firstFingerprint);

    const stateAfterSecondOpen = readRuntimeState(TEST_STATE_DIR);
    const secondSession = stateAfterSecondOpen.sessions[secondOpenPayload.sessionId];
    assert.ok(secondSession, "Expected profile session in state after second open");
    assert.notEqual(secondSession.browserPid, firstBrowserPid);

    const listResult = runCli(["session", "list"]);
    assert.equal(listResult.status, 0, listResult.stdout || listResult.stderr);
    const listPayload = parseJson(listResult.stdout);
    const listedSession = listPayload.sessions.find((entry) => entry.sessionId === secondOpenPayload.sessionId);
    assert.ok(listedSession, "Expected listed profile session");
    assert.equal(typeof listedSession.extensionSetFingerprint, "string");
    assert.equal(Array.isArray(listedSession.appliedExtensions), true);
    assert.equal(listedSession.appliedExtensions[0].state, "runtime-installed");
  } finally {
    fs.rmSync(extensionDir, { recursive: true, force: true });
  }
});
