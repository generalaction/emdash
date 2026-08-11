import { describe, expect, it } from 'vitest';
import { formatAutomationError } from './automation-run-format';

describe('formatAutomationError', () => {
  it('formats a typed definition error wrapped as an Error cause', () => {
    const cause = {
      type: 'invalid-definition',
      reason: 'conversation_config_prompt_required',
      message: 'Prompt required',
    } as const;

    expect(formatAutomationError(new Error(cause.message, { cause }))).toBe(
      'Add a prompt before saving'
    );
  });

  it('formats typed adoption errors', () => {
    expect(
      formatAutomationError({
        type: 'run-not-adoptable',
        runId: 'run-1',
        message: 'Not ready',
      })
    ).toBe('The automation workspace is not ready yet');
  });

  it('preserves free-form runtime messages', () => {
    expect(
      formatAutomationError({ type: 'runtime-unavailable', message: 'Host disconnected' })
    ).toBe('Host disconnected');
  });

  it('keeps the legacy local cron validation mapping', () => {
    expect(formatAutomationError(new Error('cron_invalid'))).toBe('Enter a valid schedule');
  });
});
