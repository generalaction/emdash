import { describe, expect, it, vi } from 'vitest';
import { ok, type Result } from '@main/lib/result';
import { sendPromptWithTimeout } from './prompt-timeout';
import type { LoopSessionDriver, LoopSessionDriverError, PromptResult } from './session-driver';

function driverWithHeldPrompt(): LoopSessionDriver {
  return {
    kind: 'acp',
    startPhaseSession: vi.fn(async () => ok({ conversationId: 'phase', title: 'phase' })),
    startVerificationSession: vi.fn(async () =>
      ok({ conversationId: 'verification', title: 'verification' })
    ),
    sendPrompt: vi.fn(
      async (): Promise<Result<PromptResult, LoopSessionDriverError>> =>
        await new Promise<Result<PromptResult, LoopSessionDriverError>>(() => {})
    ),
    cancelPrompt: vi.fn(async () => ok(undefined)),
  };
}

describe('sendPromptWithTimeout', () => {
  it('can leave cancellation to a caller that owns session quiescence', async () => {
    vi.useFakeTimers();
    const driver = driverWithHeldPrompt();
    const resultPromise = sendPromptWithTimeout({
      driver,
      conversationId: 'conversation',
      prompt: 'verify',
      timeoutMs: 25,
      failureMessage: 'failed',
      timeoutLabel: 'Clean-room E2E prompt',
      cancelOnTimeout: false,
    });

    await vi.advanceTimersByTimeAsync(25);
    const result = await resultPromise;

    expect(result).toMatchObject({
      success: false,
      error: { message: 'Clean-room E2E prompt timed out after 1s.' },
    });
    expect(driver.cancelPrompt).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
