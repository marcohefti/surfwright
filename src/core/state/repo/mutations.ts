import { allocateSessionId, updateState } from "../infra/state-store.js";
import type { SurfwrightState } from "../../types.js";

export async function mutateState<T>(fn: (state: SurfwrightState) => T | Promise<T>): Promise<T> {
  return await updateState(fn);
}

export function allocateSessionIdForState(state: SurfwrightState, prefix: "s" | "a"): string {
  return allocateSessionId(state, prefix);
}
