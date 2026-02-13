import { networkCommandContracts } from "../features/network/contracts.js";
import { runtimeCommandContracts } from "../features/runtime/contracts.js";
import { targetCommandContracts } from "../features/target-core/contracts.js";
import { errorContracts } from "./contracts/error-contracts.js";
import type { CliContractReport } from "./types.js";

const guarantees = [
  "deterministic output shape",
  "typed failures (code + message)",
  "json compact by default",
  "explicit handles for sessions and targets",
  "bounded runtime via explicit timeouts",
];

export function getCliContractReport(version: string): CliContractReport {
  return {
    ok: true,
    name: "surfwright",
    version,
    guarantees,
    commands: [...runtimeCommandContracts, ...targetCommandContracts, ...networkCommandContracts],
    errors: errorContracts,
  };
}
