import fs from "node:fs";
import path from "node:path";

const budgetPath = path.join(process.cwd(), "test", "fixtures", "perf", "budgets.json");
const ingressRoot = path.join(process.cwd(), "test", "fixtures", "ingress");

function listJsonFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) {
        out.push(full);
      }
    }
  }
  out.sort();
  return out;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

const budget = readJson(budgetPath);
if (budget.schemaVersion !== 1 || typeof budget.cases !== "object" || budget.cases === null) {
  throw new Error("Invalid perf budget file format");
}

const fixtures = listJsonFiles(ingressRoot).map((filePath) => ({
  filePath,
  payload: readJson(filePath),
}));

let checked = 0;
for (const [caseId, limits] of Object.entries(budget.cases)) {
  const fixture = fixtures.find((entry) => entry.payload?.caseId === caseId);
  if (!fixture) {
    fail(`perf-budget: missing ingress fixture for caseId=${caseId}`);
    continue;
  }

  const timing = fixture.payload?.observed?.timingMs;
  if (!timing || typeof timing !== "object") {
    fail(`perf-budget: fixture ${caseId} has no observed.timingMs`);
    continue;
  }

  if (typeof limits !== "object" || limits === null) {
    fail(`perf-budget: invalid limits for caseId=${caseId}`);
    continue;
  }

  if (typeof limits.maxTotalMs === "number" && typeof timing.total === "number" && timing.total > limits.maxTotalMs) {
    fail(`perf-budget: ${caseId} total ${timing.total}ms > ${limits.maxTotalMs}ms`);
  }

  if (typeof limits.maxActionMs === "number" && typeof timing.action === "number" && timing.action > limits.maxActionMs) {
    fail(`perf-budget: ${caseId} action ${timing.action}ms > ${limits.maxActionMs}ms`);
  }

  checked += 1;
}

if (process.exitCode === 1) {
  process.exit(1);
}

process.stdout.write(`perf-budget: PASS (${checked} case budgets)\n`);
