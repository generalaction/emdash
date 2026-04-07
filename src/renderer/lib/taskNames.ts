export const MAX_TASK_NAME_LENGTH = 64;

export const liveTransformTaskName = (input: string): string =>
  input
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .slice(0, MAX_TASK_NAME_LENGTH);

export const normalizeTaskName = (input: string): string =>
  input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TASK_NAME_LENGTH);

export const ensureUniqueTaskName = (
  baseName: string,
  existingNames: Iterable<string>,
  maxAttempts = 6
): string => {
  const normalizedExisting = new Set(
    Array.from(existingNames, (name) => normalizeTaskName(name)).filter(Boolean)
  );
  const base = normalizeTaskName(baseName);
  if (base && !normalizedExisting.has(base)) return base;

  for (let i = 2; i < 2 + maxAttempts; i++) {
    const candidate = normalizeTaskName(`${baseName}-${i}`);
    if (candidate && !normalizedExisting.has(candidate)) {
      return candidate;
    }
  }

  const fallback = normalizeTaskName(`${baseName}-${Date.now().toString(36)}`);
  return fallback || base;
};
