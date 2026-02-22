#!/usr/bin/env node

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const sourceDir = path.join(repoRoot, 'missions', 'browser-control');
const promptDir = path.join(sourceDir, 'prompts');
const oracleDir = path.join(sourceDir, 'oracles');

const missionFiles = readdirSync(sourceDir)
  .filter((name) => /^\d{3}-[a-z0-9-]+\.md$/i.test(name))
  .sort();

if (missionFiles.length === 0) {
  throw new Error(`No mission files found in ${sourceDir}`);
}

mkdirSync(promptDir, { recursive: true });
mkdirSync(oracleDir, { recursive: true });
clearDir(promptDir);
clearDir(oracleDir);

for (const name of missionFiles) {
  const base = name.replace(/\.md$/i, '');
  const missionId = base;
  const raw = readFileSync(path.join(sourceDir, name), 'utf8');

  const startUrl = extractBacktickValue(raw, 'start_url');
  const goal = extractBacktickValue(raw, 'goal');
  const collectFields = extractCollectFields(raw);
  const successCheck = extractSuccessCheck(raw);
  const examplePayload = extractExamplePayload(raw);
  const rules = parseSuccessRules(successCheck);

  const promptText = buildPrompt({ missionId, startUrl, goal, collectFields });
  const oracle = {
    schemaVersion: 1,
    missionId,
    startUrl,
    collectFields,
    successCheck,
    rules,
    examplePayload,
  };

  writeFileSync(path.join(promptDir, `${base}.md`), `${promptText.trim()}\n`, 'utf8');
  writeFileSync(path.join(oracleDir, `${base}.json`), `${JSON.stringify(oracle, null, 2)}\n`, 'utf8');
}

console.log(`Generated ${missionFiles.length} prompts in ${rel(promptDir)}`);
console.log(`Generated ${missionFiles.length} oracles in ${rel(oracleDir)}`);

function clearDir(dir) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) {
      continue;
    }
    rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

function rel(target) {
  return path.relative(repoRoot, target) || '.';
}

function extractBacktickValue(raw, key) {
  for (const line of raw.split('\n')) {
    if (!line.startsWith(`- ${key}:`)) {
      continue;
    }
    const m = line.match(/`([^`]+)`/);
    if (m) {
      return m[1].trim();
    }
  }
  throw new Error(`Missing ${key} in mission`);
}

function extractCollectFields(raw) {
  const lines = raw.split('\n');
  const start = lines.findIndex((line) => line.trim() === '- collect_fields:');
  if (start === -1) {
    throw new Error('Missing collect_fields section');
  }
  const fields = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s+-\s+`([^`]+)`/);
    if (!m) {
      break;
    }
    fields.push(m[1].trim());
  }
  if (fields.length === 0) {
    throw new Error('collect_fields section is empty');
  }
  return fields;
}

function extractSuccessCheck(raw) {
  const m = raw.match(/## Success Check \(authoritative\)\n\n- `([^`]+)`/m);
  if (!m) {
    throw new Error('Missing success check');
  }
  return m[1].trim();
}

function extractExamplePayload(raw) {
  const m = raw.match(/## Example Proof Payload\n\n```json\n([\s\S]*?)\n```/m);
  if (!m) {
    throw new Error('Missing example proof payload');
  }
  return JSON.parse(m[1]);
}

function parseSuccessRules(successCheck) {
  const parts = successCheck.split(/\s+and\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Success check is empty');
  }
  return parts.map((part) => parseRule(part));
}

function parseRule(part) {
  let m = part.match(/^([A-Za-z0-9_]+)\s+is\s+non-empty$/);
  if (m) {
    return { field: m[1], op: 'non_empty' };
  }

  m = part.match(/^([A-Za-z0-9_]+)\s+starts with\s+(.+)$/);
  if (m) {
    return { field: m[1], op: 'starts_with', value: parseLiteral(m[2].trim()) };
  }

  m = part.match(/^([A-Za-z0-9_]+)\s+contains\s+(.+)$/);
  if (m) {
    return { field: m[1], op: 'contains', value: parseLiteral(m[2].trim()) };
  }

  m = part.match(/^([A-Za-z0-9_]+)\s*>=\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    return { field: m[1], op: 'gte', value: Number(m[2]) };
  }

  m = part.match(/^([A-Za-z0-9_]+)\s*==\s*(.+)$/);
  if (m) {
    const field = m[1];
    const rhs = m[2].trim();
    if (rhs === 'startUrl') {
      return { field, op: 'eq_ref', ref: 'startUrl' };
    }
    return { field, op: 'eq', value: parseLiteral(rhs) };
  }

  throw new Error(`Unsupported success-check clause: ${part}`);
}

function parseLiteral(token) {
  if (token === 'true') {
    return true;
  }
  if (token === 'false') {
    return false;
  }
  if (/^-?\d+(?:\.\d+)?$/.test(token)) {
    return Number(token);
  }
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    const normalized = token.startsWith("'") ? `"${token.slice(1, -1).replace(/"/g, '\\"')}"` : token;
    return JSON.parse(normalized);
  }
  return token;
}

function buildPrompt({ missionId, startUrl, goal, collectFields }) {
  const titleMatch = missionId.match(/^(\d{3})-(.+)$/);
  const missionTitle = titleMatch ? `${titleMatch[1]} - ${titleMatch[2]}` : missionId;
  const fieldList = collectFields.map((field) => `- ${field}`).join('\n');
  return `# Mission ${missionTitle}\n\nTask\n- Use SurfWright to complete this browser mission.\n- Start URL: ${startUrl}\n- Goal: ${goal}\n\nOutput format\nReturn exactly one JSON object with these keys:\n${fieldList}\n\nConstraints\n- Use the exact key names listed above.\n- Return JSON only (no markdown fences, no prose).`;
}
