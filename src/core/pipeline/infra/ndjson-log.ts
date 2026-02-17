import { providers } from "../../providers/index.js";

export function resolveNdjsonLogPath(pathRaw: string): string {
  return providers().path.resolve(pathRaw);
}

export function initNdjsonLogFile(pathResolved: string): void {
  try {
    providers().fs.mkdirSync(providers().path.dirname(pathResolved), { recursive: true });
    providers().fs.writeFileSync(pathResolved, "", "utf8");
  } catch {
    // Best-effort: never fail pipeline execution due to logging I/O.
  }
}

export function appendNdjsonLogLine(pathResolved: string, event: Record<string, unknown>): void {
  try {
    providers().fs.appendFileSync(pathResolved, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // Best-effort: never fail pipeline execution due to logging I/O.
  }
}

