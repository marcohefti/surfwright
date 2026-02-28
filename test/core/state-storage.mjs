import fs from "node:fs";
import path from "node:path";

const STATE_V2_DIRNAME = "state-v2";
const TARGETS_BY_SESSION_DIRNAME = "targets-by-session";

function stateV2Root(stateDir) {
  return path.join(stateDir, STATE_V2_DIRNAME);
}

function targetsBySessionRoot(stateDir) {
  return path.join(stateV2Root(stateDir), TARGETS_BY_SESSION_DIRNAME);
}

function safeSessionShardName(sessionId) {
  return `${encodeURIComponent(sessionId)}.json`;
}

export function stateFilePath(stateDir) {
  return path.join(stateDir, "state.json");
}

export function stateV2MetaPath(stateDir) {
  return path.join(stateV2Root(stateDir), "meta.json");
}

export function writeCanonicalState(stateDir, state, opts = {}) {
  const revision =
    Number.isFinite(Number(opts.revision)) && Number(opts.revision) > 0 ? Math.floor(Number(opts.revision)) : 1;
  const v2Root = stateV2Root(stateDir);
  const targetsRoot = targetsBySessionRoot(stateDir);
  fs.mkdirSync(v2Root, { recursive: true });
  fs.mkdirSync(targetsRoot, { recursive: true });

  const meta = {
    version: state.version,
    activeSessionId: state.activeSessionId,
    nextSessionOrdinal: state.nextSessionOrdinal,
    nextCaptureOrdinal: state.nextCaptureOrdinal,
    nextArtifactOrdinal: state.nextArtifactOrdinal,
    revision,
  };
  fs.writeFileSync(path.join(v2Root, "meta.json"), `${JSON.stringify(meta)}\n`, "utf8");
  fs.writeFileSync(path.join(v2Root, "sessions.json"), `${JSON.stringify(state.sessions ?? {})}\n`, "utf8");
  fs.writeFileSync(path.join(v2Root, "network-captures.json"), `${JSON.stringify(state.networkCaptures ?? {})}\n`, "utf8");
  fs.writeFileSync(path.join(v2Root, "network-artifacts.json"), `${JSON.stringify(state.networkArtifacts ?? {})}\n`, "utf8");

  const targets = state.targets ?? {};
  const targetsBySession = new Map();
  for (const [targetId, target] of Object.entries(targets)) {
    if (!target || typeof target !== "object" || typeof target.sessionId !== "string" || target.sessionId.length === 0) {
      continue;
    }
    const bucket = targetsBySession.get(target.sessionId) ?? {};
    bucket[targetId] = target;
    targetsBySession.set(target.sessionId, bucket);
  }

  const nextFilenames = new Set();
  for (const [sessionId, shard] of targetsBySession.entries()) {
    const filename = safeSessionShardName(sessionId);
    nextFilenames.add(filename);
    fs.writeFileSync(path.join(targetsRoot, filename), `${JSON.stringify(shard)}\n`, "utf8");
  }

  try {
    const existing = fs
      .readdirSync(targetsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);
    for (const filename of existing) {
      if (nextFilenames.has(filename)) {
        continue;
      }
      fs.rmSync(path.join(targetsRoot, filename), { force: true });
    }
  } catch {
    // ignore
  }
}

export function readCanonicalState(stateDir) {
  const metaPath = stateV2MetaPath(stateDir);
  if (!fs.existsSync(metaPath)) {
    return null;
  }
  const v2Root = stateV2Root(stateDir);
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const sessions = JSON.parse(fs.readFileSync(path.join(v2Root, "sessions.json"), "utf8"));
  const networkCaptures = JSON.parse(fs.readFileSync(path.join(v2Root, "network-captures.json"), "utf8"));
  const networkArtifacts = JSON.parse(fs.readFileSync(path.join(v2Root, "network-artifacts.json"), "utf8"));

  const targets = {};
  const targetsRoot = targetsBySessionRoot(stateDir);
  try {
    const files = fs
      .readdirSync(targetsRoot, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name);
    for (const filename of files) {
      const shardPath = path.join(targetsRoot, filename);
      const shard = JSON.parse(fs.readFileSync(shardPath, "utf8"));
      for (const [targetId, target] of Object.entries(shard)) {
        targets[targetId] = target;
      }
    }
  } catch {
    // ignore
  }

  return {
    version: meta.version,
    activeSessionId: meta.activeSessionId ?? null,
    nextSessionOrdinal: meta.nextSessionOrdinal,
    nextCaptureOrdinal: meta.nextCaptureOrdinal,
    nextArtifactOrdinal: meta.nextArtifactOrdinal,
    sessions,
    targets,
    networkCaptures,
    networkArtifacts,
  };
}

export function readRuntimeState(stateDir) {
  const fromShards = readCanonicalState(stateDir);
  if (fromShards) {
    return fromShards;
  }
  return JSON.parse(fs.readFileSync(stateFilePath(stateDir), "utf8"));
}

export function readRuntimeStateIfExists(stateDir) {
  const fromShards = readCanonicalState(stateDir);
  if (fromShards) {
    return fromShards;
  }
  const snapshotPath = stateFilePath(stateDir);
  if (!fs.existsSync(snapshotPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
}

export function clearStateStorageArtifacts(stateDir) {
  if (!fs.existsSync(stateDir)) {
    return;
  }
  for (const entry of fs.readdirSync(stateDir)) {
    if (entry === "state-v2" || entry === "state.json" || entry.startsWith("state.corrupt.")) {
      fs.rmSync(path.join(stateDir, entry), { recursive: true, force: true });
    }
  }
}
