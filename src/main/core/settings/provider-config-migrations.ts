import type { ProviderCustomConfig } from '@shared/app-settings';

export function migrateProviderConfigOverrides(
  overrides: Record<string, Partial<ProviderCustomConfig>>
): Record<string, Partial<ProviderCustomConfig>> {
  const codex = overrides.codex;
  const currentCodexAutoApproveFlag = '--dangerously-bypass-approvals-and-sandbox';
  if (
    codex?.autoApproveFlag ===
      '-c approval_policy="never" -c sandbox_mode="danger-full-access" --dangerously-bypass-hook-trust' ||
    codex?.autoApproveFlag ===
      '--dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust'
  ) {
    overrides = {
      ...overrides,
      codex: {
        ...codex,
        autoApproveFlag: currentCodexAutoApproveFlag,
      },
    };
  }

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
