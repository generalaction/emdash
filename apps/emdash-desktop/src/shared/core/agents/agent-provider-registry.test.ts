import { describe, expect, it } from 'vitest';
import { AGENT_PROVIDERS, isValidProviderSessionId } from './agent-provider-registry';

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

  it('uses current Kimi Code install metadata', () => {
    const kimi = AGENT_PROVIDERS.find((provider) => provider.id === 'kimi');

    expect(kimi).toMatchObject({
      name: 'Kimi Code',
      docUrl: 'https://moonshotai.github.io/kimi-code/en/guides/getting-started.html',
      installCommand: 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash',
    });
  });

  it('uses current Rovo Dev ACLI install and launch metadata', () => {
    const rovo = AGENT_PROVIDERS.find((provider) => provider.id === 'rovo');

    expect(rovo).toMatchObject({
      installCommand: 'brew tap atlassian/homebrew-acli && brew install acli',
      commands: ['acli'],
      cli: 'acli',
      defaultArgs: ['rovodev', 'run'],
      autoApproveFlag: '--yolo',
    });
  });

  it('uses current Junie install metadata', () => {
    const junie = AGENT_PROVIDERS.find((provider) => provider.id === 'junie');

    expect(junie).toMatchObject({
      docUrl: 'https://junie.jetbrains.com/docs/junie-cli.html',
      installCommand: 'curl -fsSL https://junie.jetbrains.com/install.sh | bash',
    });
  });

  it('validates Amp provider session ids as thread ids', () => {
    expect(isValidProviderSessionId('amp', 'T-d2fc4acc-dd1d-497f-9609-ed0da22a7c95')).toBe(true);
    expect(isValidProviderSessionId('amp', 'not-a-thread')).toBe(false);
  });
});
