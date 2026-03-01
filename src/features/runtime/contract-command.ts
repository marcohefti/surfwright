import { resolveContractCommandId } from "../../core/cli-contract.js";
import { queryInvalid } from "../../core/target/public.js";
import type { CliCommandContract } from "../../core/types.js";

export function resolveContractCommandOrThrow(rawCommandLookup: string, commands: CliCommandContract[]): string {
  const resolved = resolveContractCommandId(rawCommandLookup, commands);
  if (resolved.commandId) {
    return resolved.commandId;
  }

  const lookupSeed = rawCommandLookup.split(/[.\s]/g).filter((token) => token.length > 0)[0] ?? rawCommandLookup;
  const topSuggestion = resolved.suggestions[0] ?? null;
  const nextCommand = topSuggestion
    ? `surfwright contract --command ${topSuggestion}`
    : "surfwright contract --full";
  throw queryInvalid(`unknown command id: ${rawCommandLookup}`, {
    hints: [
      topSuggestion ? `Did you mean: ${topSuggestion}` : null,
      "Use `surfwright contract --command <id>` or `surfwright contract --commands <id1,id2>`",
      "Use `surfwright contract --full` to list all commandIds/errorCodes",
    ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
    hintContext: {
      requestedCommandId: rawCommandLookup,
      suggestionCount: resolved.suggestions.length,
      didYouMean: topSuggestion,
    },
    recovery: {
      strategy: "discover-command-id",
      nextCommand,
      requiredFields: topSuggestion ? [] : ["commandIds"],
      context: {
        requestedCommandId: rawCommandLookup,
        lookupSeed,
        didYouMean: topSuggestion,
      },
    },
  });
}

export function resolveContractCommandIdsOrThrow(rawCommandList: string, commands: CliCommandContract[]): string[] {
  const parts = String(rawCommandList || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (parts.length === 0) {
    throw queryInvalid("commands must include at least one command id (comma-separated)");
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const commandId = resolveContractCommandOrThrow(part, commands);
    if (seen.has(commandId)) {
      continue;
    }
    seen.add(commandId);
    out.push(commandId);
  }
  return out;
}
