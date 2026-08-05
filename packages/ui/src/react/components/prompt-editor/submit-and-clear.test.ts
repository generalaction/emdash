import { describe, expect, it, vi } from 'vitest';
import { submitAndClearUnchanged } from './submit-and-clear';

describe('submitAndClearUnchanged', () => {
  it('does not clear after an edit or second submit while the first prompt is preparing', async () => {
    let resolveSubmission: (accepted: boolean) => void = () => {};
    const submission = new Promise<boolean>((resolve) => {
      resolveSubmission = resolve;
    });
    let version = 1;
    const clear = vi.fn();

    const pending = submitAndClearUnchanged(
      'same prompt',
      version,
      () => submission,
      () => version,
      clear
    );
    version += 1;
    resolveSubmission(true);
    await pending;

    expect(clear).not.toHaveBeenCalled();
  });

  it('retains the prompt when submission is rejected', async () => {
    const clear = vi.fn();

    await submitAndClearUnchanged(
      'retry me',
      1,
      () => false,
      () => 1,
      clear
    );

    expect(clear).not.toHaveBeenCalled();
  });
});
