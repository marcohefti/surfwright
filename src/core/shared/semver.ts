export type Semver = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
};

function parseCore(input: string): [number, number, number] | null {
  const [majorRaw, minorRaw, patchRaw] = input.split(".");
  if (majorRaw === undefined || minorRaw === undefined || patchRaw === undefined) {
    return null;
  }
  const major = Number.parseInt(majorRaw, 10);
  const minor = Number.parseInt(minorRaw, 10);
  const patch = Number.parseInt(patchRaw, 10);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return null;
  }
  if (major < 0 || minor < 0 || patch < 0) {
    return null;
  }
  return [major, minor, patch];
}

export function parseSemver(input: string): Semver | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const [base, prereleaseRaw] = trimmed.split("-");
  if (!base) {
    return null;
  }
  const core = parseCore(base);
  if (!core) {
    return null;
  }
  return {
    major: core[0],
    minor: core[1],
    patch: core[2],
    prerelease: typeof prereleaseRaw === "string" && prereleaseRaw.length > 0 ? prereleaseRaw : null,
  };
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    return a.localeCompare(b);
  }
  if (pa.major !== pb.major) {
    return pa.major - pb.major;
  }
  if (pa.minor !== pb.minor) {
    return pa.minor - pb.minor;
  }
  if (pa.patch !== pb.patch) {
    return pa.patch - pb.patch;
  }
  if (pa.prerelease === pb.prerelease) {
    return 0;
  }
  if (pa.prerelease === null) {
    return 1;
  }
  if (pb.prerelease === null) {
    return -1;
  }
  return pa.prerelease.localeCompare(pb.prerelease);
}

export function isSamePatchLine(a: string, b: string): boolean {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) {
    return false;
  }
  return pa.major === pb.major && pa.minor === pb.minor;
}

export function satisfiesRange(version: string, range: string): boolean {
  const normalized = range.trim();
  if (normalized.length === 0) {
    return false;
  }

  if (/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(normalized)) {
    return compareSemver(version, normalized) === 0;
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return false;
  }

  for (const part of parts) {
    if (part.startsWith(">=")) {
      if (compareSemver(version, part.slice(2)) < 0) {
        return false;
      }
      continue;
    }
    if (part.startsWith("<=")) {
      if (compareSemver(version, part.slice(2)) > 0) {
        return false;
      }
      continue;
    }
    if (part.startsWith(">")) {
      if (compareSemver(version, part.slice(1)) <= 0) {
        return false;
      }
      continue;
    }
    if (part.startsWith("<")) {
      if (compareSemver(version, part.slice(1)) >= 0) {
        return false;
      }
      continue;
    }
    if (part.startsWith("^")) {
      const min = parseSemver(part.slice(1));
      const cur = parseSemver(version);
      if (!min || !cur) {
        return false;
      }
      if (cur.major !== min.major) {
        return false;
      }
      if (compareSemver(version, part.slice(1)) < 0) {
        return false;
      }
      continue;
    }
    return false;
  }

  return true;
}
