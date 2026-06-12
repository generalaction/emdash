import { pluginRegistry } from '@emdash/cli-agent-plugins/registry';
import type { CommandContext } from '@emdash/shared/agents/plugins';
/**
 * Tests for provider.behavior.prompt.buildCommand() special cases.
 * Each test exercises a specific provider's command-building behavior by calling
 * the plugin directly (no app infrastructure needed).
 */
import { describe, expect, it } from 'vitest';

function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    cli: 'agent',
    autoApprove: false,
    model: '',
    ...overrides,
  };
}

function cmd(id: string, overrides: Partial<CommandContext> = {}) {
  return pluginRegistry.get(id)!.behavior.prompt!.buildCommand(ctx({ cli: id, ...overrides }));
}

// ─── Codex ─────────────────────────────────────────────────────────────────

describe('codex buildCommand', () => {
  it('emits auto-approve flags', () => {
    const result = cmd('codex', {
      autoApprove: true,
      initialPrompt: 'Fix the issue',
      sessionId: 'session-1',
    });
    expect(result.args).toContain('-c');
    expect(result.args).toContain('approval_policy="never"');
    expect(result.args).toContain('--dangerously-bypass-hook-trust');
  });

  it('passes the initial prompt positionally on fresh sessions', () => {
    const result = cmd('codex', { initialPrompt: 'Fix the issue', sessionId: 'session-1' });
    expect(result.args).toContain('Fix the issue');
  });

  it('resumes by stored provider session id when available', () => {
    const result = cmd('codex', {
      sessionId: 'conv-1',
      providerSessionId: 'provider-session-id',
      isResuming: true,
    });
    expect(result.args).toEqual(['resume', 'provider-session-id']);
  });

  it('falls back to resume --last when no stored provider session id', () => {
    // Codex uses sessionIdOnResumeOnly — when providerSessionId is undefined, fall back.
    const result = cmd('codex', {
      sessionId: 'conv-1',
      providerSessionId: undefined,
      isResuming: true,
    });
    expect(result.args).toEqual(['resume --last']);
  });

  it('deduplicates --dangerously-bypass-approvals-and-sandbox when it appears multiple times', () => {
    const result = cmd('codex', {
      autoApprove: true,
      initialPrompt: 'Fix the issue',
      sessionId: 'session-1',
      extraArgs: [
        '--dangerously-bypass-approvals-and-sandbox',
        '--dangerously-bypass-approvals-and-sandbox',
      ],
    });
    expect(
      result.args.filter((a) => a === '--dangerously-bypass-approvals-and-sandbox')
    ).toHaveLength(1);
    expect(result.args).toContain('--dangerously-bypass-hook-trust');
  });
});

// ─── Claude ────────────────────────────────────────────────────────────────

describe('claude buildCommand', () => {
  it('includes session id on fresh sessions', () => {
    const result = cmd('claude', { sessionId: 'conv-1' });
    expect(result.args).toContain('conv-1');
  });

  it('resumes by conversation id', () => {
    const result = cmd('claude', { sessionId: 'conv-1', isResuming: true });
    expect(result.args).toContain('--resume');
    expect(result.args).toContain('conv-1');
  });

  it('passes the initial prompt as the last positional arg', () => {
    const result = cmd('claude', {
      sessionId: 'conv-1',
      initialPrompt: 'Fix the bug',
      autoApprove: true,
    });
    expect(result.args[result.args.length - 1]).toBe('Fix the bug');
  });

  it('appends user extraArgs', () => {
    const result = cmd('claude', {
      sessionId: 'conv-1',
      extraArgs: ['--model', 'claude-opus-4-5'],
    });
    expect(result.args).toContain('--model');
    expect(result.args).toContain('claude-opus-4-5');
  });
});

// ─── Amp ───────────────────────────────────────────────────────────────────

describe('amp buildCommand', () => {
  it('does not pass the initial prompt as a CLI arg (stdin delivery)', () => {
    const result = cmd('amp', { initialPrompt: 'Fix the bug', sessionId: 'conv-1' });
    // Amp wraps with bash + stdin pipe when there is a prompt
    expect(result.command).toBe('bash');
    expect(result.args[1]).toContain('Fix the bug');
  });

  it('emits PLUGINS=all env var', () => {
    const result = cmd('amp', { sessionId: 'conv-1' });
    expect(result.env).toMatchObject({ PLUGINS: 'all' });
  });

  it('emits auto-approve flag as an arg', () => {
    const result = cmd('amp', { autoApprove: true, sessionId: 'conv-1' });
    // base command is 'amp' when resuming / no prompt
    expect(result.command).toBe('amp');
    expect(result.args).toContain('--dangerously-allow-all');
  });
});

// ─── OpenCode ──────────────────────────────────────────────────────────────

describe('opencode buildCommand', () => {
  it('emits OPENCODE_PERMISSION env when auto-approve is enabled', () => {
    const result = cmd('opencode', { autoApprove: true, sessionId: 'conv-1' });
    expect(result.env).toMatchObject({ OPENCODE_PERMISSION: expect.stringContaining('allow') });
  });

  it('does not emit OPENCODE_PERMISSION when auto-approve is disabled', () => {
    const result = cmd('opencode', { autoApprove: false, sessionId: 'conv-1' });
    expect(result.env).not.toHaveProperty('OPENCODE_PERMISSION');
  });

  it('resumes by stored provider session id when available', () => {
    const result = cmd('opencode', {
      sessionId: 'conv-1',
      providerSessionId: 'ses_7e7cTuaNc1DpuMrZrpUv4WRk0Z',
      isResuming: true,
    });
    expect(result.args).toContain('--session');
    expect(result.args).toContain('ses_7e7cTuaNc1DpuMrZrpUv4WRk0Z');
  });

  it('falls back to --continue when stored provider session id is invalid', () => {
    // OpenCode session IDs start with 'ses' — a bare message id is invalid
    const result = cmd('opencode', {
      sessionId: 'conv-1',
      providerSessionId: 'msg_e8cbf36c300143krNXzZNt6AfZ',
      isResuming: true,
    });
    expect(result.args).toEqual(['--continue']);
  });

  it('uses --prompt flag for initial prompt on fresh sessions', () => {
    const result = cmd('opencode', { initialPrompt: 'Fix the issue', sessionId: 'conv-1' });
    expect(result.args).toContain('--prompt');
    expect(result.args).toContain('Fix the issue');
  });
});

// ─── Gemini ────────────────────────────────────────────────────────────────

describe('gemini buildCommand', () => {
  it('emits GEMINI_CLI_TRUST_WORKSPACE when auto-approve is enabled', () => {
    const result = cmd('gemini', { autoApprove: true, sessionId: 'conv-1' });
    expect(result.env).toMatchObject({ GEMINI_CLI_TRUST_WORKSPACE: 'true' });
  });

  it('does not emit GEMINI_CLI_TRUST_WORKSPACE when auto-approve is disabled', () => {
    const result = cmd('gemini', { autoApprove: false, sessionId: 'conv-1' });
    expect(result.env).not.toHaveProperty('GEMINI_CLI_TRUST_WORKSPACE');
  });
});

// ─── Grok ──────────────────────────────────────────────────────────────────

describe('grok buildCommand', () => {
  it('resumes by stored provider session id when available', () => {
    const result = cmd('grok', {
      sessionId: 'conv-1',
      providerSessionId: 'grok-session-1',
      isResuming: true,
    });
    expect(result.args).toContain('-r');
    expect(result.args).toContain('grok-session-1');
  });

  it('resumes without a stored session using the fallback flag', () => {
    const result = cmd('grok', {
      sessionId: 'conv-1',
      providerSessionId: undefined,
      isResuming: true,
    });
    expect(result.args).toEqual(['-r']);
  });
});

// ─── Droid ─────────────────────────────────────────────────────────────────

describe('droid buildCommand', () => {
  it('does not include session id on fresh sessions', () => {
    const result = cmd('droid', { initialPrompt: 'Fix the bug', sessionId: 'conv-1' });
    expect(result.args).toEqual(['Fix the bug']);
  });

  it('resumes by stored provider session id when available', () => {
    const result = cmd('droid', {
      sessionId: 'conv-1',
      providerSessionId: '31477a03-961a-4451-82d4-efded56947fc',
      isResuming: true,
    });
    expect(result.args).toContain('--resume');
    expect(result.args).toContain('31477a03-961a-4451-82d4-efded56947fc');
  });
});

// ─── Kimi ──────────────────────────────────────────────────────────────────

describe('kimi buildCommand', () => {
  it('omits auto-approve args when resuming without a stored provider session', () => {
    const result = cmd('kimi', {
      autoApprove: true,
      sessionId: 'conv-1',
      providerSessionId: undefined,
      isResuming: true,
    });
    expect(result.args).toEqual(['-C']);
  });

  it('resumes by stored provider session id when available', () => {
    const result = cmd('kimi', {
      sessionId: 'conv-1',
      providerSessionId: 'ses_kimi_1',
      isResuming: true,
    });
    expect(result.args).toContain('-S');
    expect(result.args).toContain('ses_kimi_1');
  });
});

// ─── Copilot ───────────────────────────────────────────────────────────────

describe('copilot buildCommand', () => {
  it('emits auto-approve flag', () => {
    const result = cmd('copilot', {
      autoApprove: true,
      initialPrompt: 'Fix the issue',
      sessionId: 'conv-1',
    });
    expect(result.args).toContain('--allow-all-tools');
  });

  it('resumes by stored provider session id when available', () => {
    const result = cmd('copilot', {
      sessionId: 'conv-1',
      providerSessionId: 'copilot-session-1',
      isResuming: true,
    });
    expect(result.args).toContain('--resume');
    expect(result.args).toContain('copilot-session-1');
  });
});

// ─── Multi-provider: fresh vs resume ───────────────────────────────────────

describe('fresh and resume args for multiple providers', () => {
  it.each<{
    id: string;
    freshArgs: string[];
    resumeArgs: string[];
  }>([
    { id: 'cursor', freshArgs: ['Fix the bug'], resumeArgs: ['--resume'] },
    {
      id: 'opencode',
      freshArgs: ['--prompt', 'Fix the bug'],
      resumeArgs: ['--continue'],
    },
    { id: 'grok', freshArgs: [], resumeArgs: ['-r'] },
    { id: 'copilot', freshArgs: ['-i', 'Fix the bug'], resumeArgs: ['--resume'] },
    {
      id: 'auggie',
      freshArgs: ['--allow-indexing', 'Fix the bug'],
      resumeArgs: ['--allow-indexing', '--continue'],
    },
    {
      id: 'goose',
      freshArgs: ['run', '-s', '-t', 'Fix the bug'],
      resumeArgs: ['run', '-s', '--resume'],
    },
    { id: 'kimi', freshArgs: [], resumeArgs: ['-C'] },
    { id: 'continue', freshArgs: ['Fix the bug'], resumeArgs: ['--resume'] },
    { id: 'codebuff', freshArgs: ['Fix the bug'], resumeArgs: [] },
    { id: 'freebuff', freshArgs: ['Fix the bug'], resumeArgs: [] },
    { id: 'mistral', freshArgs: ['Fix the bug'], resumeArgs: [] },
    {
      id: 'antigravity',
      freshArgs: ['--conversation=conv-1', '-i', 'Fix the bug'],
      resumeArgs: ['--conversation=conv-1'],
    },
  ])('$id: fresh and resume args', ({ id, freshArgs, resumeArgs }) => {
    const fresh = cmd(id, { initialPrompt: 'Fix the bug', sessionId: 'conv-1' });
    // Pass providerSessionId: undefined to simulate resume without a stored provider session.
    const resume = cmd(id, { sessionId: 'conv-1', providerSessionId: undefined, isResuming: true });

    expect(fresh.args).toEqual(freshArgs);
    expect(resume.args).toEqual(resumeArgs);
  });
});
