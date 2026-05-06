import { describe, expect, it } from 'vitest';
import type { ProviderCustomConfig } from '@shared/app-settings';
import { providerConfigDefaults } from '@main/core/settings/schema';
import { buildAgentCommand } from './agent-command';

function makeConfig(overrides: Partial<ProviderCustomConfig> = {}): ProviderCustomConfig {
  return {
    cli: 'claude',
    resumeFlag: '--resume',
    autoApproveFlag: '--dangerously-skip-permissions',
    initialPromptFlag: '',
    sessionIdFlag: '--session-id',
    ...overrides,
  };
}

describe('buildAgentCommand', () => {
  it('uses the current Codex bypass flag when auto-approve is enabled', () => {
    const command = buildAgentCommand({
      providerId: 'codex',
      providerConfig: providerConfigDefaults.codex,
      autoApprove: true,
      initialPrompt: 'Fix the issue',
      sessionId: 'session-1',
    });

    expect(command).toEqual({
      command: 'codex',
      args: ['--dangerously-bypass-approvals-and-sandbox', 'Fix the issue'],
    });
  });

  it('supports custom CLI command prefixes and appends managed provider args', () => {
    const result = buildAgentCommand({
      providerId: 'claude',
      providerConfig: makeConfig({
        cli: 'caffeinate -i direnv exec . claude',
      }),
      autoApprove: true,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
    });

    expect(result).toEqual({
      command: 'caffeinate',
      args: [
        '-i',
        'direnv',
        'exec',
        '.',
        'claude',
        '--session-id',
        'conv-1',
        '--dangerously-skip-permissions',
        'Fix the bug',
      ],
    });
  });

  it('preserves quoted custom CLI and flag arguments', () => {
    const result = buildAgentCommand({
      providerId: 'claude',
      providerConfig: makeConfig({
        cli: '"/opt/Claude Code/bin/claude"',
        resumeFlag: '--resume "existing session"',
      }),
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(result.command).toBe('/opt/Claude Code/bin/claude');
    expect(result.args).toEqual(['--resume', 'existing session', 'conv-1']);
  });

  it('parses multi-token session id flags', () => {
    const result = buildAgentCommand({
      providerId: 'claude',
      providerConfig: makeConfig({ sessionIdFlag: '--session id' }),
      sessionId: 'conv-1',
    });

    expect(result.args).toEqual(['--session', 'id', 'conv-1']);
  });

  it('appends extra args', () => {
    const result = buildAgentCommand({
      providerId: 'claude',
      providerConfig: makeConfig({
        extraArgs: '--model "Claude Sonnet"',
      }),
      sessionId: 'conv-1',
    });

    expect(result.args).toContain('--model');
    expect(result.args).toContain('Claude Sonnet');
  });

  it('rejects shell control syntax that makes managed args ambiguous', () => {
    expect(() =>
      buildAgentCommand({
        providerId: 'claude',
        providerConfig: makeConfig({ cli: 'claude | tee log' }),
        sessionId: 'conv-1',
      })
    ).toThrow(/executable command prefixes/);
  });

  it('rejects shell setup in the CLI command field', () => {
    expect(() =>
      buildAgentCommand({
        providerId: 'claude',
        providerConfig: makeConfig({ cli: 'source ~/.zshrc && claude' }),
        sessionId: 'conv-1',
      })
    ).toThrow(/executable command prefixes/);
  });

  it('rejects inline environment assignment in the CLI command field', () => {
    expect(() =>
      buildAgentCommand({
        providerId: 'claude',
        providerConfig: makeConfig({ cli: 'FOO=bar claude' }),
        sessionId: 'conv-1',
      })
    ).toThrow(/executable command prefixes/);
  });
});
