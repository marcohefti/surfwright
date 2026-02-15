import { rule as coreBoundariesRule } from "./core-boundaries.mjs";
import { rule as featureCoreImportsRule } from "./feature-core-imports.mjs";
import { rule as featureBoundariesRule } from "./feature-boundaries.mjs";
import { rule as maxFilesPerDirectoryRule } from "./max-files-per-directory.mjs";
import { rule as maxLocRule } from "./max-loc.mjs";
import { rule as stateBoundariesRule } from "./state-boundaries.mjs";
import { rule as cliCommanderOptionsRule } from "./cli-commander-options.mjs";

export const ruleRegistry = new Map([
  [featureBoundariesRule.name, featureBoundariesRule],
  [featureCoreImportsRule.name, featureCoreImportsRule],
  [coreBoundariesRule.name, coreBoundariesRule],
  [stateBoundariesRule.name, stateBoundariesRule],
  [cliCommanderOptionsRule.name, cliCommanderOptionsRule],
  [maxFilesPerDirectoryRule.name, maxFilesPerDirectoryRule],
  [maxLocRule.name, maxLocRule],
]);
