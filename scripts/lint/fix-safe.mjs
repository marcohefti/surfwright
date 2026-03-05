#!/usr/bin/env node
import { spawnSync } from "node:child_process";

function runStep(label, command, args) {
  process.stdout.write(`lint-fix-safe: ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  if (result.status === 0) {
    return;
  }
  const exitCode = typeof result.status === "number" ? result.status : 1;
  process.exit(exitCode);
}

runStep("oxlint --fix", "pnpm", ["exec", "oxlint", "--fix", "-c", ".oxlintrc.json", "src", "scripts", "test"]);
runStep("safe codemods", "node", ["scripts/lint/fix-safe-codemods.mjs"]);
runStep("lint", "pnpm", ["-s", "lint"]);
runStep("typecheck", "pnpm", ["-s", "typecheck"]);

process.stdout.write("lint-fix-safe: done\n");
