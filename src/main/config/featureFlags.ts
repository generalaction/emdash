const toBool = (value: string | undefined, defaultValue: boolean) => {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return false;
  return defaultValue;
};

const withDefault = <T>(value: T | undefined, fallback: T): T =>
  value === undefined ? fallback : value;

export const featureFlags = {
  drizzleLogNamespace: () => withDefault(process.env.EMDASH_DRIZZLE_LOG_NS, ''),
};
