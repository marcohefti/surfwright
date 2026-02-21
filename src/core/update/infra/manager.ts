import { CliError } from "../../errors.js";
import { readRuntimeConfig, type UpdateChannel, type UpdatePolicy } from "./config.js";
import { compareSemver, isSamePatchLine } from "../../shared/index.js";
import { stateRootDir } from "../../state/index.js";
import { providers } from "../../providers/index.js";

export const UPDATE_DIST_TAG_BY_CHANNEL: Record<UpdateChannel, string> = {
  stable: "latest",
  beta: "next",
  dev: "dev",
};

export type UpdateCheckReport = {
  ok: true;
  currentVersion: string;
  packageName: string;
  channel: UpdateChannel;
  distTag: string;
  policy: UpdatePolicy;
  checkOnStart: boolean;
  pinnedVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  blockedByPolicy: boolean;
  reason: string;
};

export type UpdateRunReport = {
  ok: true;
  status: "noop" | "updated" | "blocked" | "rolled-back";
  oldVersion: string;
  newVersion: string;
  channel: UpdateChannel;
  policy: UpdatePolicy;
  packageName: string;
  checkOnStart: boolean;
  distTag: string;
  dryRun: boolean;
  rollback: {
    attempted: boolean;
    success: boolean;
    targetVersion: string | null;
  };
};

type UpdateResolvedPolicy = {
  channel: UpdateChannel;
  policy: UpdatePolicy;
  pinnedVersion: string | null;
  checkOnStart: boolean;
};

function resolvePolicy(opts: {
  channel?: UpdateChannel;
  policy?: UpdatePolicy;
  pinnedVersion?: string;
  checkOnStart?: boolean;
}): UpdateResolvedPolicy {
  const config = readRuntimeConfig();
  const inputChannel = opts.channel;
  const inputPolicy = opts.policy;
  return {
    channel:
      inputChannel === "stable" || inputChannel === "beta" || inputChannel === "dev"
        ? inputChannel
        : config.update.channel,
    policy:
      inputPolicy === "manual" || inputPolicy === "pinned" || inputPolicy === "safe-patch"
        ? inputPolicy
        : config.update.policy,
    pinnedVersion: typeof opts.pinnedVersion === "string" && opts.pinnedVersion.length > 0 ? opts.pinnedVersion : config.update.pinnedVersion,
    checkOnStart: typeof opts.checkOnStart === "boolean" ? opts.checkOnStart : config.update.checkOnStart,
  };
}

function parseDistTags(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.length > 0) {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function loadDistTagVersion(packageName: string, distTag: string): string | null {
  const { childProcess, env } = providers();
  const result = childProcess.spawnSync("npm", ["view", packageName, "dist-tags", "--json"], {
    encoding: "utf8",
    env: env.snapshot(),
  });
  if (result.status !== 0) {
    throw new CliError("E_UPDATE_METADATA", `Unable to fetch dist-tags for ${packageName}`);
  }
  const distTags = parseDistTags(result.stdout);
  return typeof distTags[distTag] === "string" ? distTags[distTag] : null;
}

function policyBlocksUpdate(opts: { policy: UpdatePolicy; currentVersion: string; targetVersion: string; pinnedVersion: string | null }): {
  blocked: boolean;
  reason: string;
} {
  if (opts.policy === "manual") {
    return { blocked: true, reason: "manual-policy" };
  }
  if (opts.policy === "pinned") {
    if (!opts.pinnedVersion) {
      return { blocked: true, reason: "pinned-policy-missing-version" };
    }
    if (opts.pinnedVersion !== opts.targetVersion) {
      return { blocked: true, reason: "pinned-policy-version-mismatch" };
    }
    return { blocked: false, reason: "pinned-policy-pass" };
  }
  if (opts.policy === "safe-patch" && !isSamePatchLine(opts.currentVersion, opts.targetVersion)) {
    return { blocked: true, reason: "safe-patch-policy-nonpatch-update" };
  }
  return { blocked: false, reason: "policy-pass" };
}

function hasGitRepo(cwd: string): boolean {
  const { fs, path } = providers();
  return fs.existsSync(path.join(cwd, ".git"));
}

function ensureSourceInstallPreconditions(cwd: string): void {
  const { childProcess, env } = providers();
  if (!hasGitRepo(cwd)) {
    return;
  }

  const status = childProcess.spawnSync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf8",
    env: env.snapshot(),
  });
  if (status.status !== 0) {
    throw new CliError("E_UPDATE_PRECONDITION", "Unable to verify git worktree status");
  }
  if (status.stdout.trim().length > 0) {
    throw new CliError("E_UPDATE_PRECONDITION", "Refusing update on dirty worktree");
  }

  const branch = childProcess.spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd,
    encoding: "utf8",
    env: env.snapshot(),
  });
  if (branch.status !== 0) {
    throw new CliError("E_UPDATE_PRECONDITION", "Unable to verify current git branch");
  }
  if (branch.stdout.trim() !== "main") {
    throw new CliError("E_UPDATE_PRECONDITION", "Refusing update outside main branch");
  }
}

function updateHistoryPath(): string {
  return providers().path.join(stateRootDir(), "updates", "history.json");
}

type UpdateHistoryEntry = {
  timestamp: string;
  packageName: string;
  oldVersion: string;
  newVersion: string;
  channel: UpdateChannel;
  policy: UpdatePolicy;
  status: "updated" | "rolled-back";
};

function readHistory(): UpdateHistoryEntry[] {
  try {
    const raw = providers().fs.readFileSync(updateHistoryPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UpdateHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function appendHistory(entry: UpdateHistoryEntry): void {
  const { fs, path } = providers();
  const history = readHistory();
  history.push(entry);
  const outPath = updateHistoryPath();
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

function runNpmInstallGlobal(packageSpec: string): void {
  const { childProcess, env } = providers();
  const result = childProcess.spawnSync("npm", ["install", "-g", packageSpec], {
    stdio: "inherit",
    env: env.snapshot(),
  });
  if (result.status !== 0) {
    throw new CliError("E_UPDATE_APPLY_FAILED", `npm install failed for ${packageSpec}`);
  }
}

function runDoctorSelfCheck(cliPath: string): boolean {
  const { childProcess, env, runtime } = providers();
  const result = childProcess.spawnSync(runtime.execPath, [cliPath, "doctor"], {
    encoding: "utf8",
    env: env.snapshot(),
  });
  return result.status === 0;
}

export async function updateCheck(opts: {
  currentVersion: string;
  packageName?: string;
  channel?: UpdateChannel;
  policy?: UpdatePolicy;
  pinnedVersion?: string;
  checkOnStart?: boolean;
}): Promise<UpdateCheckReport> {
  const packageName = opts.packageName ?? "@marcohefti/surfwright";
  const resolved = resolvePolicy({
    channel: opts.channel,
    policy: opts.policy,
    pinnedVersion: opts.pinnedVersion,
    checkOnStart: opts.checkOnStart,
  });

  const distTag = UPDATE_DIST_TAG_BY_CHANNEL[resolved.channel];
  const latestVersion = loadDistTagVersion(packageName, distTag);
  const updateAvailable = typeof latestVersion === "string" && compareSemver(latestVersion, opts.currentVersion) > 0;

  if (!updateAvailable || !latestVersion) {
    return {
      ok: true,
      currentVersion: opts.currentVersion,
      packageName,
      channel: resolved.channel,
      distTag,
      policy: resolved.policy,
      checkOnStart: resolved.checkOnStart,
      pinnedVersion: resolved.pinnedVersion,
      latestVersion,
      updateAvailable: false,
      blockedByPolicy: false,
      reason: "up-to-date",
    };
  }

  const policyGate = policyBlocksUpdate({
    policy: resolved.policy,
    currentVersion: opts.currentVersion,
    targetVersion: latestVersion,
    pinnedVersion: resolved.pinnedVersion,
  });

  return {
    ok: true,
    currentVersion: opts.currentVersion,
    packageName,
    channel: resolved.channel,
    distTag,
    policy: resolved.policy,
    checkOnStart: resolved.checkOnStart,
    pinnedVersion: resolved.pinnedVersion,
    latestVersion,
    updateAvailable: true,
    blockedByPolicy: policyGate.blocked,
    reason: policyGate.reason,
  };
}

export async function updateRun(opts: {
  currentVersion: string;
  cliPath: string;
  packageName?: string;
  channel?: UpdateChannel;
  policy?: UpdatePolicy;
  pinnedVersion?: string;
  checkOnStart?: boolean;
  dryRun?: boolean;
}): Promise<UpdateRunReport> {
  const check = await updateCheck({
    currentVersion: opts.currentVersion,
    packageName: opts.packageName,
    channel: opts.channel,
    policy: opts.policy,
    pinnedVersion: opts.pinnedVersion,
    checkOnStart: opts.checkOnStart,
  });

  if (!check.updateAvailable || !check.latestVersion) {
    return {
      ok: true,
      status: "noop",
      oldVersion: opts.currentVersion,
      newVersion: opts.currentVersion,
      channel: check.channel,
      policy: check.policy,
      packageName: check.packageName,
      checkOnStart: check.checkOnStart,
      distTag: check.distTag,
      dryRun: Boolean(opts.dryRun),
      rollback: {
        attempted: false,
        success: false,
        targetVersion: null,
      },
    };
  }

  if (check.blockedByPolicy) {
    return {
      ok: true,
      status: "blocked",
      oldVersion: opts.currentVersion,
      newVersion: opts.currentVersion,
      channel: check.channel,
      policy: check.policy,
      packageName: check.packageName,
      checkOnStart: check.checkOnStart,
      distTag: check.distTag,
      dryRun: Boolean(opts.dryRun),
      rollback: {
        attempted: false,
        success: false,
        targetVersion: null,
      },
    };
  }

  ensureSourceInstallPreconditions(providers().runtime.cwd());

  if (opts.dryRun) {
    return {
      ok: true,
      status: "updated",
      oldVersion: opts.currentVersion,
      newVersion: check.latestVersion,
      channel: check.channel,
      policy: check.policy,
      packageName: check.packageName,
      checkOnStart: check.checkOnStart,
      distTag: check.distTag,
      dryRun: true,
      rollback: {
        attempted: false,
        success: false,
        targetVersion: null,
      },
    };
  }

  runNpmInstallGlobal(`${check.packageName}@${check.latestVersion}`);
  const doctorOk = runDoctorSelfCheck(opts.cliPath);

  if (!doctorOk) {
    try {
      runNpmInstallGlobal(`${check.packageName}@${opts.currentVersion}`);
      appendHistory({
        timestamp: new Date().toISOString(),
        packageName: check.packageName,
        oldVersion: check.latestVersion,
        newVersion: opts.currentVersion,
        channel: check.channel,
        policy: check.policy,
        status: "rolled-back",
      });
    } catch {
      throw new CliError("E_UPDATE_HEALTHCHECK_FAILED", "Update failed doctor check and rollback failed");
    }

    return {
      ok: true,
      status: "rolled-back",
      oldVersion: opts.currentVersion,
      newVersion: opts.currentVersion,
      channel: check.channel,
      policy: check.policy,
      packageName: check.packageName,
      checkOnStart: check.checkOnStart,
      distTag: check.distTag,
      dryRun: false,
      rollback: {
        attempted: true,
        success: true,
        targetVersion: opts.currentVersion,
      },
    };
  }

  appendHistory({
    timestamp: new Date().toISOString(),
    packageName: check.packageName,
    oldVersion: opts.currentVersion,
    newVersion: check.latestVersion,
    channel: check.channel,
    policy: check.policy,
    status: "updated",
  });

  return {
    ok: true,
    status: "updated",
    oldVersion: opts.currentVersion,
    newVersion: check.latestVersion,
    channel: check.channel,
    policy: check.policy,
    packageName: check.packageName,
    checkOnStart: check.checkOnStart,
    distTag: check.distTag,
    dryRun: false,
    rollback: {
      attempted: false,
      success: false,
      targetVersion: null,
    },
  };
}

export async function updateRollback(opts: { currentVersion: string; packageName?: string; dryRun?: boolean }): Promise<UpdateRunReport> {
  const packageName = opts.packageName ?? "@marcohefti/surfwright";
  const history = readHistory();
  const lastUpdated = [...history].reverse().find((entry) => entry.packageName === packageName && entry.status === "updated");
  if (!lastUpdated) {
    throw new CliError("E_UPDATE_ROLLBACK_NOT_AVAILABLE", `No update history entry found for ${packageName}`);
  }

  if (opts.dryRun) {
    return {
      ok: true,
      status: "rolled-back",
      oldVersion: opts.currentVersion,
      newVersion: lastUpdated.oldVersion,
      channel: lastUpdated.channel,
      policy: lastUpdated.policy,
      packageName,
      checkOnStart: readRuntimeConfig().update.checkOnStart,
      distTag: UPDATE_DIST_TAG_BY_CHANNEL[lastUpdated.channel],
      dryRun: true,
      rollback: {
        attempted: true,
        success: true,
        targetVersion: lastUpdated.oldVersion,
      },
    };
  }

  runNpmInstallGlobal(`${packageName}@${lastUpdated.oldVersion}`);

  appendHistory({
    timestamp: new Date().toISOString(),
    packageName,
    oldVersion: opts.currentVersion,
    newVersion: lastUpdated.oldVersion,
    channel: lastUpdated.channel,
    policy: lastUpdated.policy,
    status: "rolled-back",
  });

  return {
    ok: true,
    status: "rolled-back",
    oldVersion: opts.currentVersion,
    newVersion: lastUpdated.oldVersion,
    channel: lastUpdated.channel,
    policy: lastUpdated.policy,
    packageName,
    checkOnStart: readRuntimeConfig().update.checkOnStart,
    distTag: UPDATE_DIST_TAG_BY_CHANNEL[lastUpdated.channel],
    dryRun: false,
    rollback: {
      attempted: true,
      success: true,
      targetVersion: lastUpdated.oldVersion,
    },
  };
}
