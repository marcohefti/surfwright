#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const outPath = "artifacts/dual-package-smoke/report.json";
const result = spawnSync(
  process.execPath,
  ["scripts/release/smoke-contract.mjs", "--mode", "local", "--out", outPath],
  { cwd: process.cwd(), stdio: "inherit" },
);
process.exit(result.status ?? 1);
