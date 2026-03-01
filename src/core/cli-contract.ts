import crypto from "node:crypto";
import { allCommandManifest } from "../features/registry.js";
import { errorContracts } from "./contracts/error-contracts.js";
import type { CliCommandContract, CliContractReport } from "./types.js";

export const CONTRACT_SCHEMA_VERSION = 1;

const guarantees = [
  "deterministic output shape",
  "typed failures (code + message)",
  "json compact by default",
  "explicit handles for sessions and targets",
  "bounded runtime via explicit timeouts",
];

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}

function normalizeLookupToken(input: string): string {
  return input.trim().replace(/\s+/g, " ");
}

export function commandPathToId(commandPath: string[]): string | null {
  if (!Array.isArray(commandPath) || commandPath.length === 0) {
    return null;
  }
  return commandPath.join(".");
}

export function findCommandContractByPath(commandPath: string[]): CliCommandContract | null {
  const id = commandPathToId(commandPath);
  if (typeof id !== "string") {
    return null;
  }
  return allCommandManifest.find((entry) => entry.id === id) ?? null;
}

export function usageCommandPath(usage: string): string[] {
  const raw = String(usage ?? "").trim();
  if (raw.length === 0) {
    return [];
  }
  const tokens = raw.split(/\s+/g);
  const start = tokens[0] === "surfwright" ? 1 : 0;
  const out: string[] = [];
  for (let idx = start; idx < tokens.length; idx += 1) {
    const token = tokens[idx];
    if (token.startsWith("[") || token.startsWith("<") || token.startsWith("--")) {
      break;
    }
    out.push(token);
  }
  return out;
}

function commandUsagePathString(command: CliCommandContract): string {
  return usageCommandPath(command.usage).join(" ");
}

export function resolveContractCommandId(
  commandIdInput: string,
  commands: CliCommandContract[],
): { commandId: string | null; suggestions: string[] } {
  const requestedRaw = normalizeLookupToken(commandIdInput);
  if (requestedRaw.length === 0) {
    return { commandId: null, suggestions: [] };
  }

  const requested = requestedRaw.toLowerCase();
  const byId = new Map(commands.map((entry) => [entry.id, entry]));
  if (byId.has(requestedRaw)) {
    return { commandId: requestedRaw, suggestions: [] };
  }

  const byUsagePath = new Map(commands.map((entry) => [commandUsagePathString(entry), entry.id]));
  const usageMatch = byUsagePath.get(requestedRaw);
  if (typeof usageMatch === "string") {
    return { commandId: usageMatch, suggestions: [] };
  }

  // Accept dotted alias conversion when operators pass "target snapshot" style ids.
  const dottedLookup = requestedRaw.split(" ").filter((token) => token.length > 0).join(".");
  if (byId.has(dottedLookup)) {
    return { commandId: dottedLookup, suggestions: [] };
  }

  const terminalSegmentMatches = commands.filter((entry) => entry.id.split(".").at(-1)?.toLowerCase() === requested);
  if (terminalSegmentMatches.length === 1) {
    return { commandId: terminalSegmentMatches[0].id, suggestions: [] };
  }

  const byPrefix = commands.filter((entry) => entry.id.toLowerCase().startsWith(`${requested}.`));
  if (byPrefix.length === 1) {
    return { commandId: byPrefix[0].id, suggestions: [] };
  }

  const rankedSuggestions = unique(
    [
      ...commands
        .filter((entry) => entry.id.toLowerCase().startsWith(requested))
        .map((entry) => entry.id),
      ...commands
        .filter((entry) => commandUsagePathString(entry).toLowerCase().startsWith(requested))
        .map((entry) => entry.id),
      ...commands
        .filter((entry) => entry.id.toLowerCase().includes(requested))
        .map((entry) => entry.id),
      ...commands
        .filter((entry) => commandUsagePathString(entry).toLowerCase().includes(requested))
        .map((entry) => entry.id),
    ].slice(0, 8),
  );

  return { commandId: null, suggestions: rankedSuggestions };
}

export function usageValidFlags(usage: string): string[] {
  const text = String(usage ?? "");
  const matches = text.match(/--[a-z][a-z0-9-]*/gi) ?? [];
  return unique(matches);
}

export function usageRequiredPositionals(usage: string): string[] {
  const text = String(usage ?? "");
  const beforeOptional = text.split("[")[0] ?? text;
  const positionals: string[] = [];
  const regex = /<([^>\s]+)>/g;
  for (const match of beforeOptional.matchAll(regex)) {
    const name = typeof match[1] === "string" ? match[1].trim() : "";
    if (name.length > 0) {
      positionals.push(name);
    }
  }
  return unique(positionals);
}

export function buildCommandSignature(opts: {
  command: CliCommandContract;
  examples?: string[];
}): {
  id: string;
  commandPath: string;
  argvPath: string[];
  dotAlias: string | null;
  usage: string;
  canonicalInvocation: string;
  summary: string;
  flags: string[];
  positionals: string[];
  examples: string[];
} {
  const usage = String(opts.command.usage ?? "").trim();
  const argvPath = usageCommandPath(usage);
  return {
    id: opts.command.id,
    commandPath: argvPath.join(" "),
    argvPath,
    dotAlias: opts.command.id.includes(".") ? opts.command.id : null,
    usage,
    canonicalInvocation: usage,
    summary: opts.command.summary,
    flags: usageValidFlags(usage),
    positionals: usageRequiredPositionals(usage),
    examples: Array.isArray(opts.examples) ? opts.examples.slice(0, 5) : [],
  };
}

const commandGuidance: NonNullable<CliContractReport["guidance"]> = [
  {
    id: "contract",
    signature: "contract(compact|command|commands) -> { command ids, error codes }",
    examples: [
      "surfwright contract",
      "surfwright contract --command target.download",
      "surfwright contract --commands open,target.click,target.read",
    ],
    proofSchema: null,
  },
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
    id: "target.attr",
    signature: "attr(targetId, query, name) -> { value, attributePresent, pickedIndex }",
    examples: [
      "surfwright target attr <targetId> --selector 'img.avatar' --name src",
      "surfwright target attr <targetId> --text 'Docs' --name href --visible-only",
      "surfwright target attr <targetId> --selector '.menu a' --name href --nth 2",
    ],
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
      "surfwright target attr <targetId> --selector 'img' --name src --nth 1",
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
    signature: "scroll-plan(targetId, mode?, steps(px|ratio)?, countSelector?) -> { mode, steps[], countSummary?, maxScroll }",
    examples: [
      "surfwright target scroll-plan <targetId> --steps 0,600,1200,1800 --settle-ms 300",
      "surfwright target scroll-plan <targetId> --steps 0,1,1 --count-selector '.chunk' --settle-ms 500",
      "surfwright target scroll-plan <targetId> --mode relative --steps 800,800,800 --count-selector '.item' --settle-ms 350",
      "surfwright target scroll-plan <targetId> --steps 0,800,1600 --count-selector '.item' --count-visible-only",
    ],
    proofSchema: null,
  },
  {
    id: "run",
    signature: "run(plan) -> { steps[], result? }",
    examples: [
      "surfwright run --plan-json '{\"steps\":[{\"id\":\"open\",\"url\":\"https://example.com\"},{\"id\":\"snapshot\"}]}'",
      "surfwright run --plan-json '{\"steps\":[{\"id\":\"open\",\"url\":\"https://example.com\"},{\"id\":\"count\",\"selector\":\"a\",\"as\":\"links\"}]}'",
      "surfwright run --plan-json '{\"steps\":[{\"id\":\"open\",\"url\":\"https://example.com\"},{\"id\":\"repeat-until\",\"step\":{\"id\":\"count\",\"selector\":\".row\"},\"untilPath\":\"count\",\"untilGte\":3}]}'",
      "surfwright run --plan-json '{\"steps\":[{\"id\":\"open\",\"url\":\"https://example.com\"},{\"id\":\"repeat-until\",\"step\":{\"id\":\"scroll-plan\",\"scrollMode\":\"relative\",\"steps\":\"900,900,900\",\"countSelector\":\".chunk\"},\"untilPath\":\"countSummary.delta\",\"untilDeltaGte\":1,\"maxAttempts\":4}]}'",
      "surfwright run --plan-json '{\"steps\":[{\"id\":\"open\",\"url\":\"https://example.com\"},{\"id\":\"count\",\"selector\":\"a\",\"as\":\"links\"}],\"result\":{\"linkCount\":\"steps.links.count\"}}'",
      "surfwright run --plan-json '{\"steps\":[{\"id\":\"open\",\"url\":\"https://example.com\"},{\"id\":\"count\",\"selector\":\".chunk\",\"as\":\"chunks\"}],\"result\":{\"chunksLoaded\":\"steps.chunks.count\"},\"require\":{\"gte\":{\"result.chunksLoaded\":2}}}'",
      "surfwright run --doctor --plan-json '{\"steps\":[{\"id\":\"open\",\"url\":\"https://example.com\"},{\"id\":\"eval\",\"expression\":\"return document.title\"}]}'",
      "Supported step ids: open,list,snapshot,find,count,scroll-plan,repeat-until,click,click-read,fill,upload,read,eval,wait,extract",
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
