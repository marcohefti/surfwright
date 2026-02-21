import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "surfwright-snapshot-diff-"));

function runCli(args) {
  return spawnSync(process.execPath, ["dist/cli.js", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      SURFWRIGHT_STATE_DIR: path.join(TEST_DIR, "state"),
    },
  });
}

function parseJson(stdout) {
  const text = stdout.trim();
  assert.notEqual(text.length, 0, "Expected JSON output on stdout");
  return JSON.parse(text);
}

process.on("exit", () => {
  try {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

test("target snapshot-diff returns high-signal deltas for two snapshot reports", () => {
  const aPath = path.join(TEST_DIR, "a.json");
  const bPath = path.join(TEST_DIR, "b.json");
  const a = {
    ok: true,
    sessionId: "s-1",
    sessionSource: "explicit",
    targetId: "t-1",
    mode: "snapshot",
    cursor: null,
    nextCursor: null,
    url: "https://example.com/a",
    title: "A",
    scope: { selector: null, matched: true, visibleOnly: false, frameScope: "main" },
    textPreview: "hello",
    headings: ["Welcome"],
    buttons: ["Submit"],
    links: [{ text: "Docs", href: "https://example.com/docs" }],
    truncated: { text: false, headings: false, buttons: false, links: false },
    timingMs: { total: 0, resolveSession: 0, connectCdp: 0, action: 0, persistState: 0 },
  };
  const b = {
    ...a,
    url: "https://example.com/b",
    title: "B",
    headings: ["Welcome", "New"],
    buttons: ["Submit", "Cancel"],
    links: [{ text: "Docs", href: "https://example.com/docs" }, { text: "Login", href: "https://example.com/login" }],
    textPreview: "hello world",
  };
  fs.writeFileSync(aPath, `${JSON.stringify(a)}\n`, "utf8");
  fs.writeFileSync(bPath, `${JSON.stringify(b)}\n`, "utf8");

  const result = runCli(["target", "snapshot-diff", aPath, bPath]);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const payload = parseJson(result.stdout);
  assert.deepEqual(Object.keys(payload), ["ok", "a", "b", "changed", "delta"]);
  assert.equal(payload.ok, true);
  assert.equal(payload.changed.url, true);
  assert.equal(payload.changed.title, true);
  assert.equal(payload.changed.textPreview, true);
  assert.equal(payload.changed.headings, true);
  assert.equal(payload.changed.buttons, true);
  assert.equal(payload.changed.links, true);
});

