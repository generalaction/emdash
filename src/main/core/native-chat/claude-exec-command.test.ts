import { describe, expect, it } from 'vitest';
import type { ProviderCustomConfig } from '@shared/app-settings';
import { buildClaudeExecCommand, isClaudeSessionId } from './claude-exec-command';

const CLAUDE_CONFIG: ProviderCustomConfig = {
  cli: 'claude',
  autoApproveFlag: '--dangerously-skip-permissions',
};

const SESSION_ID = '49df8b52-4204-4043-93c8-3eaca858922a';

describe('buildClaudeExecCommand', () => {
  it('builds a stream-json print turn with acceptEdits by default', () => {
    const { command, args } = buildClaudeExecCommand({
      providerConfig: CLAUDE_CONFIG,
      prompt: 'do the thing',
    });
    expect(command).toBe('claude');
    expect(args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      'do the thing',
    ]);
  });

  it('resumes a session and applies the auto-approve flag', () => {
    const { args } = buildClaudeExecCommand({
      providerConfig: CLAUDE_CONFIG,
      autoApprove: true,
      resumeSessionId: SESSION_ID,
      prompt: 'continue',
    });
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe(SESSION_ID);
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).not.toContain('--permission-mode');
    expect(args[args.length - 1]).toBe('continue');
  });

  it('preserves configured provider arguments before print-mode flags', () => {
    const { command, args } = buildClaudeExecCommand({
      providerConfig: {
        ...CLAUDE_CONFIG,
        cli: 'env CLAUDE_CONFIG_DIR=/tmp/claude claude',
        defaultArgs: ['--settings', 'team'],
        extraArgs: '--debug',
      },
      prompt: 'go',
    });
    expect(command).toBe('env');
    expect(args.slice(0, 5)).toEqual([
      'CLAUDE_CONFIG_DIR=/tmp/claude',
      'claude',
      '--settings',
      'team',
      '--debug',
    ]);
    expect(args[5]).toBe('-p');
  });

  it('passes the model and effort as flags before the prompt', () => {
    const { args } = buildClaudeExecCommand({
      providerConfig: CLAUDE_CONFIG,
      model: 'opus',
      reasoningEffort: 'max',
      prompt: 'go',
    });
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
    expect(args[args.indexOf('--effort') + 1]).toBe('max');
    expect(args[args.length - 1]).toBe('go');
  });

  it('rejects unsafe model ids', () => {
    expect(() =>
      buildClaudeExecCommand({
        providerConfig: CLAUDE_CONFIG,
        model: 'opus; rm -rf /',
        prompt: 'x',
      })
    ).toThrow(/Invalid model id/);
  });

  it('rejects non-UUID resume ids', () => {
    expect(() =>
      buildClaudeExecCommand({
        providerConfig: CLAUDE_CONFIG,
        resumeSessionId: '--resume; rm -rf /',
        prompt: 'x',
      })
    ).toThrow(/Invalid Claude session id/);
  });
});

describe('isClaudeSessionId', () => {
  it('accepts UUIDs and rejects everything else', () => {
    expect(isClaudeSessionId(SESSION_ID)).toBe(true);
    expect(isClaudeSessionId('claude-session')).toBe(false);
  });
});
