export function isDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function mergeDeep(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) continue;
    const baseVal = base[k];
    if (isPlainObject(v) && isPlainObject(baseVal)) {
      result[k] = mergeDeep(baseVal, v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

export function computeDelta(
  value: Record<string, unknown>,
  defaults: Record<string, unknown>
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!isDeepEqual(v, defaults[k])) {
      delta[k] = v;
    }
  }
  return delta;
}

// Returns only fields in `stored` that differ from `defaults`.
// Handles legacy rows that stored the full value — fields at their default
// value are excluded from the result (they are not "truly overridden").
export function computeTrueOverrides(
  stored: Record<string, unknown>,
  defaults: Record<string, unknown>
): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stored)) {
    if (!isDeepEqual(v, defaults[k])) {
      overrides[k] = v;
    }
  }
  return overrides;
}
