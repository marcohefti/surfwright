import { rule as featureBoundariesRule } from "./feature-boundaries.mjs";
import { rule as maxLocRule } from "./max-loc.mjs";

export const ruleRegistry = new Map([
  [featureBoundariesRule.name, featureBoundariesRule],
  [maxLocRule.name, maxLocRule],
]);
