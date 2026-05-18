import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recentCallsRing } from '../recent-calls';
import { formatErr, formatOk, withRecording } from './_helpers';

// `recent-calls.ts` imports the main-process event emitter, which in turn
// pulls in Electron + the DB client. Stub it so the helpers test stays a
// pure unit test.
vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn(), on: vi.fn(), once: vi.fn() },
}));

/**
 * `withRecording` is the only seam between the tool layer and the recent-calls
 * ring buffer. These tests confirm the end-to-end wiring: an invocation
 * produces a ring entry with the right status / error fields, and thrown
 * exceptions are normalised into an `UNHANDLED` reply (still recorded).
 */
describe('withRecording', () => {
  beforeEach(() => {
    recentCallsRing.clear();
  });

  afterEach(() => {
    recentCallsRing.clear();
  });

  it('records a successful invocation as status=ok', async () => {
    const wrapped = withRecording('task.list', async () => formatOk({ tasks: [] }));
    const reply = await wrapped({});
    expect('isError' in reply ? reply.isError : false).toBe(false);
    const snap = recentCallsRing.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ tool: 'task.list', status: 'ok' });
    expect(snap[0]?.errorCode).toBeUndefined();
    expect(snap[0]?.id).toBeTruthy();
    expect(snap[0]?.ts).toBeGreaterThan(0);
  });

  it('records an MCP error reply as status=error, extracting code/message', async () => {
    const wrapped = withRecording('task.delete', async () =>
      formatErr('CONFIRM_REQUIRED', 'Set confirm: true to delete this task', { taskId: 't1' })
    );
    const reply = await wrapped({});
    expect('isError' in reply && reply.isError).toBe(true);
    const snap = recentCallsRing.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      tool: 'task.delete',
      status: 'error',
      errorCode: 'CONFIRM_REQUIRED',
      errorMessage: 'Set confirm: true to delete this task',
    });
  });

  it('records thrown exceptions as UNHANDLED errors and never rejects', async () => {
    const wrapped = withRecording('task.create', async () => {
      throw new Error('explode');
    });
    const reply = await wrapped({});
    expect('isError' in reply && reply.isError).toBe(true);
    const snap = recentCallsRing.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      tool: 'task.create',
      status: 'error',
      errorCode: 'UNHANDLED',
      errorMessage: 'explode',
    });
  });

  it('measures handler duration roughly accurately', async () => {
    const wrapped = withRecording('task.slow', async () => {
      await new Promise((r) => setTimeout(r, 20));
      return formatOk(null);
    });
    await wrapped({});
    const snap = recentCallsRing.snapshot();
    expect(snap[0]?.ms).toBeGreaterThanOrEqual(15);
  });
});
