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

if (process.exitCode && process.exitCode !== 0) {
  process.stderr.write("Skill validation failed.\n");
  process.exit(process.exitCode);
}

process.stdout.write(`Skill validation passed (${skillDirs.length} skill(s)).\n`);
