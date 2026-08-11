import { err, ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import {
  captureDevPerfTrace,
  TRACE_CAPTURE_DURATION_MS,
  type TraceCaptureOutcome,
} from './capture-trace';
import { configureDevPerfClient, type DevPerfRpcClient } from './client';

function configureCaptureTrace(impl: DevPerfRpcClient['captureTrace']): {
  calls: Array<{ durationMs?: number }>;
} {
  const calls: Array<{ durationMs?: number }> = [];
  configureDevPerfClient(async () => {
    return {
      captureTrace: async (input: { durationMs?: number }) => {
        calls.push(input);
        return impl(input);
      },
    } as unknown as DevPerfRpcClient;
  });
  return { calls };
}

describe('captureDevPerfTrace', () => {
  it('requests the shared duration and returns the trace path on success', async () => {
    const { calls } = configureCaptureTrace(async () => ok({ path: '/tmp/trace.json' }));

    const outcome = await captureDevPerfTrace();

    expect(calls).toEqual([{ durationMs: TRACE_CAPTURE_DURATION_MS }]);
    expect(outcome).toEqual({ ok: true, path: '/tmp/trace.json' } satisfies TraceCaptureOutcome);
  });

  it('maps the expected in-progress failure to a user-presentable message', async () => {
    configureCaptureTrace(async () => err({ type: 'trace_in_progress' as const }));

    const outcome = await captureDevPerfTrace();

    expect(outcome).toEqual({ ok: false, message: 'A trace capture is already in progress' });
  });

  it('normalizes transport-level throws into a failure outcome', async () => {
    configureCaptureTrace(async () => {
      throw new Error('wire disconnected');
    });

    const outcome = await captureDevPerfTrace();

    expect(outcome).toEqual({ ok: false, message: 'wire disconnected' });
  });
});
