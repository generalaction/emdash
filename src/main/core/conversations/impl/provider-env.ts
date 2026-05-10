import type { ProviderCustomConfig } from '@shared/app-settings';

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function resolveProviderEnv(
  providerConfig: ProviderCustomConfig | undefined
): Record<string, string> | undefined {
  if (!providerConfig?.env) return undefined;

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(providerConfig.env)) {
    if (ENV_NAME_PATTERN.test(key)) env[key] = value;
  }

  return Object.keys(env).length > 0 ? env : undefined;
}
