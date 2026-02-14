#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const outPath = "artifacts/dual-package-smoke/report.json";
const result = spawnSync(
  "node",
  ["scripts/release/smoke-contract.mjs", "--mode", "local", "--out", outPath],
  { cwd: process.cwd(), stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
