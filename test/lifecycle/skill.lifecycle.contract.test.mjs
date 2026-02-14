import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const TEST_STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-skill-state-"));
const TEST_TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-skill-tmp-"));

const DEST_DIR = path.join(TEST_TMP_DIR, "installed-skill");
const LOCK_PATH = path.join(TEST_TMP_DIR, "surfwright.lock.json");
const SOURCE_DIR = path.resolve("skills", "surfwright");

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: TEST_STATE_DIR,
    },
  });
}

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output");
  return JSON.parse(text);
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_STATE_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
  try {
    fs.rmSync(TEST_TMP_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
});

test("skill install + doctor + update lifecycle is atomic and lock-backed", () => {
  const install = runCli([
    "--json",
    "skill",
    "install",
    "--source",
    SOURCE_DIR,
    "--dest",
    DEST_DIR,
    "--lock",
    LOCK_PATH,
  ]);
  assert.equal(install.status, 0);
  const installPayload = parseJson(install.stdout);
  assert.equal(installPayload.ok, true);
  assert.equal(installPayload.status, "installed");
  assert.equal(fs.existsSync(path.join(DEST_DIR, "skill.json")), true);
  assert.equal(fs.existsSync(LOCK_PATH), true);

  const doctor = runCli([
    "--json",
    "skill",
    "doctor",
    "--dest",
    DEST_DIR,
    "--lock",
    LOCK_PATH,
  ]);
  assert.equal(doctor.status, 0);
  const doctorPayload = parseJson(doctor.stdout);
  assert.equal(doctorPayload.ok, true);
  assert.equal(doctorPayload.installed, true);
  assert.equal(doctorPayload.compatible, true);
  assert.equal(doctorPayload.lockStatus, "match");

  const update = runCli([
    "--json",
    "skill",
    "update",
    "--source",
    SOURCE_DIR,
    "--dest",
    DEST_DIR,
    "--lock",
    LOCK_PATH,
  ]);
  assert.equal(update.status, 0);
  const updatePayload = parseJson(update.stdout);
  assert.equal(updatePayload.ok, true);
  assert.equal(updatePayload.status, "updated");
});

test("skill install fails fast with typed source error", () => {
  const result = runCli([
    "--json",
    "skill",
    "install",
    "--source",
    path.join(TEST_TMP_DIR, "missing-source"),
    "--dest",
    DEST_DIR,
    "--lock",
    LOCK_PATH,
  ]);
  assert.equal(result.status, 1);
  const payload = parseJson(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, "E_SKILL_SOURCE_NOT_FOUND");
});
