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
      if (!Object.is(actual, rule.value)) {
        return `${field} expected ${valueAsString(rule.value)} got ${valueAsString(actual)}`;
      }
      return '';

    case 'eq_ref': {
      const ref = String(rule.ref || '').trim();
      const expected = oracle[ref];
      if (!Object.is(actual, expected)) {
        return `${field} expected ${valueAsString(expected)} from ${ref} got ${valueAsString(actual)}`;
      }
      return '';
    }

    case 'starts_with':
      if (typeof actual !== 'string') {
        return `${field} must be a string for starts_with`;
      }
      if (!actual.startsWith(String(rule.value))) {
        return `${field} must start with ${valueAsString(rule.value)} got ${valueAsString(actual)}`;
      }
      return '';

    case 'contains':
      if (typeof actual !== 'string') {
        return `${field} must be a string for contains`;
      }
      if (!actual.includes(String(rule.value))) {
        return `${field} must contain ${valueAsString(rule.value)} got ${valueAsString(actual)}`;
      }
      return '';

    case 'gte':
      if (typeof actual !== 'number') {
        return `${field} must be a number for gte`;
      }
      if (!(actual >= Number(rule.value))) {
        return `${field} must be >= ${valueAsString(rule.value)} got ${valueAsString(actual)}`;
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
