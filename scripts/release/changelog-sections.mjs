function normalizeNewlines(text) {
  return String(text ?? "").replace(/\r\n/g, "\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractChangelogVersionSection(changelogText, version) {
  const text = normalizeNewlines(changelogText);
  const lines = text.split("\n");
  const escaped = escapeRegExp(String(version ?? ""));
  if (!escaped) {
    return null;
  }

  const headingRe = new RegExp(`^## \\[${escaped}\\](?:\\s+-\\s+.*)?\\s*$`);
  let start = -1;
  let heading = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (headingRe.test(line)) {
      start = i;
      heading = line;
      break;
    }
  }
  if (start === -1) {
    return null;
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^##\s+\[[^\]]+\]/.test(line)) {
      end = i;
      break;
    }
  }

  const body = lines.slice(start + 1, end).join("\n").trim();
  return {
    heading,
    body,
  };
}

