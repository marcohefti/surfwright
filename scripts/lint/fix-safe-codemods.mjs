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

  output = rewriteGlobalRegexReplaceCalls(output);

  return output;
}

function isLowercaseAsciiLetter(charCode) {
  return charCode >= 97 && charCode <= 122;
}

function rewriteGlobalRegexReplaceCalls(input) {
  const marker = ".replace(/";
  let cursor = 0;
  let output = "";
  while (cursor < input.length) {
    const start = input.indexOf(marker, cursor);
    if (start === -1) {
      output += input.slice(cursor);
      break;
    }

    output += input.slice(cursor, start);
    const literalStart = start + ".replace(".length;
    let index = literalStart + 1;
    let escaped = false;
    let inCharClass = false;
    let closed = false;

    while (index < input.length) {
      const code = input.charCodeAt(index);
      if (escaped) {
        escaped = false;
        index += 1;
        continue;
      }
      if (code === 92) {
        escaped = true;
        index += 1;
        continue;
      }
      if (inCharClass) {
        if (code === 93) {
          inCharClass = false;
        }
        index += 1;
        continue;
      }
      if (code === 91) {
        inCharClass = true;
        index += 1;
        continue;
      }
      if (code === 47) {
        closed = true;
        break;
      }
      if (code === 10 || code === 13) {
        break;
      }
      index += 1;
    }

    if (!closed) {
      output += input.slice(start, start + marker.length);
      cursor = start + marker.length;
      continue;
    }

    let flagsEnd = index + 1;
    while (flagsEnd < input.length && isLowercaseAsciiLetter(input.charCodeAt(flagsEnd))) {
      flagsEnd += 1;
    }
    const flags = input.slice(index + 1, flagsEnd);
    const hasGlobalFlag = flags.includes("g");
    const hasComma = input[flagsEnd] === ",";
    if (!hasGlobalFlag || !hasComma) {
      output += input.slice(start, flagsEnd);
      cursor = flagsEnd;
      continue;
    }

    output += `.replaceAll(${input.slice(literalStart, flagsEnd)},`;
    cursor = flagsEnd + 1;
  }
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
