import fs from "node:fs";
import path from "node:path";

import { CliError } from "../../errors.js";
import { providers } from "../../providers/index.js";
import { nowIso } from "../../state/index.js";
import { requireWorkspaceDir, resolveWorkspaceDir } from "../../workspace/index.js";

const EXTENSION_REGISTRY_VERSION = 2;

type ExtensionRecord = {
  extensionId: string;
  name: string;
  version: string;
  path: string;
  manifestVersion: number | null;
  enabled: boolean;
  buildFingerprint: string;
  buildStats: {
    fileCount: number;
    totalBytes: number;
    newestMtimeMs: number;
  };
  installedAt: string;
  updatedAt: string;
};

type ExtensionRegistry = {
  version: number;
  extensions: Record<string, ExtensionRecord>;
};

export type ManagedExtensionProjectionEntry = {
  id: string;
  name: string;
  version: string;
  path: string;
  manifestVersion: number | null;
  enabled: boolean;
  buildFingerprint: string;
};

export type ManagedAppliedExtension = ManagedExtensionProjectionEntry & {
  state: "runtime-installed" | "registry-only";
  runtimeId: string | null;
};

export type ManagedExtensionProjection = {
  workspaceDir: string | null;
  extensionSetFingerprint: string | null;
  extensions: ManagedExtensionProjectionEntry[];
  loadPaths: string[];
};

function extensionRegistryPath(workspaceDir: string): string {
  return path.join(workspaceDir, "extensions.json");
}

function emptyRegistry(): ExtensionRegistry {
  return {
    version: EXTENSION_REGISTRY_VERSION,
    extensions: {},
  };
}

function normalizeRecord(raw: unknown): ExtensionRecord | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const value = raw as {
    extensionId?: unknown;
    name?: unknown;
    version?: unknown;
    path?: unknown;
    manifestVersion?: unknown;
    enabled?: unknown;
    buildFingerprint?: unknown;
    buildStats?: { fileCount?: unknown; totalBytes?: unknown; newestMtimeMs?: unknown } | unknown;
    installedAt?: unknown;
    updatedAt?: unknown;
  };
  if (
    typeof value.extensionId !== "string" ||
    value.extensionId.length === 0 ||
    typeof value.name !== "string" ||
    value.name.length === 0 ||
    typeof value.version !== "string" ||
    value.version.length === 0 ||
    typeof value.path !== "string" ||
    value.path.length === 0 ||
    typeof value.enabled !== "boolean" ||
    typeof value.buildFingerprint !== "string" ||
    value.buildFingerprint.length === 0 ||
    typeof value.installedAt !== "string" ||
    value.installedAt.length === 0 ||
    typeof value.updatedAt !== "string" ||
    value.updatedAt.length === 0
  ) {
    return null;
  }
  const manifestVersion =
    typeof value.manifestVersion === "number" && Number.isFinite(value.manifestVersion) ? value.manifestVersion : null;
  const statsRaw = typeof value.buildStats === "object" && value.buildStats !== null ? value.buildStats : {};
  const stats = statsRaw as { fileCount?: unknown; totalBytes?: unknown; newestMtimeMs?: unknown };
  return {
    extensionId: value.extensionId,
    name: value.name,
    version: value.version,
    path: value.path,
    manifestVersion,
    enabled: value.enabled,
    buildFingerprint: value.buildFingerprint,
    buildStats: {
      fileCount: typeof stats.fileCount === "number" && Number.isFinite(stats.fileCount) ? Math.max(0, Math.floor(stats.fileCount)) : 0,
      totalBytes: typeof stats.totalBytes === "number" && Number.isFinite(stats.totalBytes) ? Math.max(0, Math.floor(stats.totalBytes)) : 0,
      newestMtimeMs:
        typeof stats.newestMtimeMs === "number" && Number.isFinite(stats.newestMtimeMs) ? Math.max(0, Math.floor(stats.newestMtimeMs)) : 0,
    },
    installedAt: value.installedAt,
    updatedAt: value.updatedAt,
  };
}

function readRegistry(workspaceDir: string): ExtensionRegistry {
  const registryPath = extensionRegistryPath(workspaceDir);
  if (!fs.existsSync(registryPath)) {
    return emptyRegistry();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath, "utf8")) as {
      version?: unknown;
      extensions?: unknown;
    };
    const extensionsRaw = typeof raw.extensions === "object" && raw.extensions !== null ? raw.extensions : {};
    const extensions: Record<string, ExtensionRecord> = {};
    for (const [extensionId, value] of Object.entries(extensionsRaw)) {
      const normalized = normalizeRecord(value);
      if (!normalized) {
        continue;
      }
      extensions[extensionId] = normalized;
    }
    return {
      version: typeof raw.version === "number" && Number.isFinite(raw.version) ? raw.version : EXTENSION_REGISTRY_VERSION,
      extensions,
    };
  } catch {
    return emptyRegistry();
  }
}

function writeRegistry(workspaceDir: string, registry: ExtensionRegistry): void {
  const registryPath = extensionRegistryPath(workspaceDir);
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function parseExtensionPath(input: string): string {
  const value = input.trim();
  if (!value) {
    throw new CliError("E_EXTENSION_PATH_INVALID", "extension path must not be empty");
  }
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) {
    throw new CliError("E_EXTENSION_PATH_INVALID", `Extension path not found: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new CliError("E_EXTENSION_PATH_INVALID", "extension path must be a directory");
  }
  return resolved;
}

function parseManifest(extensionPath: string): { name: string; version: string; manifestVersion: number | null } {
  const manifestPath = path.join(extensionPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new CliError("E_EXTENSION_MANIFEST_INVALID", `manifest.json not found under ${extensionPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    throw new CliError("E_EXTENSION_MANIFEST_INVALID", "manifest.json must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new CliError("E_EXTENSION_MANIFEST_INVALID", "manifest.json must be a JSON object");
  }
  const manifest = parsed as {
    name?: unknown;
    version?: unknown;
    manifest_version?: unknown;
  };
  if (typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
    throw new CliError("E_EXTENSION_MANIFEST_INVALID", "manifest.json name must be a non-empty string");
  }
  if (typeof manifest.version !== "string" || manifest.version.trim().length === 0) {
    throw new CliError("E_EXTENSION_MANIFEST_INVALID", "manifest.json version must be a non-empty string");
  }
  return {
    name: manifest.name.trim(),
    version: manifest.version.trim(),
    manifestVersion:
      typeof manifest.manifest_version === "number" && Number.isFinite(manifest.manifest_version)
        ? manifest.manifest_version
        : null,
  };
}

function computeExtensionId(extensionPath: string): string {
  const digest = providers().crypto.createHash("sha256").update(extensionPath).digest("hex");
  return `ext-${digest.slice(0, 12)}`;
}

function relativePosixPath(rootDir: string, filePath: string): string {
  const rel = path.relative(rootDir, filePath);
  return rel.split(path.sep).join("/");
}

function walkFilesRecursive(rootDir: string): string[] {
  const out: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function computeBuildFingerprint(extensionPath: string): {
  buildFingerprint: string;
  stats: {
    fileCount: number;
    totalBytes: number;
    newestMtimeMs: number;
  };
} {
  const files = walkFilesRecursive(extensionPath);
  const hasManifest = files.some((filePath) => path.basename(filePath) === "manifest.json");
  if (!hasManifest) {
    throw new CliError("E_EXTENSION_ASSET_MISSING", `manifest.json not found under ${extensionPath}`);
  }
  const hash = providers().crypto.createHash("sha256");
  let totalBytes = 0;
  let newestMtimeMs = 0;
  for (const filePath of files) {
    const stat = fs.statSync(filePath);
    const size = Math.max(0, Math.floor(stat.size));
    const mtimeMs = Math.max(0, Math.floor(stat.mtimeMs));
    totalBytes += size;
    newestMtimeMs = Math.max(newestMtimeMs, mtimeMs);
    hash.update(`${relativePosixPath(extensionPath, filePath)}\t${size}\t${mtimeMs}\n`);
  }
  return {
    buildFingerprint: `sha256:${hash.digest("hex")}`,
    stats: {
      fileCount: files.length,
      totalBytes,
      newestMtimeMs,
    },
  };
}

function toPublicExtension(record: ExtensionRecord) {
  return {
    id: record.extensionId,
    name: record.name,
    version: record.version,
    path: record.path,
    manifestVersion: record.manifestVersion,
    enabled: record.enabled,
    buildFingerprint: record.buildFingerprint,
    buildStats: record.buildStats,
  };
}

function normalizeExtensionRef(ref: string): string {
  const value = ref.trim();
  if (!value) {
    throw new CliError("E_QUERY_INVALID", "extension ref must not be empty");
  }
  return value;
}

function findRecordByRef(registry: ExtensionRegistry, ref: string): ExtensionRecord | null {
  const value = normalizeExtensionRef(ref);
  const byId = registry.extensions[value];
  if (byId) {
    return byId;
  }
  const lowered = value.toLowerCase();
  const byName = Object.values(registry.extensions).find((record) => record.name.toLowerCase() === lowered);
  return byName ?? null;
}

function enabledProjectionEntriesFromRecords(records: ExtensionRecord[]): ManagedExtensionProjectionEntry[] {
  return records
    .filter((record) => record.enabled)
    .sort((a, b) => a.extensionId.localeCompare(b.extensionId))
    .map((record) => ({
      id: record.extensionId,
      name: record.name,
      version: record.version,
      path: record.path,
      manifestVersion: record.manifestVersion,
      enabled: record.enabled,
      buildFingerprint: record.buildFingerprint,
    }));
}

export function computeExtensionSetFingerprint(entries: ManagedExtensionProjectionEntry[]): string | null {
  if (entries.length === 0) {
    return null;
  }
  const normalized = [...entries]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => ({
      id: entry.id,
      path: entry.path,
      version: entry.version,
      buildFingerprint: entry.buildFingerprint,
    }));
  const digest = providers().crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  return `sha256:${digest}`;
}

function materializeRecordForLaunch(record: ExtensionRecord): ManagedExtensionProjectionEntry {
  const resolvedPath = parseExtensionPath(record.path);
  const manifest = parseManifest(resolvedPath);
  const build = computeBuildFingerprint(resolvedPath);
  return {
    id: record.extensionId,
    name: manifest.name,
    version: manifest.version,
    path: resolvedPath,
    manifestVersion: manifest.manifestVersion,
    enabled: true,
    buildFingerprint: build.buildFingerprint,
  };
}

function requiredWorkspaceDir(): string {
  return requireWorkspaceDir();
}

export function resolveManagedExtensionProjection(): ManagedExtensionProjection {
  const workspaceDir = resolveWorkspaceDir();
  if (!workspaceDir) {
    return {
      workspaceDir: null,
      extensionSetFingerprint: null,
      extensions: [],
      loadPaths: [],
    };
  }
  const registry = readRegistry(workspaceDir);
  const records = Object.values(registry.extensions)
    .filter((record) => record.enabled)
    .sort((a, b) => a.extensionId.localeCompare(b.extensionId));
  const extensions = records.map((record) => materializeRecordForLaunch(record));
  return {
    workspaceDir,
    extensionSetFingerprint: computeExtensionSetFingerprint(extensions),
    extensions,
    loadPaths: extensions.map((entry) => entry.path),
  };
}

export function extensionLoad(opts: { extensionPath: string; sessionId?: string }) {
  const workspaceDir = requiredWorkspaceDir();
  const resolvedPath = parseExtensionPath(opts.extensionPath);
  const manifest = parseManifest(resolvedPath);
  const build = computeBuildFingerprint(resolvedPath);
  const extensionId = computeExtensionId(resolvedPath);
  const registry = readRegistry(workspaceDir);
  const now = nowIso();
  const existing = registry.extensions[extensionId];
  registry.extensions[extensionId] = {
    extensionId,
    name: manifest.name,
    version: manifest.version,
    path: resolvedPath,
    manifestVersion: manifest.manifestVersion,
    enabled: true,
    buildFingerprint: build.buildFingerprint,
    buildStats: build.stats,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
  };
  writeRegistry(workspaceDir, registry);
  const enabledProjection = enabledProjectionEntriesFromRecords(Object.values(registry.extensions));
  return {
    ok: true,
    workspaceDir,
    sessionId: opts.sessionId ?? null,
    extension: toPublicExtension(registry.extensions[extensionId]),
    extensionSetFingerprint: computeExtensionSetFingerprint(enabledProjection),
    requiresSessionRestart: true,
  };
}

export function extensionList() {
  const workspaceDir = requiredWorkspaceDir();
  const registry = readRegistry(workspaceDir);
  const extensions = Object.values(registry.extensions)
    .sort((a, b) => a.name.localeCompare(b.name) || a.extensionId.localeCompare(b.extensionId))
    .map((record) => toPublicExtension(record));
  const enabledProjection = enabledProjectionEntriesFromRecords(Object.values(registry.extensions));
  return {
    ok: true,
    workspaceDir,
    count: extensions.length,
    extensionSetFingerprint: computeExtensionSetFingerprint(enabledProjection),
    extensions,
  };
}

export function extensionReload(opts: { extensionRef: string; sessionId?: string; failIfMissing?: boolean }) {
  const workspaceDir = requiredWorkspaceDir();
  const registry = readRegistry(workspaceDir);
  const extensionRef = normalizeExtensionRef(opts.extensionRef);
  const found = findRecordByRef(registry, extensionRef);
  if (!found) {
    if (opts.failIfMissing) {
      throw new CliError("E_QUERY_INVALID", `Extension not found: ${extensionRef}`);
    }
    return {
      ok: true,
      workspaceDir,
      sessionId: opts.sessionId ?? null,
      extensionRef,
      extension: null,
      reloaded: false,
      missing: true,
      requiresSessionRestart: false,
      extensionSetFingerprint: computeExtensionSetFingerprint(enabledProjectionEntriesFromRecords(Object.values(registry.extensions))),
    };
  }
  const resolvedPath = parseExtensionPath(found.path);
  const manifest = parseManifest(resolvedPath);
  const build = computeBuildFingerprint(resolvedPath);
  const now = nowIso();
  registry.extensions[found.extensionId] = {
    ...found,
    name: manifest.name,
    version: manifest.version,
    path: resolvedPath,
    manifestVersion: manifest.manifestVersion,
    enabled: true,
    buildFingerprint: build.buildFingerprint,
    buildStats: build.stats,
    updatedAt: now,
  };
  writeRegistry(workspaceDir, registry);
  return {
    ok: true,
    workspaceDir,
    sessionId: opts.sessionId ?? null,
    extension: toPublicExtension(registry.extensions[found.extensionId]),
    reloaded: true,
    missing: false,
    requiresSessionRestart: true,
    extensionSetFingerprint: computeExtensionSetFingerprint(enabledProjectionEntriesFromRecords(Object.values(registry.extensions))),
  };
}

export function extensionUninstall(opts: { extensionRef: string; sessionId?: string; failIfMissing?: boolean }) {
  const workspaceDir = requiredWorkspaceDir();
  const registry = readRegistry(workspaceDir);
  const extensionRef = normalizeExtensionRef(opts.extensionRef);
  const found = findRecordByRef(registry, extensionRef);
  if (!found) {
    if (opts.failIfMissing) {
      throw new CliError("E_QUERY_INVALID", `Extension not found: ${extensionRef}`);
    }
    return {
      ok: true,
      workspaceDir,
      sessionId: opts.sessionId ?? null,
      extensionRef,
      extension: null,
      removed: false,
      missing: true,
      requiresSessionRestart: false,
      extensionSetFingerprint: computeExtensionSetFingerprint(enabledProjectionEntriesFromRecords(Object.values(registry.extensions))),
    };
  }
  delete registry.extensions[found.extensionId];
  writeRegistry(workspaceDir, registry);
  return {
    ok: true,
    workspaceDir,
    sessionId: opts.sessionId ?? null,
    extension: {
      id: found.extensionId,
      name: found.name,
      path: found.path,
    },
    removed: true,
    missing: false,
    requiresSessionRestart: true,
    extensionSetFingerprint: computeExtensionSetFingerprint(enabledProjectionEntriesFromRecords(Object.values(registry.extensions))),
  };
}
