import { describe, expect, it } from 'vitest';
import { AGENT_PROVIDERS } from './agent-provider-registry';

describe('AGENT_PROVIDERS', () => {
  it('does not use the Windows cmd shell name for Command Code detection', () => {
    const commandCode = AGENT_PROVIDERS.find((provider) => provider.id === 'commandcode');

    expect(commandCode?.commands).toEqual(['command-code', 'commandcode', 'cmdc']);
  });

  it('uses the current Amp npm package and exact-thread resume metadata', () => {
    const amp = AGENT_PROVIDERS.find((provider) => provider.id === 'amp');

    expect(amp).toMatchObject({
      installCommand: 'npm install -g @ampcode/cli@latest',
      resumeFlag: 'threads continue',
      sessionIdFlag: 'threads continue',
      sessionIdOnResumeOnly: true,
    });
  });

  it('uses the current Grok docs URL while keeping the official installer as default', () => {
    const grok = AGENT_PROVIDERS.find((provider) => provider.id === 'grok');

    expect(grok).toMatchObject({
      docUrl: 'https://docs.x.ai/build/overview',
      installCommand: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    });
  });

  it('marks ACP-capable providers from the plugin registry research', () => {
    const acpProviderIds = [
      'auggie',
      'claude',
      'cline',
      'codex',
      'copilot',
      'cursor',
      'devin',
      'droid',
      'gemini',
      'goose',
      'grok',
      'hermes',
      'junie',
      'kilocode',
      'kimi',
      'kiro',
      'mimocode',
      'mistral',
      'opencode',
      'qoder',
      'qwen',
    ];

    for (const providerId of acpProviderIds) {
      const provider = AGENT_PROVIDERS.find((candidate) => candidate.id === providerId);

      expect(provider?.acpCapable, providerId).toBe(true);
    }
  });
});
