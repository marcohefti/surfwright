import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

export function fail(message, prefix = "bench") {
  process.stderr.write(`${prefix}: ${message}\n`);
  process.exit(1);
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function readJsonMaybe(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

export function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const out = [];
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      out.push(JSON.parse(line));
    } catch {
      // ignore malformed lines
    }
  }
  return out;
}

export function appendJsonl(filePath, row) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, "utf8");
}

export function runShell(command, opts = {}) {
  const startedAt = Date.now();
  const res = spawnSync("/bin/zsh", ["-lc", command], {
    cwd: opts.cwd || process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: {
      ...process.env,
      ...(opts.env || {}),
    },
  });
  const durationMs = Date.now() - startedAt;
  const payload = {
    command,
    cwd: opts.cwd || process.cwd(),
    durationMs,
    exitCode: Number(res.status ?? 1),
    signal: res.signal || null,
    stdout: String(res.stdout || ""),
    stderr: String(res.stderr || ""),
  };

  if (opts.logPath) {
    fs.mkdirSync(path.dirname(opts.logPath), { recursive: true });
    fs.writeFileSync(opts.logPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  if (payload.exitCode !== 0 && !opts.allowFailure) {
    const error = new Error(`command failed (${payload.exitCode}): ${command}`);
    error.payload = payload;
    throw error;
  }

  return payload;
}

export function parseJsonStdout(payload, stageName) {
  const text = String(payload.stdout || "").trim();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${stageName} did not return valid JSON`);
  }
}

export function toTagList(tagsCsv) {
  return String(tagsCsv || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function nowCompact() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function pad3(value) {
  return String(value).padStart(3, "0");
}

export function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
