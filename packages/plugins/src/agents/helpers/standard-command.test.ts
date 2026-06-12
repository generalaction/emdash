import { describe, expect, it } from 'vitest';
import { buildStandardCommand, wrapWithStdinPipe } from './standard-command';

const BASE_CTX = {
  cli: '/usr/bin/myagent',
  autoApprove: false,
  model: 'gpt-4',
};

describe('buildStandardCommand', () => {
  it('fresh session with positional prompt flag', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, initialPrompt: 'hello world' },
      { initialPromptFlag: '' }
    );
    expect(cmd.command).toBe('/usr/bin/myagent');
    expect(cmd.args).toEqual(['hello world']);
    expect(cmd.env).toEqual({});
  });

  it('fresh session with named prompt flag', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, initialPrompt: 'do things' },
      { initialPromptFlag: '-i' }
    );
    expect(cmd.args).toEqual(['-i', 'do things']);
  });

  it('fresh session with default args', () => {
    const cmd = buildStandardCommand({ ...BASE_CTX }, { defaultArgs: ['run', '-s'] });
    expect(cmd.args).toEqual(['run', '-s']);
  });

  it('fresh session with sessionId and non-resume-only flag', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, sessionId: 'uuid-123' },
      { sessionIdFlag: '--session-id', initialPromptFlag: '' }
    );
    expect(cmd.args).toContain('--session-id');
    expect(cmd.args).toContain('uuid-123');
  });

  it('fresh session with sessionIdOnResumeOnly skips sessionId', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, sessionId: 'uuid-123', isResuming: false },
      { sessionIdFlag: '-S', sessionIdOnResumeOnly: true }
    );
    expect(cmd.args).not.toContain('-S');
    expect(cmd.args).not.toContain('uuid-123');
  });

  it('fresh session with newConversationFlag', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, isResuming: false },
      { newConversationFlag: '--new' }
    );
    expect(cmd.args).toContain('--new');
  });

  it('resume with resumeFlag (no sessionId)', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, isResuming: true },
      { resumeFlag: '--continue' }
    );
    expect(cmd.args).toContain('--continue');
  });

  it('resume with sessionId passes it to resumeFlag', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, isResuming: true, sessionId: 'abc-123' },
      { resumeFlag: '--resume', sessionIdFlag: '--resume' }
    );
    expect(cmd.args).toEqual(['--resume', 'abc-123']);
  });

  it('resume with sessionIdOnResumeOnly and no sessionId uses resumeWithoutSessionFlag', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, isResuming: true, sessionId: undefined },
      {
        resumeFlag: 'resume',
        sessionIdFlag: ' ',
        sessionIdOnResumeOnly: true,
        resumeWithoutSessionFlag: 'resume --last',
      }
    );
    expect(cmd.args).toContain('resume --last');
  });

  it('auto-approve appends the flag', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, autoApprove: true },
      { autoApproveFlag: '--dangerously-skip-permissions' }
    );
    expect(cmd.args).toContain('--dangerously-skip-permissions');
  });

  it('auto-approve with multi-part flag', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, autoApprove: true },
      { autoApproveFlag: '--approval-mode=yolo --skip-trust' }
    );
    expect(cmd.args).toContain('--approval-mode=yolo');
    expect(cmd.args).toContain('--skip-trust');
  });

  it('omitAutoApproveOnResume skips flag on resume', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, autoApprove: true, isResuming: true },
      { autoApproveFlag: '--yolo', resumeFlag: '-C', omitAutoApproveOnResume: true }
    );
    expect(cmd.args).not.toContain('--yolo');
    expect(cmd.args).toContain('-C');
  });

  it('deduplicateFlags removes duplicates', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, autoApprove: true, extraArgs: ['--dedup-flag', '--other'] },
      {
        autoApproveFlag: '--dedup-flag',
        deduplicateFlags: ['--dedup-flag'],
      }
    );
    const count = cmd.args.filter((a) => a === '--dedup-flag').length;
    expect(count).toBe(1);
    expect(cmd.args).toContain('--other');
  });

  it('validateSessionId rejects invalid session on resume, falls back to resumeWithoutSessionFlag', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, isResuming: true, sessionId: 'invalid-id' },
      {
        resumeFlag: '--session',
        sessionIdFlag: '--session',
        sessionIdOnResumeOnly: true,
        resumeWithoutSessionFlag: '--continue',
        validateSessionId: (id) => id.startsWith('ses'),
      }
    );
    expect(cmd.args).toContain('--continue');
    expect(cmd.args).not.toContain('invalid-id');
  });

  it('validateSessionId accepts valid session on resume', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, isResuming: true, sessionId: 'ses_abc123' },
      {
        resumeFlag: '--session',
        sessionIdFlag: '--session',
        sessionIdOnResumeOnly: true,
        resumeWithoutSessionFlag: '--continue',
        validateSessionId: (id) => id.startsWith('ses'),
      }
    );
    expect(cmd.args).toContain('--session');
    expect(cmd.args).toContain('ses_abc123');
  });

  it('extraEnv is merged into the command env', () => {
    const cmd = buildStandardCommand({ ...BASE_CTX }, { extraEnv: { PLUGINS: 'all' } });
    expect(cmd.env).toEqual({ PLUGINS: 'all' });
  });

  it('stdin-pipe flag triggers wrapWithStdinPipe', () => {
    const cmd = buildStandardCommand(
      { ...BASE_CTX, initialPrompt: 'do stuff' },
      { initialPromptViaStdinPipe: true }
    );
    expect(cmd.command).toBe('bash');
    expect(cmd.args[0]).toBe('-c');
    expect(cmd.args[1]).toContain('do stuff');
  });
});

describe('wrapWithStdinPipe', () => {
  it('wraps command with stdin pipe', () => {
    const original = { command: 'amp', args: ['--flag'], env: {} };
    const wrapped = wrapWithStdinPipe(original, 'my prompt');
    expect(wrapped.command).toBe('bash');
    expect(wrapped.args[0]).toBe('-c');
    expect(wrapped.args[1]).toContain('amp');
    expect(wrapped.args[1]).toContain('my prompt');
  });

  it('quotes special characters in prompt', () => {
    const original = { command: 'agent', args: [], env: {} };
    const wrapped = wrapWithStdinPipe(original, "it's a test");
    expect(wrapped.args[1]).toContain("it'\\''s a test");
  });
});
