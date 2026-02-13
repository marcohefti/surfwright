#!/usr/bin/env node
import process from "node:process";
import { parseArgs, usage } from "./zerocontext-lab/options.mjs";
import { runHarness } from "./zerocontext-lab/run.mjs";
import { reportHarness } from "./zerocontext-lab/report.mjs";

function fail(message, code = 2) {
  process.stderr.write(`zerocontext-lab: ERROR ${message}\n`);
  process.exit(code);
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "help") {
    process.stdout.write(`${usage()}\n`);
  } else if (args.mode === "run") {
    runHarness(args);
  } else if (args.mode === "report") {
    reportHarness(args);
  } else {
    fail("invalid mode");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown failure";
  fail(message, 2);
}
