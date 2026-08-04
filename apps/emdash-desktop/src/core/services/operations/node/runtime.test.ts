import { ManualClock } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { runOperationStage, stageOk, terminal } from './runtime';

describe('runOperationStage', () => {
  it('treats stage timeouts as retryable failures', async () => {
    const clock = new ManualClock(0);
    const parent = new AbortController();
    const promise = runOperationStage(
      {
        input: {},
        operationId: 'operation-1',
        attempt: 0,
        signal: parent.signal,
        stage: async (_id, _label, work) =>
          work({ signal: parent.signal, progress: vi.fn(), fail: vi.fn() }),
        run: vi.fn(),
        spawn: vi.fn(),
        reject: vi.fn((error) => {
          throw error;
        }),
        fact: vi.fn(),
      },
      {
        id: 'slow-stage',
        timeoutMs: 10,
        clock,
        run: async (signal) => {
          await clock.sleep(1_000, { signal });
          return stageOk();
        },
      }
    );

    await clock.advanceBy(10);

    await expect(promise).rejects.toMatchObject({
      code: 'operation-timeout',
      retryable: true,
    });
  });

  it('rejects terminal stage outcomes without throwing a retryable error', async () => {
    const reject = vi.fn((error) => {
      throw error;
    });

    await expect(
      runOperationStage(
        {
          input: {},
          operationId: 'operation-1',
          attempt: 0,
          signal: new AbortController().signal,
          stage: async (_id, _label, work) =>
            work({
              signal: new AbortController().signal,
              progress: vi.fn(),
              fail: vi.fn(),
            }),
          run: vi.fn(),
          spawn: vi.fn(),
          reject,
          fact: vi.fn(),
        },
        {
          id: 'terminal-stage',
          timeoutMs: 10,
          clock: new ManualClock(0),
          run: async () => terminal('invalid path', 'invalid-host-path'),
        }
      )
    ).rejects.toMatchObject({
      type: 'failed',
      code: 'invalid-host-path',
      retryable: false,
    });
    expect(reject).toHaveBeenCalledOnce();
  });
});
