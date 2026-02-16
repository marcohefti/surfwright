import { CliError } from "../errors.js";
import { satisfiesRange } from "../shared/index.js";
import { providers } from "../providers/index.js";

export type SkillManifest = {
  schemaVersion: number;
  name: string;
  skillVersion: string;
  channel: "stable" | "beta" | "dev";
  requires: {
    surfwrightVersion: string;
    contractSchemaVersion: string;
    contractFingerprint: string;
  };
  artifacts: {
    entry: string;
    agentConfig: string;
  };
};

export type SkillInstallReport = {
  ok: true;
  status: "installed" | "updated";
  name: string;
  skillVersion: string;
  destination: string;
  lockPath: string | null;
  digest: string;
};

export type SkillDoctorReport = {
  ok: true;
  installed: boolean;
  name: string;
  destination: string;
  skillVersion: string | null;
  compatible: boolean;
  reason: string;
  lockPath: string | null;
  lockStatus: "missing" | "match" | "drift";
};

type ContractMeta = {
  version: string;
  contractSchemaVersion: number;
  contractFingerprint: string;
};

function defaultSkillDestination(): string {
  const { env, os, path } = providers();
  const fromEnv = env.get("CODEX_HOME");
  const codexHome = typeof fromEnv === "string" && fromEnv.trim().length > 0 ? fromEnv.trim() : path.join(os.homedir(), ".codex");
  return path.join(codexHome, "skills", "surfwright");
}

function defaultSourcePath(): string {
  const { path, runtime } = providers();
  return path.resolve(runtime.cwd(), "skills", "surfwright");
}

function defaultLockPath(): string {
  const { path, runtime } = providers();
  return path.resolve(runtime.cwd(), "skills", "surfwright.lock.json");
}

function readManifest(manifestPath: string): SkillManifest {
  const { fs } = providers();
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new CliError("E_SKILL_MANIFEST_INVALID", `Unable to read skill manifest at ${manifestPath}`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new CliError("E_SKILL_MANIFEST_INVALID", "skill manifest must be an object");
  }
  const value = raw as SkillManifest;
  if (value.schemaVersion !== 1) {
    throw new CliError("E_SKILL_MANIFEST_INVALID", "skill manifest schemaVersion must be 1");
  }
  if (value.name !== "surfwright") {
    throw new CliError("E_SKILL_MANIFEST_INVALID", "skill manifest name must be 'surfwright'");
  }
  if (typeof value.skillVersion !== "string" || value.skillVersion.length === 0) {
    throw new CliError("E_SKILL_MANIFEST_INVALID", "skill manifest skillVersion is required");
  }
  if (value.channel !== "stable" && value.channel !== "beta" && value.channel !== "dev") {
    throw new CliError("E_SKILL_MANIFEST_INVALID", "skill manifest channel must be stable|beta|dev");
  }
  if (!value.requires || typeof value.requires !== "object") {
    throw new CliError("E_SKILL_MANIFEST_INVALID", "skill manifest requires block is required");
  }
  if (typeof value.requires.surfwrightVersion !== "string" || value.requires.surfwrightVersion.length === 0) {
    throw new CliError("E_SKILL_MANIFEST_INVALID", "requires.surfwrightVersion is required");
  }
  if (typeof value.requires.contractSchemaVersion !== "string" || value.requires.contractSchemaVersion.length === 0) {
    throw new CliError("E_SKILL_MANIFEST_INVALID", "requires.contractSchemaVersion is required");
  }
  if (typeof value.requires.contractFingerprint !== "string" || value.requires.contractFingerprint.length === 0) {
    throw new CliError("E_SKILL_MANIFEST_INVALID", "requires.contractFingerprint is required");
  }
  return value;
}

function checkCompatibility(manifest: SkillManifest, contract: ContractMeta): void {
  if (!satisfiesRange(contract.version, manifest.requires.surfwrightVersion)) {
    throw new CliError(
      "E_SKILL_COMPAT_VERSION_MISMATCH",
      `skill requires surfwrightVersion '${manifest.requires.surfwrightVersion}' but current is '${contract.version}'`,
    );
  }

  const expectedSchema = manifest.requires.contractSchemaVersion.trim();
  if (!expectedSchema.startsWith("^")) {
    throw new CliError("E_SKILL_MANIFEST_INVALID", "requires.contractSchemaVersion must use '^<major>' format");
  }
  const expectedMajor = Number.parseInt(expectedSchema.slice(1), 10);
  if (!Number.isFinite(expectedMajor)) {
    throw new CliError("E_SKILL_MANIFEST_INVALID", "requires.contractSchemaVersion contains invalid major value");
  }
  if (contract.contractSchemaVersion !== expectedMajor) {
    throw new CliError(
      "E_SKILL_COMPAT_CONTRACT_SCHEMA_MISMATCH",
      `skill requires contractSchemaVersion '${manifest.requires.contractSchemaVersion}' but current is '${contract.contractSchemaVersion}'`,
    );
  }

  if (manifest.requires.contractFingerprint !== contract.contractFingerprint) {
    throw new CliError(
      "E_SKILL_COMPAT_CONTRACT_MISMATCH",
      "skill requires a different contractFingerprint than current surfwright runtime",
    );
  }
}

function listFilesRecursive(rootDir: string): string[] {
  const { fs, path } = providers();
  const out: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const relPath = path.relative(rootDir, absPath).replace(/\\/g, "/");
      if (relPath === ".install-meta.json") {
        continue;
      }
      out.push(relPath);
    }
  }
  out.sort();
  return out;
}

function computeDigest(rootDir: string): string {
  const { crypto, fs, path } = providers();
  const hash = crypto.createHash("sha256");
  const files = listFilesRecursive(rootDir);
  for (const file of files) {
    hash.update(file);
    hash.update("\n");
    hash.update(fs.readFileSync(path.join(rootDir, file)));
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

function writeLock(lockPath: string, manifest: SkillManifest, digest: string): void {
  const { fs, path } = providers();
  const payload = {
    schemaVersion: 1,
    name: manifest.name,
    skillVersion: manifest.skillVersion,
    channel: manifest.channel,
    digest,
    requires: manifest.requires,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readLock(lockPath: string): { skillVersion?: unknown; digest?: unknown } | null {
  const { fs } = providers();
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return parsed as { skillVersion?: unknown; digest?: unknown };
  } catch {
    return null;
  }
}

function resolveSource(source?: string): string {
  const { fs, path } = providers();
  const resolved = path.resolve(typeof source === "string" && source.length > 0 ? source : defaultSourcePath());
  if (!fs.existsSync(resolved)) {
    throw new CliError("E_SKILL_SOURCE_NOT_FOUND", `Skill source not found: ${resolved}`);
  }
  return resolved;
}

function atomicInstall(opts: {
  sourceDir: string;
  destination: string;
}): string {
  const { fs, path, runtime } = providers();
  const { sourceDir, destination } = opts;
  const parentDir = path.dirname(destination);
  fs.mkdirSync(parentDir, { recursive: true });

  const staged = `${destination}.tmp.${runtime.pid}.${Date.now()}`;
  const backup = `${destination}.prev.${Date.now()}`;

  fs.rmSync(staged, { recursive: true, force: true });
  fs.cpSync(sourceDir, staged, { recursive: true });

  let backupCreated = false;
  try {
    if (fs.existsSync(destination)) {
      fs.rmSync(backup, { recursive: true, force: true });
      fs.renameSync(destination, backup);
      backupCreated = true;
    }
    fs.renameSync(staged, destination);
    if (backupCreated) {
      fs.rmSync(backup, { recursive: true, force: true });
    }
  } catch (error) {
    fs.rmSync(staged, { recursive: true, force: true });
    if (backupCreated && fs.existsSync(backup) && !fs.existsSync(destination)) {
      fs.renameSync(backup, destination);
    }
    const message = error instanceof Error ? error.message : "atomic install failed";
    throw new CliError("E_SKILL_INSTALL_ATOMIC_SWAP_FAILED", message);
  }

  return backup;
}

function writeInstallMeta(destination: string, manifest: SkillManifest, sourceDir: string, digest: string): void {
  const { fs, path } = providers();
  const payload = {
    installedAt: new Date().toISOString(),
    sourceDir,
    name: manifest.name,
    skillVersion: manifest.skillVersion,
    digest,
  };
  fs.writeFileSync(path.join(destination, ".install-meta.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

export async function skillInstall(opts: {
  source?: string;
  destination?: string;
  lockPath?: string;
  mode?: "install" | "update";
  contract: ContractMeta;
}): Promise<SkillInstallReport> {
  const { path } = providers();
  const sourceDir = resolveSource(opts.source);
  const manifest = readManifest(path.join(sourceDir, "skill.json"));
  checkCompatibility(manifest, opts.contract);

  const destination = path.resolve(opts.destination ?? defaultSkillDestination());
  const digest = computeDigest(sourceDir);

  atomicInstall({ sourceDir, destination });
  writeInstallMeta(destination, manifest, sourceDir, digest);

  const lockPath = typeof opts.lockPath === "string" && opts.lockPath.length > 0 ? path.resolve(opts.lockPath) : defaultLockPath();
  writeLock(lockPath, manifest, digest);

  return {
    ok: true,
    status: opts.mode === "update" ? "updated" : "installed",
    name: manifest.name,
    skillVersion: manifest.skillVersion,
    destination,
    lockPath,
    digest,
  };
}

export async function skillDoctor(opts: {
  destination?: string;
  lockPath?: string;
  contract: ContractMeta;
}): Promise<SkillDoctorReport> {
  const { fs, path } = providers();
  const destination = path.resolve(opts.destination ?? defaultSkillDestination());
  const manifestPath = path.join(destination, "skill.json");
  const lockPath = typeof opts.lockPath === "string" && opts.lockPath.length > 0 ? path.resolve(opts.lockPath) : defaultLockPath();

  if (!fs.existsSync(manifestPath)) {
    return {
      ok: true,
      installed: false,
      name: "surfwright",
      destination,
      skillVersion: null,
      compatible: false,
      reason: "not-installed",
      lockPath,
      lockStatus: fs.existsSync(lockPath) ? "drift" : "missing",
    };
  }

  const manifest = readManifest(manifestPath);
  let compatible = true;
  let reason = "ok";
  try {
    checkCompatibility(manifest, opts.contract);
  } catch (error) {
    compatible = false;
    reason = error instanceof Error ? error.message : "compatibility-check-failed";
  }

  const digest = computeDigest(destination);
  const lock = readLock(lockPath);
  let lockStatus: "missing" | "match" | "drift" = "missing";
  if (lock) {
    lockStatus = lock.digest === digest && lock.skillVersion === manifest.skillVersion ? "match" : "drift";
  }

  return {
    ok: true,
    installed: true,
    name: manifest.name,
    destination,
    skillVersion: manifest.skillVersion,
    compatible,
    reason,
    lockPath,
    lockStatus,
  };
}

export async function skillUpdate(opts: {
  source?: string;
  destination?: string;
  lockPath?: string;
  contract: ContractMeta;
}): Promise<SkillInstallReport> {
  return await skillInstall({
    source: opts.source,
    destination: opts.destination,
    lockPath: opts.lockPath,
    mode: "update",
    contract: opts.contract,
  });
}
