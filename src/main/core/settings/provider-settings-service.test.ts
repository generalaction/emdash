import { describe, expect, it } from 'vitest';
import { migrateProviderConfigOverrides } from './provider-config-migrations';

describe('migrateProviderConfigOverrides', () => {
  it('migrates stored Codex hook trust bypass defaults to the compatible bypass flag', () => {
    expect(
      migrateProviderConfigOverrides({
        codex: {
          autoApproveFlag:
            '-c approval_policy="never" -c sandbox_mode="danger-full-access" --dangerously-bypass-hook-trust',
        },
      }).codex
    ).toMatchObject({ autoApproveFlag: '--dangerously-bypass-approvals-and-sandbox' });
  });

  it('migrates stored Codex combined bypass defaults to the compatible bypass flag', () => {
    expect(
      migrateProviderConfigOverrides({
        codex: {
          autoApproveFlag:
            '--dangerously-bypass-approvals-and-sandbox --dangerously-bypass-hook-trust',
        },
      }).codex
    ).toMatchObject({ autoApproveFlag: '--dangerously-bypass-approvals-and-sandbox' });
  });

  it('migrates old stored Copilot defaults to the current initial prompt flag', () => {
    expect(
      migrateProviderConfigOverrides({
        copilot: {
          cli: 'copilot',
          initialPromptFlag: '',
          resumeFlag: '--resume',
          autoApproveFlag: '--allow-all-tools',
        },
      }).copilot
    ).toMatchObject({ initialPromptFlag: '-i' });
  });

  it('migrates old stored Copilot defaults with no initial prompt flag', () => {
    expect(
      migrateProviderConfigOverrides({
        copilot: {
          cli: 'copilot',
          resumeFlag: '--resume',
          autoApproveFlag: '--allow-all-tools',
        },
      }).copilot
    ).toMatchObject({ initialPromptFlag: '-i' });
  });

  it('preserves explicit Copilot positional prompt overrides', () => {
    expect(migrateProviderConfigOverrides({ copilot: { initialPromptFlag: '' } }).copilot).toEqual({
      initialPromptFlag: '',
    });
  });
});
