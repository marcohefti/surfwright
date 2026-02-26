import { AsyncLocalStorage } from "node:async_hooks";
import process from "node:process";

type OutputCapture = {
  stdout: string[];
  stderr: string[];
};

type RequestContext = {
  envOverrides: Record<string, string | undefined>;
  outputCapture: OutputCapture | null;
  exitCode: number;
};

const storage = new AsyncLocalStorage<RequestContext>();

const stdoutRef = process.stdout as unknown as { write: typeof process.stdout.write };
const stderrRef = process.stderr as unknown as { write: typeof process.stderr.write };
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);
let outputInterceptorsInstalled = false;

function appendCapturedChunk(
  chunks: string[],
  chunk: Uint8Array | string,
  encoding?: BufferEncoding | ((error?: Error | null) => void),
): void {
  if (typeof chunk === "string") {
    chunks.push(chunk);
    return;
  }
  const parsedEncoding = typeof encoding === "string" ? encoding : "utf8";
  chunks.push(Buffer.from(chunk).toString(parsedEncoding));
}

function finishCapturedWrite(
  encoding?: BufferEncoding | ((error?: Error | null) => void),
  callback?: (error?: Error | null) => void,
): void {
  if (typeof encoding === "function") {
    encoding(null);
  }
  if (typeof callback === "function") {
    callback(null);
  }
}

function installOutputInterceptors(): void {
  if (outputInterceptorsInstalled) {
    return;
  }
  outputInterceptorsInstalled = true;

  stdoutRef.write = ((chunk, encoding, callback) => {
    const context = storage.getStore();
    if (!context?.outputCapture) {
      return originalStdoutWrite(chunk as never, encoding as never, callback as never);
    }
    appendCapturedChunk(context.outputCapture.stdout, chunk, encoding);
    finishCapturedWrite(encoding, callback);
    return true;
  }) as typeof process.stdout.write;

  stderrRef.write = ((chunk, encoding, callback) => {
    const context = storage.getStore();
    if (!context?.outputCapture) {
      return originalStderrWrite(chunk as never, encoding as never, callback as never);
    }
    appendCapturedChunk(context.outputCapture.stderr, chunk, encoding);
    finishCapturedWrite(encoding, callback);
    return true;
  }) as typeof process.stderr.write;
}

function mergedEnvOverrides(next: Record<string, string | undefined>): Record<string, string | undefined> {
  const parent = storage.getStore();
  if (!parent) {
    return { ...next };
  }
  return {
    ...parent.envOverrides,
    ...next,
  };
}

function resolveInitialExitCode(initialExitCode: number | undefined, parent: RequestContext | undefined): number {
  if (typeof initialExitCode === "number") {
    return initialExitCode;
  }
  if (typeof parent?.exitCode === "number") {
    return parent.exitCode;
  }
  return typeof process.exitCode === "number" ? process.exitCode : 0;
}

export function withRequestContext<T>(opts: {
  envOverrides?: Record<string, string | undefined>;
  initialExitCode?: number;
  captureOutput?: boolean;
  run: () => Promise<T>;
}): Promise<T> {
  installOutputInterceptors();
  const parent = storage.getStore();
  const outputCapture =
    opts.captureOutput === true
      ? {
          stdout: [],
          stderr: [],
        }
      : parent?.outputCapture ?? null;
  const context: RequestContext = {
    envOverrides: mergedEnvOverrides(opts.envOverrides ?? {}),
    outputCapture,
    exitCode: resolveInitialExitCode(opts.initialExitCode, parent),
  };
  return storage.run(context, opts.run);
}

export async function withCapturedRequestContext<T>(opts: {
  envOverrides?: Record<string, string | undefined>;
  initialExitCode?: number;
  run: () => Promise<T>;
}): Promise<{ result: T; stdout: string; stderr: string; exitCode: number }> {
  installOutputInterceptors();
  const capture: OutputCapture = {
    stdout: [],
    stderr: [],
  };
  const context: RequestContext = {
    envOverrides: mergedEnvOverrides(opts.envOverrides ?? {}),
    outputCapture: capture,
    exitCode: typeof opts.initialExitCode === "number" ? opts.initialExitCode : 0,
  };
  return await storage.run(context, async () => {
    const result = await opts.run();
    return {
      result,
      stdout: capture.stdout.join(""),
      stderr: capture.stderr.join(""),
      exitCode: context.exitCode,
    };
  });
}

export function requestContextEnvGet(name: string): string | undefined {
  const context = storage.getStore();
  if (context && Object.prototype.hasOwnProperty.call(context.envOverrides, name)) {
    return context.envOverrides[name];
  }
  return typeof process.env[name] === "string" ? process.env[name] : undefined;
}

export function requestContextEnvSnapshot(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...process.env };
  const context = storage.getStore();
  if (!context) {
    return out;
  }
  for (const [key, value] of Object.entries(context.envOverrides)) {
    if (typeof value === "string") {
      out[key] = value;
    } else {
      delete out[key];
    }
  }
  return out;
}

export function setRequestExitCode(code: number): void {
  const context = storage.getStore();
  if (!context) {
    process.exitCode = code;
    return;
  }
  context.exitCode = code;
}

export function getRequestExitCode(defaultCode = 0): number {
  const context = storage.getStore();
  if (context) {
    return context.exitCode;
  }
  return typeof process.exitCode === "number" ? process.exitCode : defaultCode;
}
