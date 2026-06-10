import { describe, expect, it } from 'vitest';
import { migrateProviderConfigOverrides } from './provider-config-migrations';

describe('migrateProviderConfigOverrides', () => {
  it('passes through an empty overrides object unchanged', () => {
    expect(migrateProviderConfigOverrides({})).toEqual({});
  });

  it('passes through slim cli/extraArgs/env overrides unchanged', () => {
    expect(
      migrateProviderConfigOverrides({
        claude: { cli: '/opt/bin/claude', extraArgs: '--model claude-3-5-sonnet-latest' },
        codex: { env: { OPENAI_API_KEY: 'key' } },
      })
    ).toEqual({
      claude: { cli: '/opt/bin/claude', extraArgs: '--model claude-3-5-sonnet-latest' },
      codex: { env: { OPENAI_API_KEY: 'key' } },
    });
  });

  it('passes through unknown fields (Zod strips them at schema boundary)', () => {
    const overrides = {
      copilot: { cli: 'copilot', resumeFlag: '--resume', autoApproveFlag: '--allow-all-tools' },
    } as Record<string, object>;
    expect(migrateProviderConfigOverrides(overrides)).toBe(overrides);
  });
});
