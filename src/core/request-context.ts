import { AsyncLocalStorage } from "node:async_hooks";
import process from "node:process";

type OutputCapture = {
  stdout: CapturedStream;
  stderr: CapturedStream;
};

type RequestContext = {
  envOverrides: Record<string, string | undefined>;
  outputCapture: OutputCapture | null;
  exitCode: number;
};

type CapturedStream = {
  label: "stdout" | "stderr";
  chunks: string[];
  bytes: number;
  droppedBytes: number;
  truncated: boolean;
  maxBytes: number;
};

const DEFAULT_CAPTURE_MAX_BYTES = 512 * 1024;

const storage = new AsyncLocalStorage<RequestContext>();

const stdoutRef = process.stdout as unknown as { write: typeof process.stdout.write };
const stderrRef = process.stderr as unknown as { write: typeof process.stderr.write };
const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);
let outputInterceptorsInstalled = false;

function appendCapturedChunk(
  stream: CapturedStream,
  chunk: Uint8Array | string,
  encoding?: BufferEncoding | ((error?: Error | null) => void),
): void {
  const text =
    typeof chunk === "string"
      ? chunk
      : Buffer.from(chunk).toString(typeof encoding === "string" ? encoding : "utf8");
  if (text.length === 0) {
    return;
  }
  const encoded = Buffer.from(text, "utf8");
  const remaining = stream.maxBytes - stream.bytes;
  if (remaining <= 0) {
    stream.truncated = true;
    stream.droppedBytes += encoded.byteLength;
    return;
  }
  if (encoded.byteLength <= remaining) {
    stream.chunks.push(text);
    stream.bytes += encoded.byteLength;
    return;
  }

  const bounded = encoded.subarray(0, remaining).toString("utf8");
  if (bounded.length > 0) {
    stream.chunks.push(bounded);
  }
  stream.bytes += remaining;
  stream.truncated = true;
  stream.droppedBytes += encoded.byteLength - remaining;
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

function parseCaptureLimitBytes(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return DEFAULT_CAPTURE_MAX_BYTES;
  }
  const parsed = Math.floor(input);
  if (parsed <= 0) {
    return DEFAULT_CAPTURE_MAX_BYTES;
  }
  return parsed;
}

function createCapturedStream(label: "stdout" | "stderr", maxBytes: number): CapturedStream {
  return {
    label,
    chunks: [],
    bytes: 0,
    droppedBytes: 0,
    truncated: false,
    maxBytes,
  };
}

function createOutputCapture(maxBytes: number): OutputCapture {
  return {
    stdout: createCapturedStream("stdout", maxBytes),
    stderr: createCapturedStream("stderr", maxBytes),
  };
}

function renderCapturedStream(stream: CapturedStream): string {
  const joined = stream.chunks.join("");
  if (!stream.truncated) {
    return joined;
  }
  const suffix = `[daemon] ${stream.label} truncated at ${stream.maxBytes} bytes (${stream.droppedBytes} bytes omitted)\n`;
  if (joined.length === 0) {
    return suffix;
  }
  return joined.endsWith("\n") ? `${joined}${suffix}` : `${joined}\n${suffix}`;
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
  maxCapturedOutputBytes?: number;
  run: () => Promise<T>;
}): Promise<T> {
  installOutputInterceptors();
  const parent = storage.getStore();
  const captureLimit = parseCaptureLimitBytes(opts.maxCapturedOutputBytes);
  const outputCapture =
    opts.captureOutput === true
      ? createOutputCapture(captureLimit)
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
  maxCapturedOutputBytes?: number;
  run: () => Promise<T>;
}): Promise<{ result: T; stdout: string; stderr: string; exitCode: number }> {
  installOutputInterceptors();
  const capture = createOutputCapture(parseCaptureLimitBytes(opts.maxCapturedOutputBytes));
  const context: RequestContext = {
    envOverrides: mergedEnvOverrides(opts.envOverrides ?? {}),
    outputCapture: capture,
    exitCode: typeof opts.initialExitCode === "number" ? opts.initialExitCode : 0,
  };
  return await storage.run(context, async () => {
    const result = await opts.run();
    return {
      result,
      stdout: renderCapturedStream(capture.stdout),
      stderr: renderCapturedStream(capture.stderr),
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
