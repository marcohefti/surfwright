import { CliError } from "../../../errors.js";

// Opaque-ish handle intended for short-lived, target-scoped reuse (e.g. click by handle).
// Format is stable and easy to validate without depending on JSON/base64 tooling.
const HANDLE_PREFIX = "sw:el:v1:";

export function encodeBackendNodeHandle(backendNodeId: number): string {
  if (!Number.isFinite(backendNodeId) || !Number.isInteger(backendNodeId) || backendNodeId <= 0) {
    throw new CliError("E_INTERNAL", "Invalid backendNodeId for handle encoding");
  }
  return `${HANDLE_PREFIX}${backendNodeId}`;
}

export function parseBackendNodeHandle(handle: string): number {
  const raw = typeof handle === "string" ? handle.trim() : "";
  if (!raw.startsWith(HANDLE_PREFIX)) {
    throw new CliError("E_QUERY_INVALID", "Invalid element handle (unexpected prefix)");
  }
  const suffix = raw.slice(HANDLE_PREFIX.length);
  if (!/^[0-9]+$/.test(suffix)) {
    throw new CliError("E_QUERY_INVALID", "Invalid element handle (invalid backend node id)");
  }
  const backendNodeId = Number.parseInt(suffix, 10);
  if (!Number.isFinite(backendNodeId) || backendNodeId <= 0) {
    throw new CliError("E_QUERY_INVALID", "Invalid element handle (invalid backend node id)");
  }
  return backendNodeId;
}
