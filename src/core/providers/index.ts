import fs from "node:fs";
import process from "node:process";

export type Providers = {
  clock: {
    nowMs: () => number;
    nowIso: () => string;
  };
  fs: {
    existsSync: typeof fs.existsSync;
    mkdirSync: typeof fs.mkdirSync;
    readFileSync: typeof fs.readFileSync;
    rmSync: typeof fs.rmSync;
    statSync: typeof fs.statSync;
    unlinkSync: typeof fs.unlinkSync;
    writeFileSync: typeof fs.writeFileSync;
  };
  process: {
    env: NodeJS.ProcessEnv;
    platform: NodeJS.Platform;
    arch: string;
    version: string;
    argv: string[];
    exitCode: number | string | null | undefined;
    kill: typeof process.kill;
  };
  artifactWriter: {
    writeJson: (opts: { filePath: string; payload: unknown; pretty: boolean }) => void;
  };
};

function defaultProviders(): Providers {
  return {
    clock: {
      nowMs: () => Date.now(),
      nowIso: () => new Date().toISOString(),
    },
    fs: {
      existsSync: fs.existsSync,
      mkdirSync: fs.mkdirSync,
      readFileSync: fs.readFileSync,
      rmSync: fs.rmSync,
      statSync: fs.statSync,
      unlinkSync: fs.unlinkSync,
      writeFileSync: fs.writeFileSync,
    },
    process: {
      env: process.env,
      platform: process.platform,
      arch: process.arch,
      version: process.version,
      argv: process.argv,
      exitCode: process.exitCode,
      kill: process.kill,
    },
    artifactWriter: {
      writeJson: ({ filePath, payload, pretty }) => {
        fs.writeFileSync(filePath, `${JSON.stringify(payload, null, pretty ? 2 : 0)}\n`, "utf8");
      },
    },
  };
}

let activeProviders: Providers = defaultProviders();

export function providers(): Providers {
  return activeProviders;
}

export function setProvidersForTest(next: Providers): void {
  activeProviders = next;
}

export function resetProvidersForTest(): void {
  activeProviders = defaultProviders();
}
