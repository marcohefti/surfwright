export function asPositiveInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const parsed = Math.floor(value);
  if (parsed <= 0) {
    return null;
  }
  return parsed;
}

export function asNonNegativeInteger(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const parsed = Math.floor(value);
  if (parsed < 0) {
    return null;
  }
  return parsed;
}
