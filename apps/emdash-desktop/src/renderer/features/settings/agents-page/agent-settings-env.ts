export type EnvEntry = { key: string; value: string };

const ENV_KEY_PATTERN = /^[A-Za-z_]\w*$/;

export function validateEnvEntries(envEntries: EnvEntry[]): string[] {
  const keyCounts = new Map<string, number>();
  for (const { key } of envEntries) {
    const trimmed = key.trim();
    if (trimmed && ENV_KEY_PATTERN.test(trimmed)) {
      keyCounts.set(trimmed, (keyCounts.get(trimmed) ?? 0) + 1);
    }
  }

  return envEntries.map(({ key, value }) => {
    const trimmed = key.trim();
    if (!trimmed && !value) return '';
    if (!trimmed) return 'Key is required when a value is set.';
    if (!ENV_KEY_PATTERN.test(trimmed)) {
      return 'Use letters, numbers, and underscores. The first character cannot be a number.';
    }
    if ((keyCounts.get(trimmed) ?? 0) > 1) return 'Duplicate environment variable key.';
    return '';
  });
}
