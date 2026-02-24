#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CODE_FAIL = 'ZCL_E_CAMPAIGN_ORACLE_EVALUATION_FAILED';
const CODE_ERROR = 'ZCL_E_CAMPAIGN_ORACLE_EVALUATION_ERROR';

main();

function main() {
  try {
    const attemptDir = requiredEnv('ZCL_ATTEMPT_DIR');
    const oraclePath = requiredEnv('ZCL_ORACLE_PATH');

    const feedbackPath = path.join(attemptDir, 'feedback.json');
    const feedback = readJson(feedbackPath);
    const proof = extractProof(feedback);
    if (!proof || typeof proof !== 'object' || Array.isArray(proof)) {
      return writeVerdict(false, [CODE_ERROR], 'feedback result must resolve to a JSON object');
    }

    const oracle = readJson(oraclePath);
    const failures = evaluateOracle(oracle, proof);

    if (failures.length > 0) {
      return writeVerdict(false, [CODE_FAIL], trim(failures.join('; '), 800));
    }

    return writeVerdict(true, [], `oracle checks passed for ${oracle.missionId || 'mission'}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return writeVerdict(false, [CODE_ERROR], trim(message, 800));
  }
}

function requiredEnv(name) {
  const value = (process.env[name] || '').trim();
  if (!value) {
    throw new Error(`missing required env: ${name}`);
  }
  return value;
}

function readJson(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`missing file: ${filePath}`);
  }
  const raw = readFileSync(filePath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`invalid JSON at ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function extractProof(feedback) {
  if (!feedback || typeof feedback !== 'object') {
    throw new Error('feedback payload is missing');
  }
  if (!(Object.prototype.hasOwnProperty.call(feedback, 'result'))) {
    throw new Error('feedback.result is missing');
  }
  const raw = feedback.result;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw !== 'string') {
    throw new Error('feedback.result must be string or object');
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('feedback.result is empty');
  }
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    throw new Error(`feedback.result is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function evaluateOracle(oracle, proof) {
  const failures = [];

  const collectFields = Array.isArray(oracle.collectFields) ? oracle.collectFields : [];
  for (const field of collectFields) {
    if (!Object.prototype.hasOwnProperty.call(proof, field)) {
      failures.push(`missing proof field: ${field}`);
    }
  }

  const rules = Array.isArray(oracle.rules) ? oracle.rules : [];
  if (rules.length === 0) {
    failures.push('oracle rules are missing');
    return failures;
  }

  for (const rule of rules) {
    const msg = evaluateRule(rule, oracle, proof);
    if (msg) {
      failures.push(msg);
    }
  }

  return failures;
}

function evaluateRule(rule, oracle, proof) {
  if (!rule || typeof rule !== 'object') {
    return 'invalid oracle rule';
  }
  const field = String(rule.field || '').trim();
  const op = String(rule.op || '').trim();
  if (!field || !op) {
    return 'oracle rule missing field/op';
  }
  const actual = proof[field];

  switch (op) {
    case 'eq':
      if (!equivalentValues(actual, rule.value)) {
        return `${field} expected ${valueAsString(rule.value)} got ${valueAsString(actual)}`;
      }
      return '';

    case 'eq_ref': {
      const ref = String(rule.ref || '').trim();
      const expected = oracle[ref];
      if (!equivalentValues(actual, expected)) {
        return `${field} expected ${valueAsString(expected)} from ${ref} got ${valueAsString(actual)}`;
      }
      return '';
    }

    case 'starts_with':
      if (!startsWithValue(actual, rule.value)) {
        return `${field} must start with ${valueAsString(rule.value)} got ${valueAsString(actual)}`;
      }
      return '';

    case 'contains':
      if (!containsValue(actual, rule.value)) {
        return `${field} must contain ${valueAsString(rule.value)} got ${valueAsString(actual)}`;
      }
      return '';

    case 'gte':
      {
        const actualNumber = toNumberLike(actual);
        const expectedNumber = toNumberLike(rule.value);
        if (actualNumber == null || expectedNumber == null) {
          return `${field} must be a number for gte`;
        }
        if (!(actualNumber >= expectedNumber)) {
          return `${field} must be >= ${valueAsString(rule.value)} got ${valueAsString(actual)}`;
        }
      }
      return '';

    case 'non_empty':
      if (!isNonEmpty(actual)) {
        return `${field} must be non-empty`;
      }
      return '';

    default:
      return `unsupported oracle op: ${op}`;
  }
}

function equivalentValues(actual, expected) {
  if (Object.is(actual, expected)) {
    return true;
  }

  if (typeof expected === 'boolean') {
    const actualBool = toBooleanLike(actual);
    return typeof actualBool === 'boolean' && actualBool === expected;
  }

  if (typeof expected === 'number') {
    const actualNumber = toNumberLike(actual);
    return typeof actualNumber === 'number' && Number.isFinite(actualNumber) && actualNumber === expected;
  }

  if (typeof expected === 'string') {
    return equivalentStringLike(actual, expected);
  }

  if (Array.isArray(expected)) {
    return equivalentArrayLike(actual, expected);
  }

  return false;
}

function equivalentStringLike(actual, expected) {
  if (typeof actual !== 'string' && typeof actual !== 'number' && typeof actual !== 'boolean' && !Array.isArray(actual)) {
    return false;
  }

  if (Array.isArray(actual)) {
    const expectedTokens = toListTokens(expected);
    const actualTokens = toListTokens(actual);
    return expectedTokens != null && actualTokens != null && sameTokenSet(actualTokens, expectedTokens);
  }

  const actualText = String(actual);
  if (actualText === expected) {
    return true;
  }

  const actualLoose = normalizeLooseText(actualText);
  const expectedLoose = normalizeLooseText(expected);
  if (actualLoose === expectedLoose) {
    return true;
  }

  const actualShell = normalizeLooseText(stripShellPrompt(actualText));
  const expectedShell = normalizeLooseText(stripShellPrompt(expected));
  if (actualShell === expectedShell) {
    return true;
  }

  const actualNumber = toNumberLike(actualText);
  const expectedNumber = toNumberLike(expected);
  if (actualNumber != null && expectedNumber != null && actualNumber === expectedNumber) {
    return true;
  }

  const actualUrl = canonicalizeUrl(actualText);
  const expectedUrl = canonicalizeUrl(expected);
  if (actualUrl && expectedUrl && actualUrl === expectedUrl) {
    return true;
  }

  const actualTokens = toListTokens(actualText);
  const expectedTokens = toListTokens(expected);
  if (actualTokens != null && expectedTokens != null && sameTokenSet(actualTokens, expectedTokens)) {
    return true;
  }

  return false;
}

function equivalentArrayLike(actual, expected) {
  const expectedTokens = toListTokens(expected);
  const actualTokens = toListTokens(actual);
  if (!expectedTokens || !actualTokens) {
    return false;
  }
  return sameTokenSet(actualTokens, expectedTokens);
}

function startsWithValue(actual, expected) {
  if (typeof actual !== 'string' && typeof actual !== 'number' && typeof actual !== 'boolean') {
    return false;
  }
  const actualText = String(actual);
  const expectedText = String(expected);
  if (actualText.startsWith(expectedText)) {
    return true;
  }
  const actualLoose = normalizeLooseText(actualText);
  const expectedLoose = normalizeLooseText(expectedText);
  if (actualLoose.startsWith(expectedLoose)) {
    return true;
  }
  const actualShell = normalizeLooseText(stripShellPrompt(actualText));
  const expectedShell = normalizeLooseText(stripShellPrompt(expectedText));
  if (actualShell.startsWith(expectedShell)) {
    return true;
  }
  const actualUrl = canonicalizeUrl(actualText);
  const expectedUrl = canonicalizeUrl(expectedText);
  if (actualUrl && expectedUrl) {
    return actualUrl.startsWith(expectedUrl);
  }
  return false;
}

function containsValue(actual, expected) {
  if (typeof actual === 'string') {
    const expectedText = String(expected);
    if (actual.includes(expectedText)) {
      return true;
    }
    if (normalizeLooseText(actual).includes(normalizeLooseText(expectedText))) {
      return true;
    }
    if (normalizeLooseText(stripShellPrompt(actual)).includes(normalizeLooseText(stripShellPrompt(expectedText)))) {
      return true;
    }
    return false;
  }

  const actualTokens = toListTokens(actual);
  if (!actualTokens) {
    return false;
  }
  const expectedTokens = toListTokens(expected);
  if (expectedTokens && expectedTokens.length > 0) {
    return expectedTokens.every((token) => actualTokens.includes(token));
  }
  const expectedScalar = normalizeToken(String(expected));
  return actualTokens.includes(expectedScalar);
}

function normalizeLooseText(value) {
  return String(value || '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripShellPrompt(value) {
  return String(value || '').replace(/^\s*(?:\$|#|>|PS [^>]+>)\s*/i, '');
}

function toBooleanLike(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return null;
}

function toNumberLike(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    return null;
  }
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) {
    return direct;
  }
  const unitMatch = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(?:px|em|rem|vh|vw|%)$/i);
  if (unitMatch) {
    return Number(unitMatch[1]);
  }
  return null;
}

function canonicalizeUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
      url.port = '';
    }
    if (url.pathname !== '/') {
      url.pathname = url.pathname.replace(/\/+$/g, '');
      if (url.pathname.length < 1) {
        url.pathname = '/';
      }
    }
    return url.toString();
  } catch {
    return null;
  }
}

function toListTokens(value) {
  if (Array.isArray(value)) {
    const out = [];
    for (const entry of value) {
      if (entry == null) {
        continue;
      }
      if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
        out.push(...splitListString(String(entry)));
      } else {
        return null;
      }
    }
    return out.length > 0 ? out.map(normalizeToken).filter(Boolean) : null;
  }

  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length < 1) {
    return null;
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return toListTokens(parsed);
      }
    } catch {
      // ignore and continue with split logic below.
    }
  }
  const split = splitListString(trimmed);
  if (split.length < 2) {
    return null;
  }
  return split.map(normalizeToken).filter(Boolean);
}

function splitListString(value) {
  return String(value || '')
    .split(/[,\n;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeToken(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  const unquoted = trimmed.replace(/^['"](.+)['"]$/g, '$1');
  return normalizeLooseText(unquoted).toLowerCase();
}

function sameTokenSet(actual, expected) {
  if (actual.length !== expected.length) {
    return false;
  }
  const a = [...actual].sort();
  const b = [...expected].sort();
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

function isNonEmpty(value) {
  if (value == null) {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return true;
}

function valueAsString(value) {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (value === undefined) {
    return 'undefined';
  }
  return JSON.stringify(value);
}

function trim(text, max) {
  const raw = String(text || '');
  if (raw.length <= max) {
    return raw;
  }
  return `${raw.slice(0, max - 1)}…`;
}

function writeVerdict(ok, reasonCodes, message) {
  process.stdout.write(`${JSON.stringify({ ok, reasonCodes, message })}\n`);
}
