import type { Unsubscribe } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { liveJobStateSchema } from '../protocol';
import { LiveJobCancelledError, LiveJobClient, LiveJobFailedError } from './client';
import { LIVE_JOB_TERMINAL_RETAIN_MS, LiveJobServer, type LiveJobContext } from './server';

const inputSchema = z.object({ name: z.string() });
const progressSchema = z.object({ step: z.number() });
const resultSchema = z.object({ ok: z.boolean() });
const errorSchema = z.object({ message: z.string() });
const stateSchema = liveJobStateSchema(progressSchema, resultSchema, errorSchema);

type Input = z.infer<typeof inputSchema>;
type Progress = z.infer<typeof progressSchema>;
type Result = z.infer<typeof resultSchema>;
type ErrorState = z.infer<typeof errorSchema>;

function toError(err: unknown): ErrorState {
  return { message: err instanceof Error ? err.message : String(err) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function attach(server: LiveJobServer<Input, Progress, Result, ErrorState>, jobId: string) {
  const model = server.job(jobId);
  if (!model) throw new Error(`Missing job ${jobId}`);

  const refetchSnapshot = vi.fn(async () => model.snapshot());
  const onState = vi.fn<(state: z.infer<typeof stateSchema>) => void>();
  const onProgress = vi.fn<(progress: Progress) => void>();
  const client = new LiveJobClient<Progress, Result, ErrorState>(stateSchema, {
    refetchSnapshot,
    onState,
  });

  client.onProgress(onProgress);
  client.seed(model.snapshot());
  let unsubscribe: Unsubscribe = model.subscribe((update) => client.applyUpdate(update));

  return {
    client,
    model,
    onProgress,
    onState,
    refetchSnapshot,
    unsubscribe: () => unsubscribe(),
    resubscribe: () => {
      unsubscribe = model.subscribe((update) => client.applyUpdate(update));
    },
  };
}

describe('LiveJobServer and LiveJobClient', () => {
  it('streams progress and resolves the result', async () => {
    const begin = deferred<void>();
    const server = new LiveJobServer<Input, Progress, Result, ErrorState>(async (_input, ctx) => {
      await begin.promise;
      ctx.progress({ step: 1 });
      ctx.progress({ step: 2 });
      return { ok: true };
    }, toError);
    const { jobId } = server.start({ name: 'success' });
    const { client, onProgress } = attach(server, jobId);

    begin.resolve();

    await expect(client.result).resolves.toEqual({ ok: true });
    expect(onProgress).toHaveBeenNthCalledWith(1, { step: 1 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { step: 2 });
    expect(client.getState()).toEqual({ status: 'succeeded', result: { ok: true } });
  });

  it('maps handler failures into failed state', async () => {
    const begin = deferred<void>();
    const server = new LiveJobServer<Input, Progress, Result, ErrorState>(async () => {
      await begin.promise;
      throw new Error('boom');
    }, toError);
    const { jobId } = server.start({ name: 'failure' });
    const { client } = attach(server, jobId);
    const result = client.result.catch((err: unknown) => err);

    begin.resolve();
    const err = await result;

    expect(err).toBeInstanceOf(LiveJobFailedError);
    expect((err as LiveJobFailedError<ErrorState>).error).toEqual({ message: 'boom' });
    expect(client.getState()).toEqual({ status: 'failed', error: { message: 'boom' } });
  });

  it('cancels cooperatively through the job signal', async () => {
    let signal: AbortSignal | undefined;
    const server = new LiveJobServer<Input, Progress, Result, ErrorState>(async (_input, ctx) => {
      signal = ctx.signal;
      await new Promise<never>((_resolve, reject) => {
        ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      return { ok: true };
    }, toError);
    const { jobId } = server.start({ name: 'cancel' });
    const { client } = attach(server, jobId);
    const result = client.result.catch((err: unknown) => err);

    server.cancel(jobId);
    const err = await result;

    expect(signal?.aborted).toBe(true);
    expect(err).toBeInstanceOf(LiveJobCancelledError);
    expect(client.getState()).toEqual({ status: 'cancelled' });
  });

  it('bounds retained progress while keeping progressCount monotonic', async () => {
    const begin = deferred<void>();
    const finish = deferred<Result>();
    const server = new LiveJobServer<Input, Progress, Result, ErrorState>(async (_input, ctx) => {
      await begin.promise;
      for (let step = 0; step < 105; step += 1) {
        ctx.progress({ step });
      }
      return finish.promise;
    }, toError);
    const { jobId } = server.start({ name: 'progress-cap' });
    const { client } = attach(server, jobId);

    begin.resolve();
    await vi.waitFor(() => {
      expect(client.getState()).toMatchObject({ status: 'running', progressCount: 105 });
    });

    const state = client.getState();
    expect(state?.status).toBe('running');
    if (state?.status === 'running') {
      expect(state.progress).toHaveLength(100);
      expect(state.progress[0]).toEqual({ step: 5 });
      expect(state.progress.at(-1)).toEqual({ step: 104 });
      expect(state.progressCount).toBe(105);
    }

    finish.resolve({ ok: true });
    await expect(client.result).resolves.toEqual({ ok: true });
  });

  it('allows a client to attach to an already-running job', async () => {
    let ctx: LiveJobContext<Progress> | undefined;
    const finish = deferred<Result>();
    const server = new LiveJobServer<Input, Progress, Result, ErrorState>(
      async (_input, jobCtx) => {
        ctx = jobCtx;
        jobCtx.progress({ step: 1 });
        return finish.promise;
      },
      toError
    );
    const { jobId } = server.start({ name: 'late-attach' });

    await vi.waitFor(() => expect(ctx).toBeDefined());
    const { client, onProgress } = attach(server, jobId);

    expect(onProgress).not.toHaveBeenCalled();
    expect(client.getState()).toMatchObject({ status: 'running', progressCount: 1 });

    ctx?.progress({ step: 2 });
    finish.resolve({ ok: true });

    await expect(client.result).resolves.toEqual({ ok: true });
    expect(onProgress).toHaveBeenCalledWith({ step: 2 });
  });

  it('resyncs on sequence gaps without re-emitting already seen progress', async () => {
    let ctx: LiveJobContext<Progress> | undefined;
    const finish = deferred<Result>();
    const server = new LiveJobServer<Input, Progress, Result, ErrorState>(
      async (_input, jobCtx) => {
        ctx = jobCtx;
        return finish.promise;
      },
      toError
    );
    const { jobId } = server.start({ name: 'resync' });
    const { client, onProgress, refetchSnapshot, unsubscribe, resubscribe } = attach(server, jobId);

    await vi.waitFor(() => expect(ctx).toBeDefined());
    ctx?.progress({ step: 1 });
    expect(onProgress).toHaveBeenCalledTimes(1);

    unsubscribe();
    ctx?.progress({ step: 2 });
    ctx?.progress({ step: 3 });
    resubscribe();
    ctx?.progress({ step: 4 });

    await vi.waitFor(() => expect(refetchSnapshot).toHaveBeenCalledTimes(1));
    expect(onProgress).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenNthCalledWith(1, { step: 1 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { step: 2 });
    expect(onProgress).toHaveBeenNthCalledWith(3, { step: 3 });
    expect(onProgress).toHaveBeenNthCalledWith(4, { step: 4 });

    finish.resolve({ ok: true });
    await expect(client.result).resolves.toEqual({ ok: true });
  });

  it('evicts terminal jobs after the fixed grace period', async () => {
    vi.useFakeTimers({ now: 1000 });
    try {
      const server = new LiveJobServer<Input, Progress, Result, ErrorState>(
        async () => ({ ok: true }),
        toError
      );
      const { jobId } = server.start({ name: 'evict' });

      await Promise.resolve();
      expect(server.job(jobId)?.snapshot().data).toEqual({
        status: 'succeeded',
        result: { ok: true },
      });

      vi.advanceTimersByTime(LIVE_JOB_TERMINAL_RETAIN_MS);

      expect(server.job(jobId)).toBeUndefined();
      expect(() => server.cancel('missing')).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});
