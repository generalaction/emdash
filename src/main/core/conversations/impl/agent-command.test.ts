import { describe, expect, it } from 'vitest';
import { providerConfigDefaults } from '@main/core/settings/schema';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { ProviderCustomConfig } from '@shared/app-settings';
import {
  buildAgentCommand,
  buildAgentSessionCommand,
  wrapAgentCommandWithStdinPipe,
} from './agent-command';

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
      args: [
        '-c',
        'approval_policy=never',
        '-c',
        'sandbox_mode=danger-full-access',
        '--dangerously-bypass-hook-trust',
        'Fix the issue',
      ],
    });
  });

  it('does not duplicate auto-approve flags already present in default args', () => {
    const command = buildAgentCommand({
      providerId: 'codex',
      providerConfig: {
        ...providerConfigDefaults.codex,
        defaultArgs: ['--dangerously-bypass-approvals-and-sandbox'],
      },
      autoApprove: true,
      initialPrompt: 'Fix the issue',
      sessionId: 'session-1',
    });

    expect(command.args).toEqual([
      '--dangerously-bypass-approvals-and-sandbox',
      '-c',
      'approval_policy=never',
      '-c',
      'sandbox_mode=danger-full-access',
      '--dangerously-bypass-hook-trust',
      'Fix the issue',
    ]);
  });

  it('dedupes Codex singleton approval bypass flag across all configured args', () => {
    const command = buildAgentCommand({
      providerId: 'codex',
      providerConfig: {
        ...providerConfigDefaults.codex,
        cli: 'codex --dangerously-bypass-approvals-and-sandbox',
        defaultArgs: ['--dangerously-bypass-approvals-and-sandbox'],
        extraArgs: '--dangerously-bypass-approvals-and-sandbox',
      },
      autoApprove: true,
      initialPrompt: 'Fix the issue',
      sessionId: 'session-1',
    });

    expect(
      command.args.filter((arg) => arg === '--dangerously-bypass-approvals-and-sandbox')
    ).toHaveLength(1);
    expect(command.args).toContain('--dangerously-bypass-hook-trust');
    expect(command.args).toContain('Fix the issue');
  });

  it('resumes Codex by stored provider session id when available', () => {
    const result = buildAgentCommand({
      providerId: 'codex',
      providerConfig: providerConfigDefaults.codex,
      sessionId: 'conv-1',
      providerSessionId: '019c95f6-cd96-7812-ba15-574286674599',
      isResuming: true,
    });

    expect(result.args).toEqual(['resume', '019c95f6-cd96-7812-ba15-574286674599']);
  });

  it('falls back to Codex --last when resuming without a stored provider session id', () => {
    const result = buildAgentCommand({
      providerId: 'codex',
      providerConfig: providerConfigDefaults.codex,
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(result.args).toEqual(['resume', '--last']);
  });

  it('uses custom resume-without-session flags when resuming without a stored provider session id', () => {
    const result = buildAgentCommand({
      providerId: 'codex',
      providerConfig: {
        ...providerConfigDefaults.codex,
        resumeWithoutSessionFlag: 'resume newest',
      },
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(result.args).toEqual(['resume', 'newest']);
  });

  it('does not pass the internal session id as a provider session id on resume-only providers', () => {
    const result = buildAgentCommand({
      providerId: 'codex',
      providerConfig: {
        cli: 'custom-agent',
        resumeFlag: 'resume',
        sessionIdFlag: '--session-id',
        sessionIdOnResumeOnly: true,
      },
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(result.args).toEqual(['resume']);
  });

  it('uses the Antigravity skip-permissions flag when auto-approve is enabled', () => {
    const command = buildAgentCommand({
      providerId: 'antigravity',
      providerConfig: providerConfigDefaults.antigravity,
      autoApprove: true,
      initialPrompt: 'Fix the issue',
      sessionId: 'session-1',
    });

    expect(command).toEqual({
      command: 'agy',
      args: ['--conversation=session-1', '--dangerously-skip-permissions', '-i', 'Fix the issue'],
    });
  });

  it.each<{
    providerId: AgentProviderId;
    expectedArgs: string[];
  }>([
    {
      providerId: 'cursor',
      expectedArgs: ['-f', '--approve-mcps', 'Fix the issue'],
    },
    {
      providerId: 'gemini',
      expectedArgs: ['--approval-mode=yolo', '--skip-trust', '-i', 'Fix the issue'],
    },
    {
      providerId: 'copilot',
      expectedArgs: ['--allow-all-tools', '-i', 'Fix the issue'],
    },
  ])('uses automation-safe auto-approve args for $providerId', ({ providerId, expectedArgs }) => {
    const command = buildAgentCommand({
      providerId,
      providerConfig: providerConfigDefaults[providerId],
      autoApprove: true,
      initialPrompt: 'Fix the issue',
      sessionId: 'session-1',
    });

    expect(command.args).toEqual(expectedArgs);
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

  it('appends equals-style session id flags when resuming', () => {
    const result = buildAgentCommand({
      providerId: 'claude',
      providerConfig: makeConfig({ resumeFlag: '--resume=' }),
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(result.args).toEqual(['--resume=conv-1']);
  });

  it('puts default args before resume flags for CLIs with subcommands', () => {
    const result = buildAgentCommand({
      providerId: 'goose',
      providerConfig: providerConfigDefaults.goose,
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(result.args).toEqual(['run', '-s', '--resume']);
  });

  it('does not pass Droid session id on fresh sessions', () => {
    const result = buildAgentCommand({
      providerId: 'droid',
      providerConfig: providerConfigDefaults.droid,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
    });

    expect(result.args).toEqual(['Fix the bug']);
  });

  it('does not pass stdin-piped prompts as CLI args', () => {
    const result = buildAgentCommand({
      providerId: 'amp',
      providerConfig: providerConfigDefaults.amp,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
    });

    expect(result).toEqual({
      command: 'amp',
      args: [],
    });
  });

  it('passes Droid resume flag with session id when resuming', () => {
    const result = buildAgentCommand({
      providerId: 'droid',
      providerConfig: providerConfigDefaults.droid,
      sessionId: 'conv-1',
      providerSessionId: '31477a03-961a-4451-82d4-efded56947fc',
      isResuming: true,
    });

    expect(result.args).toEqual(['--resume', '31477a03-961a-4451-82d4-efded56947fc']);
  });

  it('resumes Grok by stored provider session id when available', () => {
    const result = buildAgentCommand({
      providerId: 'grok',
      providerConfig: providerConfigDefaults.grok,
      sessionId: 'conv-1',
      providerSessionId: 'grok-session-1',
      isResuming: true,
    });

    expect(result.args).toEqual(['-r', 'grok-session-1']);
  });

  it('resumes Grok without a stored provider session id using the fallback flag', () => {
    const result = buildAgentCommand({
      providerId: 'grok',
      providerConfig: providerConfigDefaults.grok,
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(result.args).toEqual(['-r']);
  });

  it.each<{
    providerId: AgentProviderId;
    freshArgs: string[];
    resumeArgs: string[];
  }>([
    { providerId: 'cursor', freshArgs: ['Fix the bug'], resumeArgs: ['--resume'] },
    {
      providerId: 'opencode',
      freshArgs: ['--prompt', 'Fix the bug'],
      resumeArgs: ['--continue'],
    },
    { providerId: 'grok', freshArgs: [], resumeArgs: ['-r'] },
    { providerId: 'copilot', freshArgs: ['-i', 'Fix the bug'], resumeArgs: ['--resume'] },
    {
      providerId: 'auggie',
      freshArgs: ['--allow-indexing', 'Fix the bug'],
      resumeArgs: ['--allow-indexing', '--continue'],
    },
    {
      providerId: 'goose',
      freshArgs: ['run', '-s', '-t', 'Fix the bug'],
      resumeArgs: ['run', '-s', '--resume'],
    },
    { providerId: 'kimi', freshArgs: ['-c', 'Fix the bug'], resumeArgs: ['--continue'] },
    { providerId: 'codebuff', freshArgs: ['Fix the bug'], resumeArgs: [] },
    { providerId: 'freebuff', freshArgs: ['Fix the bug'], resumeArgs: [] },
    { providerId: 'mistral', freshArgs: ['Fix the bug'], resumeArgs: [] },
    {
      providerId: 'antigravity',
      freshArgs: ['--conversation=conv-1', '-i', 'Fix the bug'],
      resumeArgs: ['--conversation=conv-1'],
    },
  ])('builds fresh and resume args for $providerId', ({ providerId, freshArgs, resumeArgs }) => {
    const fresh = buildAgentCommand({
      providerId,
      providerConfig: providerConfigDefaults[providerId],
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
    });

    const resume = buildAgentCommand({
      providerId,
      providerConfig: providerConfigDefaults[providerId],
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(fresh.args).toEqual(freshArgs);
    expect(resume.args).toEqual(resumeArgs);
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

  it('respects explicit Copilot positional prompt overrides', () => {
    const result = buildAgentCommand({
      providerId: 'copilot',
      providerConfig: makeConfig({
        cli: 'copilot',
        initialPromptFlag: '',
        resumeFlag: '--resume',
        autoApproveFlag: '--allow-all-tools',
        sessionIdFlag: undefined,
      }),
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
    });

    expect(result).toEqual({ command: 'copilot', args: ['Fix the bug'] });
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

describe('wrapAgentCommandWithStdinPipe', () => {
  it('pipes the prompt into the agent', () => {
    const result = wrapAgentCommandWithStdinPipe(
      { command: 'amp', args: ['--dangerously-allow-all'] },
      'Fix the bug'
    );

    expect(result.command).toBe('bash');
    expect(result.args).toEqual([
      '-c',
      "printf '%s\\n' 'Fix the bug' | 'amp' '--dangerously-allow-all'",
    ]);
  });

  it('escapes prompts containing single quotes', () => {
    const result = wrapAgentCommandWithStdinPipe({ command: 'amp', args: [] }, "it's broken");

    expect(result.args[1]).toContain("'it'\\''s broken'");
  });

  it('preserves multi-line prompts so the agent receives them verbatim', () => {
    const result = wrapAgentCommandWithStdinPipe(
      { command: 'amp', args: [] },
      'line one\nline two'
    );

    expect(result.args[1]).toContain("'line one\nline two'");
  });
});

describe('buildAgentSessionCommand', () => {
  it('wraps stdin-piped providers after managed args are built', () => {
    const result = buildAgentSessionCommand({
      providerId: 'amp',
      providerConfig: providerConfigDefaults.amp,
      autoApprove: true,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
    });

    expect(result).toEqual({
      command: 'bash',
      args: ['-c', "printf '%s\\n' 'Fix the bug' | 'amp' '--dangerously-allow-all'"],
    });
  });

  it('does not wrap when resuming', () => {
    const result = buildAgentSessionCommand({
      providerId: 'amp',
      providerConfig: providerConfigDefaults.amp,
      initialPrompt: 'Fix the bug',
      sessionId: 'conv-1',
      isResuming: true,
    });

    expect(result).toEqual({ command: 'amp', args: [] });
  });
});
