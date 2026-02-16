import { CliError } from "../errors.js";
import { nowIso, stateRootDir } from "../state/index.js";
import { providers } from "../providers/index.js";

const EXTENSION_REGISTRY_VERSION = 1;

type ExtensionRecord = {
  extensionId: string;
  name: string;
  version: string;
  path: string;
  manifestVersion: number | null;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
};

type ExtensionRegistry = {
  version: number;
  extensions: Record<string, ExtensionRecord>;
};

type ExtensionCapability = {
  headlessMode: "headless-new";
  runtimeInstallSupported: false;
  requiresSessionRestart: true;
};

type ExtensionFallback = {
  strategy: "registry-only";
  applied: false;
  reason: string;
};

function extensionRegistryPath(): string {
  return providers().path.join(stateRootDir(), "extensions.json");
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
    typeof value.installedAt !== "string" ||
    value.installedAt.length === 0 ||
    typeof value.updatedAt !== "string" ||
    value.updatedAt.length === 0
  ) {
    return null;
  }
  const manifestVersion =
    typeof value.manifestVersion === "number" && Number.isFinite(value.manifestVersion) ? value.manifestVersion : null;
  return {
    extensionId: value.extensionId,
    name: value.name,
    version: value.version,
    path: value.path,
    manifestVersion,
    enabled: value.enabled,
    installedAt: value.installedAt,
    updatedAt: value.updatedAt,
  };
}

function readRegistry(): ExtensionRegistry {
  const { fs } = providers();
  const registryPath = extensionRegistryPath();
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
      version:
        typeof raw.version === "number" && Number.isFinite(raw.version)
          ? raw.version
          : EXTENSION_REGISTRY_VERSION,
      extensions,
    };
  } catch {
    return emptyRegistry();
  }
}

function writeRegistry(registry: ExtensionRegistry): void {
  const { fs, path } = providers();
  const registryPath = extensionRegistryPath();
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function parseExtensionPath(input: string): string {
  const { fs, path } = providers();
  const value = input.trim();
  if (!value) {
    throw new CliError("E_QUERY_INVALID", "path must not be empty");
  }
  const resolved = path.resolve(value);
  if (!fs.existsSync(resolved)) {
    throw new CliError("E_QUERY_INVALID", `Extension path not found: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new CliError("E_QUERY_INVALID", "extension path must be a directory");
  }
  return resolved;
}

function parseManifest(extensionPath: string): { name: string; version: string; manifestVersion: number | null } {
  const { fs, path } = providers();
  const manifestPath = path.join(extensionPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new CliError("E_QUERY_INVALID", `manifest.json not found under ${extensionPath}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown;
  } catch {
    throw new CliError("E_QUERY_INVALID", "manifest.json must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new CliError("E_QUERY_INVALID", "manifest.json must be a JSON object");
  }
  const manifest = parsed as {
    name?: unknown;
    version?: unknown;
    manifest_version?: unknown;
  };
  if (typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
    throw new CliError("E_QUERY_INVALID", "manifest.json name must be a non-empty string");
  }
  if (typeof manifest.version !== "string" || manifest.version.trim().length === 0) {
    throw new CliError("E_QUERY_INVALID", "manifest.json version must be a non-empty string");
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
  const { crypto } = providers();
  const digest = crypto.createHash("sha256").update(extensionPath).digest("hex");
  return `ext-${digest.slice(0, 12)}`;
}

function capability(): ExtensionCapability {
  return {
    headlessMode: "headless-new",
    runtimeInstallSupported: false,
    requiresSessionRestart: true,
  };
}

function fallback(reason = "Runtime unpacked-extension install is not available on current headless launch path"): ExtensionFallback {
  return {
    strategy: "registry-only",
    applied: false,
    reason,
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

export function extensionLoad(opts: { extensionPath: string; sessionId?: string }) {
  const resolvedPath = parseExtensionPath(opts.extensionPath);
  const manifest = parseManifest(resolvedPath);
  const extensionId = computeExtensionId(resolvedPath);
  const registry = readRegistry();
  const now = nowIso();
  const existing = registry.extensions[extensionId];
  registry.extensions[extensionId] = {
    extensionId,
    name: manifest.name,
    version: manifest.version,
    path: resolvedPath,
    manifestVersion: manifest.manifestVersion,
    enabled: true,
    installedAt: existing?.installedAt ?? now,
    updatedAt: now,
  };
  writeRegistry(registry);
  return {
    ok: true,
    sessionId: opts.sessionId ?? null,
    extension: toPublicExtension(registry.extensions[extensionId]),
    capability: capability(),
    fallback: fallback(),
  };
}

export function extensionList() {
  const registry = readRegistry();
  const extensions = Object.values(registry.extensions)
    .sort((a, b) => a.name.localeCompare(b.name) || a.extensionId.localeCompare(b.extensionId))
    .map((record) => toPublicExtension(record));
  return {
    ok: true,
    count: extensions.length,
    extensions,
    capability: capability(),
  };
}

export function extensionReload(opts: { extensionRef: string; sessionId?: string; failIfMissing?: boolean }) {
  const registry = readRegistry();
  const extensionRef = normalizeExtensionRef(opts.extensionRef);
  const found = findRecordByRef(registry, extensionRef);
  if (!found) {
    if (opts.failIfMissing) {
      throw new CliError("E_QUERY_INVALID", `Extension not found: ${extensionRef}`);
    }
    return {
      ok: true,
      sessionId: opts.sessionId ?? null,
      extensionRef,
      extension: null,
      reloaded: false,
      missing: true,
      capability: capability(),
      fallback: fallback("Extension not registered; no reload action applied"),
    };
  }
  const now = nowIso();
  registry.extensions[found.extensionId] = {
    ...found,
    enabled: true,
    updatedAt: now,
  };
  writeRegistry(registry);
  return {
    ok: true,
    sessionId: opts.sessionId ?? null,
    extension: toPublicExtension(registry.extensions[found.extensionId]),
    reloaded: true,
    missing: false,
    capability: capability(),
    fallback: fallback(),
  };
}

export function extensionUninstall(opts: { extensionRef: string; sessionId?: string; failIfMissing?: boolean }) {
  const registry = readRegistry();
  const extensionRef = normalizeExtensionRef(opts.extensionRef);
  const found = findRecordByRef(registry, extensionRef);
  if (!found) {
    if (opts.failIfMissing) {
      throw new CliError("E_QUERY_INVALID", `Extension not found: ${extensionRef}`);
    }
    return {
      ok: true,
      sessionId: opts.sessionId ?? null,
      extensionRef,
      extension: null,
      removed: false,
      missing: true,
      capability: capability(),
      fallback: fallback("Extension not registered; no uninstall action applied"),
    };
  }
  delete registry.extensions[found.extensionId];
  writeRegistry(registry);
  return {
    ok: true,
    sessionId: opts.sessionId ?? null,
    extension: {
      id: found.extensionId,
      name: found.name,
      path: found.path,
    },
    removed: true,
    missing: false,
    capability: capability(),
    fallback: fallback(),
  };
}
