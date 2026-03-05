import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const WORKSPACE_TEST_TMP_ROOT = path.resolve(process.cwd(), "tmp", "test-runtime");

function ensureWorkspaceTestTmpRoot() {
  fs.mkdirSync(WORKSPACE_TEST_TMP_ROOT, { recursive: true, mode: 0o700 });
}

export function mkWorkspaceTestDir(prefix) {
  ensureWorkspaceTestTmpRoot();
  const dir = fs.mkdtempSync(path.join(WORKSPACE_TEST_TMP_ROOT, prefix));
  try {
    fs.chmodSync(dir, 0o700);
  } catch {}
  return dir;
}

export function cleanupWorkspaceTestDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}
