import process from "node:process";
import { stateRootDir } from "../../state/index.js";
import { providers } from "../../providers/index.js";
import {
  DAEMON_META_FILENAME,
  type DaemonMeta,
  currentProcessUid,
  isProcessAlive,
  parseDaemonMeta,
  parsePositiveInt,
} from "./daemon-meta.js";

const DAEMON_START_LOCK_FILENAME = "daemon.start.lock";
const DAEMON_START_LOCK_STALE_MS = 15000;
const DAEMON_SWEEP_MAX_AGENT_NAMESPACES_DEFAULT = 256;

export type DaemonMetadataSweepReport = {
  scanned: number;
  kept: number;
  removed: number;
  removedDeadPid: number;
  removedInvalid: number;
  removedPermissionMismatch: number;
  removedOwnerMismatch: number;
  startLocksScanned: number;
  startLocksRemoved: number;
  namespacesScanned: number;
};


function removeFileIfPresent(filePath: string): boolean {
  try {
    providers().fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseStartLockOwnerPid(lockPath: string): number | null {
  try {
    const raw = providers().fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown } | null;
    if (!parsed) {
      return null;
    }
    return parsePositiveInt(parsed.pid);
  } catch {
    return null;
  }
}

function parseStartLockTimestampMs(lockPath: string): number | null {
  try {
    const raw = providers().fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { createdAt?: unknown } | null;
    if (parsed && typeof parsed.createdAt === "string") {
      const parsedMs = Date.parse(parsed.createdAt);
      if (Number.isFinite(parsedMs)) {
        return parsedMs;
      }
    }
  } catch {
    // fall through to mtime
  }
  try {
    const stat = providers().fs.statSync(lockPath);
    return Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : null;
  } catch {
    return null;
  }
}

function shouldRemoveStartLock(lockPath: string, nowMs: number): boolean {
  const ownerPid = parseStartLockOwnerPid(lockPath);
  if (typeof ownerPid === "number" && ownerPid > 0 && isProcessAlive(ownerPid)) {
    return false;
  }
  const createdMs = parseStartLockTimestampMs(lockPath);
  if (createdMs !== null && nowMs - createdMs < DAEMON_START_LOCK_STALE_MS) {
    if (typeof ownerPid !== "number" || ownerPid <= 0) {
      return false;
    }
  }
  return true;
}

function candidateNamespaces(stateRoot: string, maxAgentNamespaces: number): string[] {
  const out = [stateRoot];
  const agentsDir = providers().path.join(stateRoot, "agents");
  try {
    const entries = providers()
      .fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, Math.max(0, maxAgentNamespaces));
    for (const entry of entries) {
      out.push(providers().path.join(agentsDir, entry.name));
    }
  } catch {
    // agents directory may not exist in this state namespace
  }
  return out;
}

export function sweepDaemonMetadata(opts?: {
  includeAgentNamespaces?: boolean;
  maxAgentNamespaces?: number;
  nowMs?: number;
  stateRoot?: string;
}): DaemonMetadataSweepReport {
  const stateRoot = typeof opts?.stateRoot === "string" && opts.stateRoot.length > 0 ? opts.stateRoot : stateRootDir();
  const includeAgentNamespaces = Boolean(opts?.includeAgentNamespaces);
  const maxAgentNamespaces = opts?.maxAgentNamespaces ?? DAEMON_SWEEP_MAX_AGENT_NAMESPACES_DEFAULT;
  const nowMs = opts?.nowMs ?? Date.now();
  const namespaces = includeAgentNamespaces ? candidateNamespaces(stateRoot, maxAgentNamespaces) : [stateRoot];
  const expectedUid = currentProcessUid();

  const report: DaemonMetadataSweepReport = {
    scanned: 0,
    kept: 0,
    removed: 0,
    removedDeadPid: 0,
    removedInvalid: 0,
    removedPermissionMismatch: 0,
    removedOwnerMismatch: 0,
    startLocksScanned: 0,
    startLocksRemoved: 0,
    namespacesScanned: namespaces.length,
  };

  for (const namespaceRoot of namespaces) {
    const metaPath = providers().path.join(namespaceRoot, DAEMON_META_FILENAME);
    try {
      const stat = providers().fs.statSync(metaPath);
      report.scanned += 1;

      if (providers().runtime.platform !== "win32") {
        if ((stat.mode & 0o077) !== 0) {
          if (removeFileIfPresent(metaPath)) {
            report.removed += 1;
            report.removedPermissionMismatch += 1;
          }
          continue;
        }
        if (expectedUid !== null && typeof stat.uid === "number" && stat.uid !== expectedUid) {
          if (removeFileIfPresent(metaPath)) {
            report.removed += 1;
            report.removedOwnerMismatch += 1;
          }
          continue;
        }
      }

      const raw = providers().fs.readFileSync(metaPath, "utf8");
      const meta = parseDaemonMeta(raw);
      if (!meta) {
        if (removeFileIfPresent(metaPath)) {
          report.removed += 1;
          report.removedInvalid += 1;
        }
        continue;
      }
      if (!isProcessAlive(meta.pid)) {
        if (removeFileIfPresent(metaPath)) {
          report.removed += 1;
          report.removedDeadPid += 1;
        }
        continue;
      }
      report.kept += 1;
    } catch {
      // metadata file missing/unreadable is treated as absent
    }

    const lockPath = providers().path.join(namespaceRoot, DAEMON_START_LOCK_FILENAME);
    try {
      providers().fs.statSync(lockPath);
      report.startLocksScanned += 1;
      if (shouldRemoveStartLock(lockPath, nowMs) && removeFileIfPresent(lockPath)) {
        report.startLocksRemoved += 1;
      }
    } catch {
      // lock file absent
    }
  }

  return report;
}
