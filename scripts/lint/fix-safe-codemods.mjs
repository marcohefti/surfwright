#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const TARGET_DIRS = ["src", "scripts", "test"];
const TARGET_EXTENSIONS = new Set([".ts", ".mjs"]);

function listFilesByWalking(rootDir) {
  const out = [];
  const stack = [...TARGET_DIRS.map((entry) => path.join(rootDir, entry))];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current !== "string") {
      continue;
    }
    if (fs.existsSync(current) === false) {
      continue;
    }
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        stack.push(path.join(current, entry.name));
      }
      continue;
    }
    if (stat.isFile() && TARGET_EXTENSIONS.has(path.extname(current))) {
      out.push(path.relative(rootDir, current).replaceAll("\\", "/"));
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function applyTransforms(input) {
  let output = input;

  output = output.replaceAll("Object.hasOwn(", "Object.hasOwn(");

  output = output.replaceAll(
    /\btypeof\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\?\.[A-Za-z_$][\w$]*|\[[^\]\n]+\])*)\s*===\s*["']undefined["']/g,
    "$1 === undefined",
  );
  output = output.replaceAll(
    /\btypeof\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\?\.[A-Za-z_$][\w$]*|\[[^\]\n]+\])*)\s*!==\s*["']undefined["']/g,
    "$1 !== undefined",
  );

  output = output.replaceAll(/\.replace\((\/(?:\\.|[^/\n])+\/[a-z]*g[a-z]*),/g, ".replaceAll($1,");

  return output;
}

const rootDir = process.cwd();
const files = listFilesByWalking(rootDir);
let changedFiles = 0;

for (const filePath of files) {
  const absPath = path.join(rootDir, filePath);
  const before = fs.readFileSync(absPath, "utf8");
  const after = applyTransforms(before);
  if (before === after) {
    continue;
  }
  fs.writeFileSync(absPath, after);
  changedFiles += 1;
}

process.stdout.write(`lint-fix-safe-codemods: updated ${changedFiles} file(s)\n`);
