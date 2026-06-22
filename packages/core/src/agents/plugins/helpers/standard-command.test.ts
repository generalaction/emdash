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
});
