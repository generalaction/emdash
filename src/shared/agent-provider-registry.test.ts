import { describe, expect, it } from 'vitest';
import { AGENT_PROVIDER_IDS, getProvider } from './agent-provider-registry';

describe('agent provider registry', () => {
  it('registers Devin with prompt, resume, detection, and auto-approve metadata', () => {
    expect(AGENT_PROVIDER_IDS).toContain('devin');

    const provider = getProvider('devin');
    expect(provider).toMatchObject({
      id: 'devin',
      name: 'Devin',
      cli: 'devin',
      commands: ['devin'],
      versionArgs: ['--version'],
      initialPromptFlag: '--',
      resumeFlag: '--continue',
      autoApproveFlag: '--permission-mode=bypass',
      planActivateCommand: '/plan',
      icon: 'devin.png',
      terminalOnly: true,
    });
  });
});
