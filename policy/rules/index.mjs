import { rule as maxLocRule } from "./max-loc.mjs";

export const ruleRegistry = new Map([
  [maxLocRule.name, maxLocRule],
]);
