import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function historyHeader(loopId, scopeId, missionIds = []) {
  const normalizedMissionIds = Array.isArray(missionIds) ? missionIds.map((v) => String(v)).filter(Boolean) : [];
  return {
    schemaVersion: 1,
    kind: "header",
    loopId,
    scopeId,
    missionScopeType: normalizedMissionIds.length === 1 ? "single" : "cluster",
    missionId: normalizedMissionIds.length === 1 ? normalizedMissionIds[0] : "",
    missionIds: normalizedMissionIds,
    note: "Append one JSON object per iteration. Each row is exactly one campaign run.",
  };
}

function parseHeaderLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function normalizeIdsFromHeader(row) {
  if (Array.isArray(row?.missionIds) && row.missionIds.length > 0) {
    return row.missionIds.map((v) => String(v)).filter(Boolean);
  }
  if (row?.missionId) {
    return [String(row.missionId)];
  }
  return [];
}

export function ensureHistoryFileHeader({ historyPath, loopId, scopeId, missionIds }) {
  const desired = historyHeader(loopId, scopeId, missionIds);
  fs.mkdirSync(path.dirname(historyPath), { recursive: true });
  if (!fs.existsSync(historyPath)) {
    fs.writeFileSync(historyPath, `${JSON.stringify(desired)}\n`, "utf8");
    return;
  }

  const raw = fs.readFileSync(historyPath, "utf8");
  if (!raw.trim()) {
    fs.writeFileSync(historyPath, `${JSON.stringify(desired)}\n`, "utf8");
    return;
  }

  const lines = raw.split(/\r?\n/).filter((line) => line.length > 0);
  const first = parseHeaderLine(lines[0]);
  const existingMissionIds = normalizeIdsFromHeader(first);
  const expectedMissionIds = missionIds.map((v) => String(v));
  const sameMissionIds = existingMissionIds.length === expectedMissionIds.length && existingMissionIds.every((id, idx) => id === expectedMissionIds[idx]);
  const needsUpgrade = !(
    first &&
    first.kind === "header" &&
    String(first.loopId || "") === loopId &&
    String(first.scopeId || "") === scopeId &&
    sameMissionIds
  );

  if (!needsUpgrade) {
    return;
  }

  lines[0] = JSON.stringify(desired);
  fs.writeFileSync(historyPath, `${lines.join("\n")}\n`, "utf8");
}

function normalizeMissionId(value) {
  return String(value || "").trim();
}

function splitCsvMissions(csv) {
  return String(csv || "")
    .split(",")
    .map((v) => normalizeMissionId(v))
    .filter(Boolean);
}

function dedupeKeepOrder(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const key = String(value || "").trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(key);
  }
  return out;
}

function legacyMissionDefaults(config) {
  const out = [];
  if (Array.isArray(config.defaultMissionIds)) {
    out.push(...config.defaultMissionIds.map((v) => normalizeMissionId(v)).filter(Boolean));
  }
  if (String(config.defaultMissionId || "").trim()) {
    out.push(String(config.defaultMissionId || "").trim());
  }
  if (Array.isArray(config.missions)) {
    out.push(...config.missions.map((v) => normalizeMissionId(v)).filter(Boolean));
  }
  return dedupeKeepOrder(out);
}

export function resolveMissionSelection(config, args) {
  const single = normalizeMissionId(args.missionId);
  const fromCsv = splitCsvMissions(args.missionIdsCsv);
  if (single && fromCsv.length > 0) {
    throw new Error("use either --mission-id or --mission-ids, not both");
  }

  let missionIds = [];
  if (fromCsv.length > 0) {
    missionIds = fromCsv;
  } else if (single) {
    missionIds = [single];
  } else {
    missionIds = legacyMissionDefaults(config);
  }

  missionIds = dedupeKeepOrder(missionIds);
  if (missionIds.length === 0) {
    throw new Error("mission selection missing (set --mission-id, --mission-ids, or config default mission ids)");
  }

  return missionIds;
}

function scopeHash(text) {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 10);
}

export function buildScopeId(missionIds) {
  const sorted = [...missionIds].sort((a, b) => a.localeCompare(b));
  if (sorted.length === 1) {
    return `mission-${sorted[0]}`;
  }

  const joined = sorted.join("__");
  const safeJoined = joined.replace(/[^a-zA-Z0-9_-]/g, "-");
  if (safeJoined.length <= 80) {
    return `cluster-${sorted.length}-${safeJoined}`;
  }
  return `cluster-${sorted.length}-${scopeHash(joined)}`;
}

export function scopePaths(repoRoot, scopeId, overrideHistoryPath = "") {
  const scopeDir = path.resolve(repoRoot, "bench/agent-loop/scopes", scopeId);
  if (overrideHistoryPath) {
    const historyPath = path.resolve(repoRoot, overrideHistoryPath);
    return {
      scopeDir,
      historyPath,
      outMd: path.join(scopeDir, "RESULT_SHEET.md"),
      outJson: path.join(scopeDir, "RESULT_SHEET.json"),
      outBrief: path.join(scopeDir, "NEXT_ITERATION_TASK.md"),
    };
  }
  return {
    scopeDir,
    historyPath: path.join(scopeDir, "history.jsonl"),
    outMd: path.join(scopeDir, "RESULT_SHEET.md"),
    outJson: path.join(scopeDir, "RESULT_SHEET.json"),
    outBrief: path.join(scopeDir, "NEXT_ITERATION_TASK.md"),
  };
}

export function ensureMissionAssets(repoRoot, missionIds) {
  for (const missionId of missionIds) {
    const promptPath = path.join(repoRoot, "missions/browser-control/prompts", `${missionId}.md`);
    const oraclePath = path.join(repoRoot, "missions/browser-control/oracles", `${missionId}.json`);
    if (!fs.existsSync(promptPath)) {
      throw new Error(`prompt asset not found for mission ${missionId}: ${promptPath}`);
    }
    if (!fs.existsSync(oraclePath)) {
      throw new Error(`oracle asset not found for mission ${missionId}: ${oraclePath}`);
    }
  }
}

export function makeHeadlessShim({ repoRoot, iterationDir, runShell }) {
  const wrapperSource = path.resolve(repoRoot, "scripts/bench/surfwright-headless-wrapper.sh");
  if (!fs.existsSync(wrapperSource)) {
    throw new Error(`headless wrapper missing: ${wrapperSource}`);
  }

  const surfwrightRealBin = runShell("command -v surfwright").stdout.trim();
  if (!surfwrightRealBin) {
    throw new Error("surfwright binary not found in PATH");
  }

  const shimDir = path.join(iterationDir, "shim-bin");
  fs.mkdirSync(shimDir, { recursive: true });

  const shimPath = path.join(shimDir, "surfwright");
  fs.copyFileSync(wrapperSource, shimPath);
  fs.chmodSync(shimPath, 0o755);

  const pathValue = `${shimDir}:${process.env.PATH || ""}`;
  return {
    shimDir,
    pathValue,
    surfwrightRealBin,
  };
}
