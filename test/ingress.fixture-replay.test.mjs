import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const FIXTURE_ROOT = path.join(process.cwd(), "test", "fixtures", "ingress");

function listFixtureFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) {
      continue;
    }
    const entries = fs.readdirSync(next, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(next, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) {
        out.push(fullPath);
      }
    }
  }
  out.sort();
  return out;
}

function readFixture(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function assertBaseSchema(fixture, filePath) {
  assert.equal(typeof fixture, "object", `${filePath}: fixture must be an object`);
  assert.equal(fixture.schemaVersion, 1, `${filePath}: schemaVersion must be 1`);
  assert.equal(typeof fixture.caseId, "string", `${filePath}: caseId must be a string`);
  assert.ok(fixture.caseId.length > 0, `${filePath}: caseId must not be empty`);

  assert.equal(typeof fixture.source, "object", `${filePath}: source must be an object`);
  assert.equal(typeof fixture.source.capturedAt, "string", `${filePath}: source.capturedAt must be a string`);
  assert.equal(typeof fixture.source.surfaceVersion, "string", `${filePath}: source.surfaceVersion must be a string`);
  assert.equal(typeof fixture.source.note, "string", `${filePath}: source.note must be a string`);

  assert.equal(typeof fixture.command, "object", `${filePath}: command must be an object`);
  assert.equal(typeof fixture.command.id, "string", `${filePath}: command.id must be a string`);
  assert.equal(typeof fixture.command.input, "object", `${filePath}: command.input must be an object`);

  assert.equal(typeof fixture.observed, "object", `${filePath}: observed must be an object`);
  assert.equal(typeof fixture.expect, "object", `${filePath}: expect must be an object`);
}

function assertFindFixture(fixture, filePath) {
  const { observed, expect, command } = fixture;
  assert.equal(command.id, "target.find", `${filePath}: expected target.find command`);

  if (expect.ok === false) {
    assert.equal(observed.ok, false, `${filePath}: observed.ok should be false`);
    assert.equal(observed.code, expect.code, `${filePath}: observed.code mismatch`);
    assert.equal(typeof observed.message, "string", `${filePath}: observed.message must be a string`);
    return;
  }

  assert.equal(observed.ok, true, `${filePath}: observed.ok should be true`);
  assert.equal(observed.mode, expect.mode, `${filePath}: mode mismatch`);
  assert.equal(observed.query, expect.query, `${filePath}: query mismatch`);
  assert.equal(observed.limit, expect.limit, `${filePath}: limit mismatch`);
  assert.ok(observed.count >= expect.countAtLeast, `${filePath}: count lower than expected minimum`);
  assert.equal(observed.truncated, expect.truncated, `${filePath}: truncated mismatch`);
  assert.equal(Array.isArray(observed.matches), true, `${filePath}: matches must be an array`);
  assert.ok(observed.matches.length >= expect.minMatches, `${filePath}: matches below expected minimum`);
}

function assertSnapshotFixture(fixture, filePath) {
  const { observed, expect, command } = fixture;
  assert.equal(command.id, "target.snapshot", `${filePath}: expected target.snapshot command`);
  assert.equal(observed.ok, true, `${filePath}: observed.ok should be true`);
  assert.equal(typeof observed.title, "string", `${filePath}: title must be a string`);
  assert.ok(observed.title.includes(expect.titleContains), `${filePath}: title missing expected substring`);
  assert.equal(Array.isArray(observed.headings), true, `${filePath}: headings must be an array`);
  assert.equal(Array.isArray(observed.buttons), true, `${filePath}: buttons must be an array`);
  assert.ok(observed.headings.length >= expect.minHeadings, `${filePath}: headings below expected minimum`);
  assert.ok(observed.buttons.length >= expect.minButtons, `${filePath}: buttons below expected minimum`);
  assert.equal(observed.truncated.text, expect.truncated.text, `${filePath}: truncated.text mismatch`);
  assert.equal(observed.truncated.headings, expect.truncated.headings, `${filePath}: truncated.headings mismatch`);
  assert.equal(observed.truncated.links, expect.truncated.links, `${filePath}: truncated.links mismatch`);
}

function assertTargetListFixture(fixture, filePath) {
  const { observed, expect, command } = fixture;
  assert.equal(command.id, "target.list", `${filePath}: expected target.list command`);
  assert.equal(observed.ok, true, `${filePath}: observed.ok should be true`);
  assert.equal(Array.isArray(observed.targets), true, `${filePath}: targets must be an array`);
  assert.ok(observed.targets.length >= expect.minTargets, `${filePath}: targets below expected minimum`);

  const wantedUrl = expect.requireDuplicateUrl;
  const sameUrlCount = observed.targets.filter((entry) => entry.url === wantedUrl).length;
  assert.ok(sameUrlCount >= 2, `${filePath}: expected duplicate targets for ${wantedUrl}`);
}

function assertSessionAttachFixture(fixture, filePath) {
  const { observed, expect, command } = fixture;
  assert.equal(command.id, "session.attach", `${filePath}: expected session.attach command`);
  assert.equal(typeof command.input.cdpOrigin, "string", `${filePath}: command.input.cdpOrigin must be a string`);
  assert.equal(typeof command.input.timeoutMs, "number", `${filePath}: command.input.timeoutMs must be a number`);

  if (expect.ok === false) {
    assert.equal(observed.ok, false, `${filePath}: observed.ok should be false`);
    assert.equal(observed.code, expect.code, `${filePath}: observed.code mismatch`);
    assert.equal(typeof observed.message, "string", `${filePath}: observed.message must be a string`);
    return;
  }

  assert.equal(observed.ok, true, `${filePath}: observed.ok should be true`);
  assert.equal(observed.kind, "attached", `${filePath}: kind should be attached`);
  assert.equal(observed.active, true, `${filePath}: active should be true`);
  assert.equal(observed.created, true, `${filePath}: created should be true`);
  assert.equal(observed.restarted, false, `${filePath}: restarted should be false`);
}

function assertTargetClickFixture(fixture, filePath) {
  const { observed, expect, command } = fixture;
  assert.equal(command.id, "target.click", `${filePath}: expected target.click command`);
  assert.equal(observed.ok, true, `${filePath}: observed.ok should be true`);
  assert.equal(observed.mode, expect.mode, `${filePath}: mode mismatch`);
  assert.equal(observed.query, expect.query, `${filePath}: query mismatch`);
  assert.equal(typeof observed.actionId, "string", `${filePath}: actionId must be a string`);
  assert.equal(typeof observed.clicked, "object", `${filePath}: clicked must be an object`);
  assert.equal(typeof observed.clicked.text, "string", `${filePath}: clicked.text must be a string`);
  assert.ok(observed.clicked.text.includes(expect.clickedTextContains), `${filePath}: clicked.text missing expected content`);
  assert.equal(Object.prototype.hasOwnProperty.call(observed, "wait"), true, `${filePath}: wait key missing`);
  assert.equal(Object.prototype.hasOwnProperty.call(observed, "snapshot"), true, `${filePath}: snapshot key missing`);
  assert.equal(typeof observed.timingMs, "object", `${filePath}: timingMs must be an object`);
  assert.equal(typeof observed.timingMs.total, "number", `${filePath}: timingMs.total must be a number`);
}

function assertTargetFillFixture(fixture, filePath) {
  const { observed, expect, command } = fixture;
  assert.equal(command.id, "target.fill", `${filePath}: expected target.fill command`);
  assert.equal(observed.ok, true, `${filePath}: observed.ok should be true`);
  assert.equal(observed.query, expect.query, `${filePath}: query mismatch`);
  assert.equal(observed.valueLength, expect.valueLength, `${filePath}: valueLength mismatch`);
  assert.equal(typeof observed.actionId, "string", `${filePath}: actionId must be a string`);
  assert.equal(typeof observed.url, "string", `${filePath}: url must be a string`);
  assert.equal(typeof observed.title, "string", `${filePath}: title must be a string`);
  assert.equal(typeof observed.timingMs, "object", `${filePath}: timingMs must be an object`);
  assert.equal(typeof observed.timingMs.total, "number", `${filePath}: timingMs.total must be a number`);
}

function assertTargetDragDropFixture(fixture, filePath) {
  const { observed, expect, command } = fixture;
  assert.equal(command.id, "target.drag-drop", `${filePath}: expected target.drag-drop command`);
  assert.equal(observed.ok, true, `${filePath}: observed.ok should be true`);
  assert.equal(observed.from, expect.from, `${filePath}: from mismatch`);
  assert.equal(observed.to, expect.to, `${filePath}: to mismatch`);
  assert.equal(observed.result, expect.result, `${filePath}: result mismatch`);
  assert.equal(typeof observed.actionId, "string", `${filePath}: actionId must be a string`);
  assert.equal(typeof observed.timingMs, "object", `${filePath}: timingMs must be an object`);
  assert.equal(typeof observed.timingMs.total, "number", `${filePath}: timingMs.total must be a number`);
}

function assertTargetSpawnFixture(fixture, filePath) {
  const { observed, expect, command } = fixture;
  assert.equal(command.id, "target.spawn", `${filePath}: expected target.spawn command`);
  assert.equal(observed.ok, true, `${filePath}: observed.ok should be true`);
  assert.equal(observed.query, expect.query, `${filePath}: query mismatch`);
  assert.equal(typeof observed.parentTargetId, "string", `${filePath}: parentTargetId must be a string`);
  assert.equal(typeof observed.childTargetId, "string", `${filePath}: childTargetId must be a string`);
  assert.ok(observed.url.includes(expect.urlContains), `${filePath}: url missing expected content`);
  assert.equal(typeof observed.actionId, "string", `${filePath}: actionId must be a string`);
  assert.equal(typeof observed.timingMs, "object", `${filePath}: timingMs must be an object`);
  assert.equal(typeof observed.timingMs.total, "number", `${filePath}: timingMs.total must be a number`);
}

function assertTargetScreenshotFixture(fixture, filePath) {
  const { observed, expect, command } = fixture;
  assert.equal(command.id, "target.screenshot", `${filePath}: expected target.screenshot command`);
  assert.equal(observed.ok, true, `${filePath}: observed.ok should be true`);
  assert.equal(observed.type, expect.type, `${filePath}: type mismatch`);
  assert.equal(observed.fullPage, expect.fullPage, `${filePath}: fullPage mismatch`);
  assert.equal(typeof observed.path, "string", `${filePath}: path must be a string`);
  assert.equal(typeof observed.bytes, "number", `${filePath}: bytes must be a number`);
  assert.equal(typeof observed.sha256, "string", `${filePath}: sha256 must be a string`);
  assert.equal(observed.sha256.length, 64, `${filePath}: sha256 must be 64 hex chars`);
  assert.equal(typeof observed.timingMs, "object", `${filePath}: timingMs must be an object`);
  assert.equal(typeof observed.timingMs.total, "number", `${filePath}: timingMs.total must be a number`);
}

function assertFixtureCasesPresent(fixturesByCaseId) {
  const required = [
    "target-find-invalid-selector",
    "target-find-missing-query",
    "target-find-multi-match-truncated",
    "target-snapshot-truncation-flags",
    "target-list-duplicate-url-different-targets",
    "session-attach-slow-healthcheck-timeout-window",
    "target-click-basic-selector",
    "target-fill-basic-selector",
    "target-drag-drop-basic-selector",
    "target-spawn-basic-selector",
    "target-screenshot-basic-fullpage-png",
  ];
  for (const caseId of required) {
    assert.equal(fixturesByCaseId.has(caseId), true, `Missing required ingress fixture case: ${caseId}`);
  }
}

test("ingress fixture replay cases are present and valid", () => {
  assert.equal(fs.existsSync(FIXTURE_ROOT), true, "Fixture ingress root is missing");
  const files = listFixtureFiles(FIXTURE_ROOT);
  assert.ok(files.length > 0, "No ingress fixture files found");

  const byCaseId = new Map();
  for (const filePath of files) {
    const fixture = readFixture(filePath);
    assertBaseSchema(fixture, filePath);
    assert.equal(byCaseId.has(fixture.caseId), false, `${filePath}: duplicate caseId ${fixture.caseId}`);
    byCaseId.set(fixture.caseId, fixture);

    if (fixture.command.id === "target.find") {
      assertFindFixture(fixture, filePath);
      continue;
    }
    if (fixture.command.id === "target.snapshot") {
      assertSnapshotFixture(fixture, filePath);
      continue;
    }
    if (fixture.command.id === "target.list") {
      assertTargetListFixture(fixture, filePath);
      continue;
    }
    if (fixture.command.id === "session.attach") {
      assertSessionAttachFixture(fixture, filePath);
      continue;
    }
    if (fixture.command.id === "target.click") {
      assertTargetClickFixture(fixture, filePath);
      continue;
    }
    if (fixture.command.id === "target.fill") {
      assertTargetFillFixture(fixture, filePath);
      continue;
    }
    if (fixture.command.id === "target.drag-drop") {
      assertTargetDragDropFixture(fixture, filePath);
      continue;
    }
    if (fixture.command.id === "target.spawn") {
      assertTargetSpawnFixture(fixture, filePath);
      continue;
    }
    if (fixture.command.id === "target.screenshot") {
      assertTargetScreenshotFixture(fixture, filePath);
      continue;
    }
    assert.fail(`${filePath}: unsupported command id ${fixture.command.id}`);
  }

  assertFixtureCasesPresent(byCaseId);
});
