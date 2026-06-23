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
});
