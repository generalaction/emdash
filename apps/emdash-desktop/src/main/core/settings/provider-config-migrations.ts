import type { ProviderCustomConfig } from '@shared/core/app-settings';

export function migrateProviderConfigOverrides(
  overrides: Record<string, Partial<ProviderCustomConfig>>
): Record<string, Partial<ProviderCustomConfig>> {
  // Provider-specific flag overrides have been removed from ProviderCustomConfig.
  // Old stored configs with extra fields (resumeFlag, autoApproveFlag, etc.) will be
  // stripped by Zod schema validation. No migration logic needed.
  return overrides;
}
