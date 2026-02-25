import { resolveContractCommandId } from "../../core/cli-contract.js";
import { queryInvalid } from "../../core/target/public.js";
import type { CliCommandContract } from "../../core/types.js";

export function resolveContractCommandOrThrow(rawCommandLookup: string, commands: CliCommandContract[]): string {
  const resolved = resolveContractCommandId(rawCommandLookup, commands);
  if (resolved.commandId) {
    return resolved.commandId;
  }

  const lookupSeed = rawCommandLookup.split(/[.\s]/g).filter((token) => token.length > 0)[0] ?? rawCommandLookup;
  throw queryInvalid(`unknown command id: ${rawCommandLookup}`, {
    hints: [
      resolved.suggestions.length > 0
        ? `Closest command ids: ${resolved.suggestions.slice(0, 5).join(", ")}`
        : null,
      `Run \`surfwright contract --search ${lookupSeed}\` to discover command ids`,
      "Use `surfwright contract --command <id>` with a dot id (example: target.snapshot)",
    ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0),
    hintContext: {
      requestedCommandId: rawCommandLookup,
      suggestionCount: resolved.suggestions.length,
    },
    recovery: {
      strategy: "discover-command-id",
      nextCommand: `surfwright contract --search ${lookupSeed}`,
      requiredFields: ["commandIds"],
      context: {
        requestedCommandId: rawCommandLookup,
      },
    },
  });
}
