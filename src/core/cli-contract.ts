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
    signature: "open(url) -> { sessionId, targetId, finalUrl, title, blockType }",
    examples: ["surfwright open https://example.com --reuse active --wait-until domcontentloaded"],
    proofSchema: {
      version: 1,
      action: "open",
      urlBefore: "string",
      urlAfter: "string",
      urlChanged: "boolean",
      targetBefore: "string",
      targetAfter: "string",
      wait: "{ requested, mode, timeoutMs, elapsedMs, satisfied }",
      assertions: "{ total, failed, checks[] } | null",
      details: "{ waitUntil, reuseMode, reusedTarget, status, wasRedirected, blockType }",
    },
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
    examples: [
      "surfwright --output-shape compact target click <targetId> --text \"Delete\" --visible-only --repeat 3",
      "surfwright target click <targetId> --text \"Pricing\" --visible-only --proof",
      "surfwright target click <targetId> --selector '#agree' --proof --proof-check-state",
      "surfwright target click <targetId> --selector '.todo-item' --nth 2 --count-after",
    ],
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
    id: "target.eval",
    signature: "eval(targetId, expr|script) -> { result, context, console? }",
    examples: [
      "surfwright target extract <targetId> --kind docs-commands --selector main --limit 10",
      "surfwright target style <targetId> --selector '.btn.btn-primary' --kind button-primary",
      "surfwright target read <targetId> --selector main --chunk-size 1200 --chunk 1",
      "surfwright --output-shape compact target eval <targetId> --expr 'document.title'",
      "surfwright target eval <targetId> --expr-b64 ZG9jdW1lbnQudGl0bGU=",
    ],
    proofSchema: null,
  },
  {
    id: "target.fill",
    signature: "fill(targetId, query, value) -> { valueLength, eventMode?, eventsDispatched?, wait?, proof? }",
    examples: [
      "surfwright target fill <targetId> --selector '#email' --value 'agent@example.com' --proof",
      "surfwright target fill <targetId> --selector '#search' --value 'surfwright' --event-mode realistic",
    ],
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
    id: "target.select-option",
    signature: "select-option(targetId, selector, value|label|index) -> { selectedValue, selectedText, selectedIndex }",
    examples: [
      "surfwright target select-option <targetId> --selector '#role' --value editor --proof",
      "surfwright target select-option <targetId> --selector '#country' --label Switzerland",
    ],
    proofSchema: {
      action: "select-option",
      selectedBy: "value|label|index",
      selectedValue: "string|null",
      selectedText: "string|null",
      selectedIndex: "number|null",
      finalUrl: "string",
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
    signature: "extract(targetId, kind) -> { items[], count, truncated, schema?, records? }",
    examples: [
      "surfwright target extract <targetId> --kind docs-commands --selector main --limit 10",
      "surfwright target extract <targetId> --kind command-lines --selector main --limit 20",
      "surfwright target extract <targetId> --kind headings --selector main --limit 20",
      "surfwright target extract <targetId> --kind table-rows --schema-json '{\"company\":\"record.Company\"}' --dedupe-by company",
    ],
    proofSchema: null,
  },
  {
    id: "target.wait",
    signature: "wait(targetId, waitMode) -> { wait: { mode, elapsedMs, satisfied } }",
    examples: ["surfwright target wait <targetId> --for-selector '.loaded' --wait-timeout-ms 5000"],
    proofSchema: null,
  },
  {
    id: "target.scroll-plan",
    signature: "scroll-plan(targetId, steps(px|ratio)?, countSelector?) -> { steps[], countSummary?, maxScroll }",
    examples: [
      "surfwright target scroll-plan <targetId> --steps 0,600,1200,1800 --settle-ms 300",
      "surfwright target scroll-plan <targetId> --steps 0,1,1 --count-selector '.chunk' --settle-ms 500",
      "surfwright target scroll-plan <targetId> --steps 0,800,1600 --count-selector '.item' --count-visible-only",
    ],
    proofSchema: null,
  },
  {
    id: "run",
    signature: "run(plan) -> { steps[], stepsById, stepResults[] }",
    examples: [
      "surfwright run --plan-json '{\"steps\":[{\"id\":\"open\",\"url\":\"https://example.com\"},{\"id\":\"snapshot\"}]}'",
      "surfwright run --plan-json '{\"steps\":[{\"id\":\"open\",\"url\":\"https://example.com\"},{\"id\":\"count\",\"selector\":\"a\",\"as\":\"links\"}]}'",
      "surfwright run --doctor --plan-json '{\"steps\":[{\"id\":\"open\",\"url\":\"https://example.com\"},{\"id\":\"eval\",\"expression\":\"return document.title\"}]}'",
      "Supported step ids: open,list,snapshot,find,count,scroll-plan,click,click-read,fill,upload,read,eval,wait,extract",
    ],
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
