import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export function browserTestTmpRoot() {
  const fromEnv = process.env.SURFWRIGHT_TEST_TMPDIR;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return os.tmpdir();
}

export function mkBrowserTestStateDir(prefix) {
  const root = browserTestTmpRoot();
  fs.mkdirSync(root, { recursive: true });
  return fs.mkdtempSync(path.join(root, prefix));
}

