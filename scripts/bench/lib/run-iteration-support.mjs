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
  const scopeDirDefault = path.resolve(repoRoot, "tmp/zerocontext/bench-loop/scopes", scopeId);
  if (overrideHistoryPath) {
    const historyPath = path.resolve(repoRoot, overrideHistoryPath);
    const scopeDir = path.dirname(historyPath);
    return {
      scopeDir,
      historyPath,
      outMd: path.join(scopeDir, "RESULT_SHEET.md"),
      outJson: path.join(scopeDir, "RESULT_SHEET.json"),
      outBrief: path.join(scopeDir, "NEXT_ITERATION_TASK.md"),
    };
  }
  return {
    scopeDir: scopeDirDefault,
    historyPath: path.join(scopeDirDefault, "history.jsonl"),
    outMd: path.join(scopeDirDefault, "RESULT_SHEET.md"),
    outJson: path.join(scopeDirDefault, "RESULT_SHEET.json"),
    outBrief: path.join(scopeDirDefault, "NEXT_ITERATION_TASK.md"),
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

function toPositiveInt(raw) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return null;
  }
  const n = Number.parseInt(text, 10);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return n;
}

function toNonNegativeInt(raw) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return null;
  }
  const n = Number.parseInt(text, 10);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return n;
}

export function resolveAgentsPerMission(config, args) {
  const fromArgs = toPositiveInt(args.agentsPerMission);
  if (String(args.agentsPerMission ?? "").trim() && !fromArgs) {
    throw new Error(`invalid --agents-per-mission: ${String(args.agentsPerMission)}`);
  }
  const fromConfig = toPositiveInt(config.agentsPerMission ?? 1);
  if (!fromConfig) {
    throw new Error(`invalid config.agentsPerMission: ${String(config.agentsPerMission)}`);
  }
  return fromArgs || fromConfig;
}

export function resolveNativeScheduling(config, agentsPerMission) {
  const maxInflightPerStrategy = toPositiveInt(config.nativeMaxInflightPerStrategy ?? 6);
  if (!maxInflightPerStrategy) {
    throw new Error(`invalid config.nativeMaxInflightPerStrategy: ${String(config.nativeMaxInflightPerStrategy)}`);
  }
  const minStartIntervalMs = toNonNegativeInt(config.nativeMinStartIntervalMs ?? 150);
  if (minStartIntervalMs == null) {
    throw new Error(`invalid config.nativeMinStartIntervalMs: ${String(config.nativeMinStartIntervalMs)}`);
  }
  if (agentsPerMission > maxInflightPerStrategy) {
    throw new Error(
      `agentsPerMission (${agentsPerMission}) exceeds nativeMaxInflightPerStrategy (${maxInflightPerStrategy}); increase config.nativeMaxInflightPerStrategy`,
    );
  }
  return {
    maxInflightPerStrategy,
    minStartIntervalMs,
  };
}

export function buildFlowIds(agentsPerMission, baseFlowId = "surfwright") {
  const normalizedBase = String(baseFlowId || "").trim() || "surfwright";
  if (agentsPerMission <= 1) {
    return [normalizedBase];
  }
  const out = [];
  for (let slot = 1; slot <= agentsPerMission; slot += 1) {
    out.push(slot === 1 ? normalizedBase : `${normalizedBase}-a${slot}`);
  }
  return out;
}

export function resolveIterationMode(args, config) {
  const modeFromArgs = normalizeIterationMode(args.iterationMode);
  if (modeFromArgs === "__invalid__") {
    throw new Error(`invalid --mode: ${String(args.iterationMode)} (expected optimize|sample)`);
  }
  if (modeFromArgs) {
    return modeFromArgs;
  }
  const modeFromConfig = normalizeIterationMode(config.defaultIterationMode || "optimize");
  if (modeFromConfig === "__invalid__") {
    throw new Error(`invalid config.defaultIterationMode: ${String(config.defaultIterationMode)} (expected optimize|sample)`);
  }
  return modeFromConfig || "optimize";
}

function normalizeIterationMode(raw) {
  const mode = String(raw || "").trim().toLowerCase();
  if (!mode) {
    return "";
  }
  if (mode === "optimize" || mode === "sample") {
    return mode;
  }
  return "__invalid__";
}

export function looksLikeNoChange(text) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return [
    "no change",
    "no code change",
    "none",
    "n/a",
    "na",
    "baseline",
    "control",
    "sampling",
  ].includes(normalized);
}

export function extractChangedPath(line) {
  const body = String(line || "").slice(3).trim();
  if (!body) {
    return "";
  }
  const arrow = body.lastIndexOf(" -> ");
  if (arrow >= 0) {
    return body.slice(arrow + 4).trim();
  }
  return body;
}

export function isLoopDataPath(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  return normalized.startsWith("tmp/");
}
