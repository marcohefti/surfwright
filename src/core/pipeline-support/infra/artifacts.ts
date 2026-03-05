import { nowIso, stateRootDir } from "../../state/index.js";
import type { LoadedPlan, PipelineResultMap, PipelineStepInput } from "./plan.js";
import { providers } from "../../providers/index.js";

const RUN_ARTIFACT_LABEL_MAX = 64;

function resolveRunArtifactPath(label: string | undefined): string {
  const { crypto, fs, path } = providers();
  const runsDir = path.join(stateRootDir(), "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  const safeLabel = (label ?? "run")
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "")
    .slice(0, RUN_ARTIFACT_LABEL_MAX);
  const iso = new Date().toISOString();
  const dotIndex = iso.indexOf(".");
  const stamp = (dotIndex === -1 ? iso : `${iso.slice(0, dotIndex)}Z`).split(":").join("-");
  const unique = crypto.randomBytes(3).toString("hex");
  return path.join(runsDir, `${stamp}-${safeLabel || "run"}-${unique}.json`);
}

export function writeRunArtifact(opts: {
  outPath?: string;
  label?: string;
  source: string;
  replay: LoadedPlan["replay"];
  plan: { steps: PipelineStepInput[]; result?: PipelineResultMap };
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
