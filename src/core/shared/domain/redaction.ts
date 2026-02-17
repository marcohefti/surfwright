const SENSITIVE_HEADER_NAMES = new Set<string>([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
]);

function toHeaderKey(name: string): string {
  return name.trim().toLowerCase();
}

export function redactText(value: string, redactors: RegExp[]): string {
  let out = value;
  for (const redactor of redactors) {
    out = out.replace(redactor, "[REDACTED]");
  }
  return out;
}

export function redactHeaders(opts: {
  headers: Record<string, string>;
  redactors?: RegExp[];
}): Record<string, string> {
  const redactors = Array.isArray(opts.redactors) ? opts.redactors : [];
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(opts.headers)) {
    const key = toHeaderKey(name);
    if (SENSITIVE_HEADER_NAMES.has(key)) {
      out[name] = "[REDACTED]";
      continue;
    }
    out[name] = redactors.length > 0 ? redactText(value, redactors) : value;
  }
  return out;
}

export function sensitiveHeaderNames(): string[] {
  return [...SENSITIVE_HEADER_NAMES].sort();
}

