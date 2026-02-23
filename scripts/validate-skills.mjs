#!/usr/bin/env node
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.join(rootDir, "skills");

const disallowedTopLevelDocs = new Set([
  "README.md",
  "CHANGELOG.md",
  "INSTALLATION_GUIDE.md",
  "QUICK_REFERENCE.md",
]);

const surfwrightSkillPolicy = {
  maxBytes: 1800,
  maxLines: 45,
  requiredSnippets: [
    "surfwright contract --search",
    "session fresh",
    "session clear",
    "typed failures",
    "required JSON schema",
  ],
  disallowedPatterns: [
    /\bsurfwright\b[^\n`]*\s--help\b/i,
    /surfwright\s+help\b/i,
    /references\//i,
  ],
};

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function parseFrontmatter(skillPath, body) {
  const match = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) {
    fail(`${skillPath}: missing YAML frontmatter`);
    return null;
  }

  const yaml = match[1];
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const descriptionMatch = yaml.match(/^description:\s*(.+)$/m);

  if (!nameMatch) {
    fail(`${skillPath}: frontmatter missing 'name'`);
  }
  if (!descriptionMatch) {
    fail(`${skillPath}: frontmatter missing 'description'`);
  }

  const name = nameMatch ? nameMatch[1].trim().replace(/^"|"$/g, "") : "";
  const description = descriptionMatch ? descriptionMatch[1].trim().replace(/^"|"$/g, "") : "";

  if (name.length === 0) {
    fail(`${skillPath}: frontmatter name is empty`);
  }
  if (description.length === 0) {
    fail(`${skillPath}: frontmatter description is empty`);
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    fail(`${skillPath}: frontmatter name must match [a-z0-9-]+`);
  }

  return { name, description };
}

function validateSkillDir(skillDirPath) {
  const skillDirName = path.basename(skillDirPath);
  const skillFile = path.join(skillDirPath, "SKILL.md");
  const skillBody = readIfExists(skillFile);
  if (!skillBody) {
    fail(`${skillDirPath}: missing SKILL.md`);
    return;
  }

  const frontmatter = parseFrontmatter(skillDirPath, skillBody);
  if (!frontmatter) {
    return;
  }

  if (frontmatter.name === "surfwright") {
    validateSurfwrightSkill(skillFile, skillBody);
  }

  if (frontmatter.name !== skillDirName) {
    fail(`${skillDirPath}: directory name '${skillDirName}' must match frontmatter name '${frontmatter.name}'`);
  }

  const entries = fs.readdirSync(skillDirPath);
  for (const entry of entries) {
    if (disallowedTopLevelDocs.has(entry)) {
      fail(`${skillDirPath}: disallowed file '${entry}' in skill root`);
    }
  }

  const openaiYamlPath = path.join(skillDirPath, "agents", "openai.yaml");
  const openaiYaml = readIfExists(openaiYamlPath);
  if (openaiYaml) {
    const defaultPromptMatch = openaiYaml.match(/^\s*default_prompt:\s*"([^"]*)"\s*$/m);
    if (!defaultPromptMatch) {
      fail(`${openaiYamlPath}: missing interface.default_prompt string`);
    } else {
      const defaultPrompt = defaultPromptMatch[1];
      if (!defaultPrompt.includes(`$${frontmatter.name}`)) {
        fail(`${openaiYamlPath}: default_prompt must reference $${frontmatter.name}`);
      }
    }
  }

  const manifestPath = path.join(skillDirPath, "skill.json");
  const manifestRaw = readIfExists(manifestPath);
  if (!manifestRaw) {
    fail(`${skillDirPath}: missing skill.json`);
    return;
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    fail(`${manifestPath}: invalid JSON`);
    return;
  }
  if (manifest?.schemaVersion !== 1) {
    fail(`${manifestPath}: schemaVersion must be 1`);
  }
  if (manifest?.name !== frontmatter.name) {
    fail(`${manifestPath}: name must match SKILL frontmatter (${frontmatter.name})`);
  }
  if (typeof manifest?.skillVersion !== "string" || manifest.skillVersion.length === 0) {
    fail(`${manifestPath}: skillVersion is required`);
  }
  if (manifest?.channel !== "stable" && manifest?.channel !== "beta" && manifest?.channel !== "dev") {
    fail(`${manifestPath}: channel must be stable|beta|dev`);
  }
  if (typeof manifest?.requires?.surfwrightVersion !== "string" || manifest.requires.surfwrightVersion.length === 0) {
    fail(`${manifestPath}: requires.surfwrightVersion is required`);
  }
  if (
    typeof manifest?.requires?.contractSchemaVersion !== "string" ||
    manifest.requires.contractSchemaVersion.length === 0
  ) {
    fail(`${manifestPath}: requires.contractSchemaVersion is required`);
  }
  if (
    typeof manifest?.requires?.contractFingerprint !== "string" ||
    manifest.requires.contractFingerprint.length === 0
  ) {
    fail(`${manifestPath}: requires.contractFingerprint is required`);
  } else if (manifest.requires.contractFingerprint.includes("pending")) {
    fail(`${manifestPath}: requires.contractFingerprint cannot be pending`);
  }
}

function validateSurfwrightSkill(skillFilePath, skillBody) {
  const skillDirPath = path.dirname(skillFilePath);
  const byteSize = Buffer.byteLength(skillBody, "utf8");
  const lineCount = skillBody.split(/\r?\n/).length;

  if (byteSize > surfwrightSkillPolicy.maxBytes) {
    fail(
      `${skillFilePath}: SurfWright SKILL.md must stay concise (${byteSize} bytes > ${surfwrightSkillPolicy.maxBytes})`,
    );
  }

  if (lineCount > surfwrightSkillPolicy.maxLines) {
    fail(
      `${skillFilePath}: SurfWright SKILL.md must stay concise (${lineCount} lines > ${surfwrightSkillPolicy.maxLines})`,
    );
  }

  for (const pattern of surfwrightSkillPolicy.disallowedPatterns) {
    if (pattern.test(skillBody)) {
      fail(`${skillFilePath}: SurfWright SKILL.md must not direct agents to --help discovery`);
      break;
    }
  }

  const lower = skillBody.toLowerCase();
  for (const snippet of surfwrightSkillPolicy.requiredSnippets) {
    if (!lower.includes(snippet.toLowerCase())) {
      fail(`${skillFilePath}: SurfWright SKILL.md missing required guidance snippet: ${snippet}`);
    }
  }

  const referencesDir = path.join(skillDirPath, "references");
  if (fs.existsSync(referencesDir)) {
    fail(`${skillDirPath}: SurfWright skill must not include references/ docs; keep runtime guidance in SKILL.md only`);
  }
}

if (!fs.existsSync(skillsRoot)) {
  process.stdout.write("No skills directory found; skipping skill validation.\n");
  process.exit(0);
}

const skillDirs = fs
  .readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(skillsRoot, entry.name));

if (skillDirs.length === 0) {
  process.stdout.write("No skills found under skills/; skipping skill validation.\n");
  process.exit(0);
}

for (const skillDir of skillDirs) {
  validateSkillDir(skillDir);
}

const lockPath = path.join(skillsRoot, "surfwright.lock.json");
if (!fs.existsSync(lockPath)) {
  fail(`${lockPath}: missing skill lock file`);
} else {
  const lockRaw = readIfExists(lockPath);
  try {
    const lock = JSON.parse(lockRaw ?? "");
    if (typeof lock?.digest !== "string" || !lock.digest.startsWith("sha256:")) {
      fail(`${lockPath}: digest must be sha256:*`);
    }
  } catch {
    fail(`${lockPath}: invalid JSON`);
  }
}

if (process.exitCode && process.exitCode !== 0) {
  process.stderr.write("Skill validation failed.\n");
  process.exit(process.exitCode);
}

process.stdout.write(`Skill validation passed (${skillDirs.length} skill(s)).\n`);
