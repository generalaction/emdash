import { describe, expect, it } from 'vitest';
import { buildStandardCommand } from './standard-command';

describe('buildStandardCommand', () => {
  it('splits multi-word resume fallback flags into argv parts', () => {
    const result = buildStandardCommand(
      {
        cli: 'codex',
        autoApprove: false,
        sessionId: 'conversation-1',
        isResuming: true,
        model: '',
      },
      {
        resumeFlag: 'resume',
        sessionIdFlag: ' ',
        sessionIdOnResumeOnly: true,
        resumeWithoutSessionFlag: 'resume --last',
      }
    );

    expect(result.args).toEqual(['resume', '--last']);
  });

  it('splits multi-word resume flags before appending the session id', () => {
    const result = buildStandardCommand(
      {
        cli: 'amp',
        autoApprove: false,
        providerSessionId: 'T-thread-1',
        sessionId: 'conversation-1',
        isResuming: true,
        model: '',
      },
      {
        resumeFlag: 'threads continue',
        sessionIdFlag: 'threads continue',
        sessionIdOnResumeOnly: true,
      }
    );

    expect(result.args).toEqual(['threads', 'continue', 'T-thread-1']);
  });

  it('injects modelFlag when ctx.model is non-empty', () => {
    const result = buildStandardCommand(
      {
        cli: 'claude',
        autoApprove: false,
        sessionId: 'conv-1',
        isResuming: false,
        model: 'sonnet',
      },
      {
        modelFlag: '--model',
        initialPromptFlag: '',
      }
    );

    expect(result.args).toContain('--model');
    expect(result.args).toContain('sonnet');
    const modelIdx = result.args.indexOf('--model');
    expect(result.args[modelIdx + 1]).toBe('sonnet');
  });

  it('does not inject modelFlag when ctx.model is empty', () => {
    const result = buildStandardCommand(
      {
        cli: 'claude',
        autoApprove: false,
        sessionId: 'conv-1',
        isResuming: false,
        model: '',
      },
      {
        modelFlag: '--model',
        initialPromptFlag: '',
      }
    );

    expect(result.args).not.toContain('--model');
  });

  it('injects short modelFlag (-m) for codex style', () => {
    const result = buildStandardCommand(
      {
        cli: 'codex',
        autoApprove: false,
        sessionId: 'conv-1',
        isResuming: false,
        model: 'gpt-5-codex',
      },
      {
        modelFlag: '-m',
        initialPromptFlag: '',
      }
    );

    const mIdx = result.args.indexOf('-m');
    expect(mIdx).toBeGreaterThanOrEqual(0);
    expect(result.args[mIdx + 1]).toBe('gpt-5-codex');
  });

  it('deduplicates singleton flags across generated and user extra args', () => {
    const result = buildStandardCommand(
      {
        cli: 'codex',
        autoApprove: true,
        extraArgs: ['--dangerously-bypass-hook-trust', '--verbose'],
        sessionId: 'conv-1',
        isResuming: false,
        model: '',
      },
      {
        autoApproveFlag:
          '-c approval_policy="never" -c sandbox_mode="danger-full-access" --dangerously-bypass-hook-trust',
        deduplicateFlags: ['--dangerously-bypass-hook-trust'],
      }
    );

    expect(result.args.filter((arg) => arg === '--dangerously-bypass-hook-trust')).toHaveLength(1);
    expect(result.args).toContain('--verbose');
  });
});
