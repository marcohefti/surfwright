import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { rule } from "../../policy/rules/cli-commander-options.mjs";

function matchesAny(file, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return false;
  }
  return patterns.some((pattern) => path.posix.matchesGlob(file, pattern));
}

function filterFiles(files, include, exclude) {
  const includePatterns = Array.isArray(include) && include.length > 0 ? include : ["**/*"];
  const excludePatterns = Array.isArray(exclude) ? exclude : [];

  return files.filter((file) => {
    if (!matchesAny(file, includePatterns)) {
      return false;
    }
    if (matchesAny(file, excludePatterns)) {
      return false;
    }
    return true;
  });
}

test("policy: rejects Commander --no-* default false and options.noX reads", async () => {
  const files = ["src/features/demo/commands/demo.ts"];
  const content = [
    'ctx.target.option("--no-persist", "desc", false);',
    "const persistState = !Boolean(options.noPersist);",
  ].join("\n");

  const violations = await rule.check({
    files,
    options: {
      include: ["src/features/**/commands/**/*.ts"],
      exclude: [],
    },
    helpers: {
      filterFiles,
      readFile: () => content,
    },
  });

  assert.ok(violations.some((v) => v.message.includes('.option("--no-*", ..., false)')));
  assert.ok(violations.some((v) => v.message.includes("options.noX")));
});

test("policy: allows Commander --no-* without explicit default and reads options.persist", async () => {
  const files = ["src/features/demo/commands/demo.ts"];
  const content = [
    'ctx.target.option("--no-persist", "desc");',
    "const persistState = options.persist !== false;",
  ].join("\n");

  const violations = await rule.check({
    files,
    options: {
      include: ["src/features/**/commands/**/*.ts"],
      exclude: [],
    },
    helpers: {
      filterFiles,
      readFile: () => content,
    },
  });

  assert.deepEqual(violations, []);
});
