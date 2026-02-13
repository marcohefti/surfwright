import path from "node:path";
import process from "node:process";
import { latestRunDir, readJson } from "./io.mjs";

export function reportHarness(opts) {
  const candidate = opts.runPath
    ? path.resolve(opts.runPath)
    : latestRunDir(path.resolve(opts.outRoot));
  const reportPath = candidate.endsWith(".json") ? candidate : path.join(candidate, "run.json");
  const report = readJson(reportPath);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  const lines = [
    `name=${report.name ?? "ZeroContext Lab"}`,
    `runId=${report.runId ?? "unknown"}`,
    `runDir=${report.runDir ?? path.dirname(reportPath)}`,
    `suite=${report.suite?.name ?? "unknown"}`,
    `attempts=${report.summary?.total ?? 0}`,
    `passed=${report.summary?.passed ?? 0}`,
    `failed=${report.summary?.failed ?? 0}`,
    `passRate=${report.summary?.passRate ?? 0}%`,
    `avgDurationMs=${report.summary?.avgDurationMs ?? 0}`,
    `avgCliCommands=${report.summary?.avgCliCommands ?? 0}`,
    `avgCliFailures=${report.summary?.avgCliFailures ?? 0}`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);

  const topFriction = Array.isArray(report.summary?.topFriction) ? report.summary.topFriction : [];
  if (topFriction.length > 0) {
    process.stdout.write("topFriction:\n");
    for (const item of topFriction) {
      process.stdout.write(`- count=${item.count} text=${item.text}\n`);
    }
  }
}
