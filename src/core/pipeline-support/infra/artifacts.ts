import { nowIso, stateRootDir } from "../../state/index.js";
import type { LoadedPlan, PipelineStepInput } from "./plan.js";
import { providers } from "../../providers/index.js";

const RUN_ARTIFACT_LABEL_MAX = 64;

function resolveRunArtifactPath(label: string | undefined): string {
  const { fs, path } = providers();
  const runsDir = path.join(stateRootDir(), "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const safeLabel = (label ?? "run")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, RUN_ARTIFACT_LABEL_MAX);
  const stamp = new Date().toISOString().replace(/[:]/g, "-").replace(/\..+$/, "Z");
  const unique = Math.random().toString(16).slice(2, 8);
  return path.join(runsDir, `${stamp}-${safeLabel || "run"}-${unique}.json`);
}

export function writeRunArtifact(opts: {
  outPath?: string;
  label?: string;
  source: string;
  replay: LoadedPlan["replay"];
  plan: { steps: PipelineStepInput[] };
  report: Record<string, unknown>;
}) {
  const { fs, path } = providers();
  const outPath = opts.outPath && opts.outPath.trim().length > 0 ? opts.outPath : resolveRunArtifactPath(opts.label);
  const payload = {
    kind: "run-artifact",
    createdAt: nowIso(),
    label: opts.label ?? null,
    source: opts.source,
    replay: opts.replay,
    plan: opts.plan,
    report: opts.report,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return {
    path: outPath,
    createdAt: payload.createdAt,
    label: payload.label,
  };
}
