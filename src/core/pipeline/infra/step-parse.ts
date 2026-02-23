import { CliError } from "../../errors.js";
import { parseOptionalInteger, type PipelineStepInput } from "../../pipeline-support/index.js";

export function requireStepTargetId(stepTargetId: string | undefined, stepIndex: number): string {
  if (!stepTargetId) {
    throw new CliError("E_QUERY_INVALID", `steps[${stepIndex}] requires targetId (or previous step must set one)`);
  }
  return stepTargetId;
}

export function parseClickIndexFromStep(step: PipelineStepInput, stepIndex: number): number | undefined {
  const index = parseOptionalInteger(step.index, `steps[${stepIndex}].index`);
  const nth = parseOptionalInteger(step.nth, `steps[${stepIndex}].nth`);
  if (typeof index === "number" && index < 0) {
    throw new CliError("E_QUERY_INVALID", `steps[${stepIndex}].index must be a non-negative integer`);
  }
  if (typeof nth === "number" && nth < 1) {
    throw new CliError("E_QUERY_INVALID", `steps[${stepIndex}].nth must be a positive integer`);
  }
  if (typeof index === "number" && typeof nth === "number") {
    throw new CliError("E_QUERY_INVALID", `steps[${stepIndex}] cannot set both index and nth`);
  }
  return typeof nth === "number" ? nth - 1 : index;
}
