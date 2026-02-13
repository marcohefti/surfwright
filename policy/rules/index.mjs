import { rule as featureCoreImportsRule } from "./feature-core-imports.mjs";
import { rule as featureBoundariesRule } from "./feature-boundaries.mjs";
import { rule as maxLocRule } from "./max-loc.mjs";
import { rule as stateBoundariesRule } from "./state-boundaries.mjs";

export const ruleRegistry = new Map([
  [featureBoundariesRule.name, featureBoundariesRule],
  [featureCoreImportsRule.name, featureCoreImportsRule],
  [stateBoundariesRule.name, stateBoundariesRule],
  [maxLocRule.name, maxLocRule],
]);
