import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import zlib from "node:zlib";
import process from "node:process";
import { requestContextEnvGet, requestContextEnvSnapshot } from "../request-context.js";

export type Providers = {
  clock: {
    nowMs: () => number;
    nowIso: () => string;
  };
  env: {
    get: (name: string) => string | undefined;
    snapshot: () => NodeJS.ProcessEnv;
  };
  runtime: {
    platform: NodeJS.Platform;
    arch: string;
    version: string;
    argv: string[];
    execPath: string;
    pid: number;
    exitCode: number | string | null | undefined;
    kill: typeof process.kill;
    cwd: () => string;
  };
  fs: {
    chmodSync: typeof fs.chmodSync;
    cpSync: typeof fs.cpSync;
    createReadStream: typeof fs.createReadStream;
    appendFileSync: typeof fs.appendFileSync;
    existsSync: typeof fs.existsSync;
    mkdirSync: typeof fs.mkdirSync;
    readFileSync: typeof fs.readFileSync;
    readdirSync: typeof fs.readdirSync;
    renameSync: typeof fs.renameSync;
    rmSync: typeof fs.rmSync;
    statSync: typeof fs.statSync;
    unlinkSync: typeof fs.unlinkSync;
    writeFileSync: typeof fs.writeFileSync;
  };
  fsPromises: {
    readFile: typeof fsPromises.readFile;
    writeFile: typeof fsPromises.writeFile;
    mkdir: typeof fsPromises.mkdir;
    rm: typeof fsPromises.rm;
    stat: typeof fsPromises.stat;
  };
  path: {
    join: typeof path.join;
    dirname: typeof path.dirname;
    basename: typeof path.basename;
    extname: typeof path.extname;
    resolve: typeof path.resolve;
    relative: typeof path.relative;
  };
  os: {
    homedir: typeof os.homedir;
  };
  crypto: {
    createHash: typeof crypto.createHash;
    randomBytes: typeof crypto.randomBytes;
  };
  net: {
    createConnection: typeof net.createConnection;
    createServer: typeof net.createServer;
  };
  childProcess: {
    spawn: typeof spawn;
    spawnSync: typeof spawnSync;
  };
  zlib: {
    gzipSync: typeof zlib.gzipSync;
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
    env: {
      get: (name) => requestContextEnvGet(name),
      // Return a shallow clone so callers can't mutate the live process.env object.
      snapshot: () => requestContextEnvSnapshot(),
    },
    runtime: {
      platform: process.platform,
      arch: process.arch,
      version: process.version,
      argv: process.argv,
      execPath: process.execPath,
      pid: process.pid,
      exitCode: process.exitCode,
      kill: process.kill,
      cwd: () => process.cwd(),
    },
    fs: {
    chmodSync: fs.chmodSync,
    cpSync: fs.cpSync,
    createReadStream: fs.createReadStream,
    appendFileSync: fs.appendFileSync,
    existsSync: fs.existsSync,
    mkdirSync: fs.mkdirSync,
    readFileSync: fs.readFileSync,
    readdirSync: fs.readdirSync,
      renameSync: fs.renameSync,
      rmSync: fs.rmSync,
      statSync: fs.statSync,
      unlinkSync: fs.unlinkSync,
      writeFileSync: fs.writeFileSync,
    },
    fsPromises: {
      readFile: fsPromises.readFile,
      writeFile: fsPromises.writeFile,
      mkdir: fsPromises.mkdir,
      rm: fsPromises.rm,
      stat: fsPromises.stat,
    },
    path: {
      join: path.join,
      dirname: path.dirname,
      basename: path.basename,
      extname: path.extname,
      resolve: path.resolve,
      relative: path.relative,
    },
    os: {
      homedir: os.homedir,
    },
    crypto: {
      createHash: crypto.createHash,
      randomBytes: crypto.randomBytes,
    },
    net: {
      createConnection: net.createConnection,
      createServer: net.createServer,
    },
    childProcess: {
      spawn,
      spawnSync,
    },
    zlib: {
      gzipSync: zlib.gzipSync,
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
