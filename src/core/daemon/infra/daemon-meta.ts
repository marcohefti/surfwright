import process from "node:process";
import { stateRootDir } from "../../state/index.js";
import { providers } from "../../providers/index.js";

export const DAEMON_META_VERSION = 1;
export const DAEMON_META_FILENAME = "daemon.json";

export type DaemonMeta = {
  version: number;
  pid: number;
  host: string;
  port: number;
  token: string;
  startedAt: string;
};

export function daemonMetaPath(stateRoot = stateRootDir()): string {
  return providers().path.join(stateRoot, DAEMON_META_FILENAME);
}

export function parsePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const parsed = Math.floor(value);
  return parsed > 0 ? parsed : null;
}

export function currentProcessUid(): number | null {
  if (typeof process.getuid !== "function") {
    return null;
  }
  try {
    const uid = process.getuid();
    return Number.isFinite(uid) ? uid : null;
  } catch {
    return null;
  }
}

export function parseDaemonMeta(raw: string): DaemonMeta | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DaemonMeta>;
    if (
      parsed.version !== DAEMON_META_VERSION ||
      parsePositiveInt(parsed.pid) === null ||
      typeof parsed.host !== "string" ||
      parsed.host.length === 0 ||
      parsePositiveInt(parsed.port) === null ||
      typeof parsed.token !== "string" ||
      parsed.token.length === 0 ||
      typeof parsed.startedAt !== "string" ||
      parsed.startedAt.length === 0
    ) {
      return null;
    }
    return {
      version: DAEMON_META_VERSION,
      pid: parsePositiveInt(parsed.pid) ?? 0,
      host: parsed.host,
      port: parsePositiveInt(parsed.port) ?? 0,
      token: parsed.token,
      startedAt: parsed.startedAt,
    };
  } catch {
    return null;
  }
}

function removeIfRequested(metaPath: string, removeInvalid: boolean): void {
  if (!removeInvalid) {
    return;
  }
  try {
    providers().fs.unlinkSync(metaPath);
  } catch {
    // ignore missing metadata
  }
}

export function readDaemonMeta(opts?: { stateRoot?: string; removeInvalid?: boolean }): DaemonMeta | null {
  const stateRoot = typeof opts?.stateRoot === "string" && opts.stateRoot.length > 0 ? opts.stateRoot : stateRootDir();
  const removeInvalid = opts?.removeInvalid !== false;
  const metaPath = daemonMetaPath(stateRoot);
  try {
    const { fs, runtime } = providers();
    if (runtime.platform !== "win32") {
      const stat = fs.statSync(metaPath);
      const expectedUid = currentProcessUid();
      if ((stat.mode & 0o077) !== 0 || (expectedUid !== null && typeof stat.uid === "number" && stat.uid !== expectedUid)) {
        removeIfRequested(metaPath, removeInvalid);
        return null;
      }
    }
    const raw = fs.readFileSync(metaPath, "utf8");
    const parsed = parseDaemonMeta(raw);
    if (!parsed) {
      removeIfRequested(metaPath, removeInvalid);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeDaemonMeta(meta: DaemonMeta, opts?: { stateRoot?: string }): void {
  const stateRoot = typeof opts?.stateRoot === "string" && opts.stateRoot.length > 0 ? opts.stateRoot : stateRootDir();
  const metaPath = daemonMetaPath(stateRoot);
  const { fs, runtime } = providers();
  fs.mkdirSync(stateRoot, { recursive: true });
  fs.writeFileSync(metaPath, `${JSON.stringify(meta)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (runtime.platform !== "win32") {
    try {
      fs.chmodSync(metaPath, 0o600);
    } catch {
      // best-effort: chmod may fail on some filesystems
    }
  }
}

export function removeDaemonMeta(opts?: { stateRoot?: string }): void {
  const stateRoot = typeof opts?.stateRoot === "string" && opts.stateRoot.length > 0 ? opts.stateRoot : stateRootDir();
  try {
    providers().fs.unlinkSync(daemonMetaPath(stateRoot));
  } catch {
    // ignore missing metadata
  }
}

export function isProcessAlive(pid: number): boolean {
  if (pid <= 0) {
    return false;
  }
  try {
    providers().runtime.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
