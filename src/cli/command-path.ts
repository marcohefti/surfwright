import { usageCommandPath } from "../core/cli-contract.js";
import { allCommandManifest } from "../features/registry.js";
import { parseOptionTokenSpan } from "./options.js";

const GLOBAL_PATH_OPTIONS = ["--session", "--agent-id", "--workspace", "--output-shape"] as const;
const OUTPUT_FLAGS = new Set(["--json", "--no-json", "--pretty"]);

const manifestPaths = allCommandManifest
  .map((entry) => ({
    id: entry.id,
    path: usageCommandPath(entry.usage),
  }))
  .filter((entry) => entry.path.length > 0)
  .sort((left, right) => right.path.length - left.path.length);

const commandRootsWithSubcommands = new Set(
  manifestPaths.filter((entry) => entry.path.length > 1).map((entry) => entry.path[0]),
);

const maxManifestDepth = manifestPaths.reduce((max, entry) => Math.max(max, entry.path.length), 1);
const maxCommandCandidateTokens = maxManifestDepth + 2;

function collectCommandCandidateTokens(argv: string[]): string[] {
  const out: string[] = [];
  let index = 2;
  while (index < argv.length) {
    const token = argv[index];
    if (token === "--") {
      break;
    }

    let consumed = 0;
    for (const optionName of GLOBAL_PATH_OPTIONS) {
      consumed = parseOptionTokenSpan(argv, index, optionName);
      if (consumed > 0) {
        break;
      }
    }
    if (consumed > 0) {
      index += consumed;
      continue;
    }

    if (OUTPUT_FLAGS.has(token)) {
      index += 1;
      continue;
    }

    if (token.startsWith("-")) {
      if (out.length === 0) {
        index += 1;
        continue;
      }
      break;
    }

    out.push(token);
    index += 1;
    if (out.length >= maxCommandCandidateTokens) {
      break;
    }
  }
  return out;
}

function isPathPrefix(candidate: string[], manifestPath: string[]): boolean {
  if (candidate.length < manifestPath.length) {
    return false;
  }
  for (let index = 0; index < manifestPath.length; index += 1) {
    if (candidate[index] !== manifestPath[index]) {
      return false;
    }
  }
  return true;
}

export function resolveArgvCommandPath(argv: string[]): string[] {
  const candidate = collectCommandCandidateTokens(argv);
  if (candidate.length === 0) {
    return [];
  }

  for (const entry of manifestPaths) {
    if (isPathPrefix(candidate, entry.path)) {
      return entry.path;
    }
  }

  if (candidate.length >= 2 && commandRootsWithSubcommands.has(candidate[0])) {
    return candidate.slice(0, 2);
  }
  return candidate.slice(0, 1);
}

export function resolveArgvCommandId(argv: string[]): string | null {
  const commandPath = resolveArgvCommandPath(argv);
  if (commandPath.length === 0) {
    return null;
  }
  return commandPath.join(".");
}
