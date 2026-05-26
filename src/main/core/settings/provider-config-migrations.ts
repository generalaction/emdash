import type { ProviderCustomConfig } from '@shared/app-settings';

export function migrateProviderConfigOverrides(
  overrides: Record<string, Partial<ProviderCustomConfig>>
): Record<string, Partial<ProviderCustomConfig>> {
  const copilot = overrides.copilot;
  if (!copilot || (copilot.initialPromptFlag !== '' && copilot.initialPromptFlag !== undefined)) {
    return overrides;
  }

  const hadOldCopilotDefaultConfig =
    copilot.cli === 'copilot' ||
    copilot.resumeFlag === '--resume' ||
    copilot.autoApproveFlag === '--allow-all-tools';
  if (!hadOldCopilotDefaultConfig) return overrides;

  return {
    ...overrides,
    copilot: {
      ...copilot,
      initialPromptFlag: '-i',
    },
  };
}
