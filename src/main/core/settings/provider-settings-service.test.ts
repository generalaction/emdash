import { describe, expect, it } from 'vitest';
import { migrateProviderConfigOverrides } from './provider-config-migrations';

describe('migrateProviderConfigOverrides', () => {
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

  it('migrates old stored Kilocode defaults to the current primary CLI', () => {
    expect(
      migrateProviderConfigOverrides({
        kilocode: {
          cli: 'kilocode',
          initialPromptFlag: '',
          resumeFlag: '--continue',
          autoApproveFlag: '--auto',
        },
      }).kilocode
    ).toMatchObject({ cli: 'kilo' });
  });

  it('preserves explicit Kilocode fallback CLI overrides', () => {
    expect(migrateProviderConfigOverrides({ kilocode: { cli: 'kilocode' } }).kilocode).toEqual({
      cli: 'kilocode',
    });
  });
});
