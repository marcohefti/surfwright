import crypto from "node:crypto";
import { allCommandManifest } from "../features/registry.js";
import { errorContracts } from "./contracts/error-contracts.js";
import type { CliContractReport } from "./types.js";

export const CONTRACT_SCHEMA_VERSION = 1;

const guarantees = [
  "deterministic output shape",
  "typed failures (code + message)",
  "json compact by default",
  "explicit handles for sessions and targets",
  "bounded runtime via explicit timeouts",
];

const commandGuidance: NonNullable<CliContractReport["guidance"]> = [
  {
    id: "open",
    signature: "open(url) -> { sessionId, targetId, finalUrl, title }",
    examples: ["surfwright open https://example.com --reuse active --wait-until domcontentloaded"],
    proofSchema: null,
  },
  {
    id: "target.snapshot",
    signature: "snapshot(targetId, mode?) -> { h1?, headings/buttons/links, *Count }",
    examples: ["surfwright target snapshot <targetId> --mode orient --max-headings 40 --max-links 40"],
    proofSchema: null,
  },
  {
    id: "target.click",
    signature: "click(targetId, query) -> { clicked, handoff, wait?, proof? }",
    examples: ["surfwright target click <targetId> --text \"Pricing\" --visible-only --proof"],
    proofSchema: {
      action: "click",
      urlChanged: "boolean",
      targetChanged: "boolean",
      waitSatisfied: "boolean",
      finalUrl: "string",
      openedTargetId: "string|null",
      countAfter: "number|null",
    },
  },
  {
    id: "target.fill",
    signature: "fill(targetId, query, value) -> { valueLength, wait?, proof? }",
    examples: ["surfwright target fill <targetId> --selector '#email' --value 'agent@example.com' --proof"],
    proofSchema: {
      action: "fill",
      urlChanged: "boolean",
      waitSatisfied: "boolean",
      finalUrl: "string",
      queryMode: "text|selector",
      countAfter: "number|null",
    },
  },
  {
    id: "target.keypress",
    signature: "keypress(targetId, key, query?) -> { resultText, wait?, proof? }",
    examples: ["surfwright target keypress <targetId> --key Enter --selector '#search' --proof"],
    proofSchema: {
      action: "keypress",
      urlChanged: "boolean",
      waitSatisfied: "boolean",
      finalUrl: "string",
      queryMode: "text|selector|none",
      countAfter: "number|null",
    },
  },
  {
    id: "target.extract",
    signature: "extract(targetId, kind) -> { items[], count, truncated }",
    examples: [
      "surfwright target extract <targetId> --kind docs-commands --selector main --limit 10",
      "surfwright target extract <targetId> --kind headings --selector main --limit 20",
    ],
    proofSchema: null,
  },
  {
    id: "target.wait",
    signature: "wait(targetId, waitMode) -> { wait: { mode, elapsedMs, satisfied } }",
    examples: ["surfwright target wait <targetId> --for-selector '.loaded' --wait-timeout-ms 5000"],
    proofSchema: null,
  },
];

function contractFingerprintInput(): string {
  const normalized = {
    contractSchemaVersion: CONTRACT_SCHEMA_VERSION,
    guarantees,
    commands: [...allCommandManifest]
      .map((entry) => ({ id: entry.id, usage: entry.usage, summary: entry.summary }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    errors: [...errorContracts]
      .map((entry) => ({ code: entry.code, retryable: entry.retryable }))
      .sort((a, b) => a.code.localeCompare(b.code)),
  };
  return JSON.stringify(normalized);
}

export function computeContractFingerprint(): string {
  const digest = crypto.createHash("sha256").update(contractFingerprintInput()).digest("hex");
  return `sha256:${digest}`;
}

export function getCliContractReport(version: string): CliContractReport {
  return {
    ok: true,
    name: "surfwright",
    version,
    contractSchemaVersion: CONTRACT_SCHEMA_VERSION,
    contractFingerprint: computeContractFingerprint(),
    guarantees,
    commands: allCommandManifest,
    errors: errorContracts,
    guidance: commandGuidance,
  };
}
