import type { ProviderCustomConfig } from '@shared/core/app-settings';

export function migrateProviderConfigOverrides(
  overrides: Record<string, Partial<ProviderCustomConfig>>
): Record<string, Partial<ProviderCustomConfig>> {
  const copilot = overrides.copilot;
  const kilocode = overrides.kilocode;
  let migrated = overrides;

  if (copilot && (copilot.initialPromptFlag === '' || copilot.initialPromptFlag === undefined)) {
    const hadOldCopilotDefaultConfig =
      copilot.cli === 'copilot' ||
      copilot.resumeFlag === '--resume' ||
      copilot.autoApproveFlag === '--allow-all-tools';
    if (hadOldCopilotDefaultConfig) {
      migrated = {
        ...migrated,
        copilot: {
          ...copilot,
          initialPromptFlag: '-i',
        },
      };
    }
  }

  const hadOldKilocodeDefaultConfig =
    kilocode?.cli === 'kilocode' &&
    kilocode.initialPromptFlag === '' &&
    kilocode.resumeFlag === '--continue' &&
    kilocode.autoApproveFlag === '--auto';
  if (hadOldKilocodeDefaultConfig) {
    migrated = {
      ...migrated,
      kilocode: {
        ...kilocode,
        cli: 'kilo',
      },
    };
  }

  return migrated;
}
