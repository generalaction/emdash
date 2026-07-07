import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LiveJobCancelledError, type LiveJobContext } from '../live/job';
import { bindContract } from './bind';
import { contractClient } from './client';
import { connect } from './connect';
import { defineContract, job } from './define';
import { serve } from './serve';
import { memoryTransportPair } from './transports';

const jobContract = defineContract({
  build: job({
    input: z.object({ name: z.string() }),
    progress: z.object({ step: z.string() }),
    result: z.object({ artifact: z.string() }),
    error: z.object({ message: z.string() }),
  }),
});

type BuildInput = { name: string };
type BuildProgress = { step: string };
type BuildResult = { artifact: string };

describe('contract jobs', () => {
  it('starts a job, streams progress, and resolves the result', async () => {
    const gate = deferred<void>();
    const { client } = setup(async (input, ctx) => {
      await gate.promise;
      ctx.progress({ step: 'build' });
      return { artifact: `${input.name}.zip` };
    });

    const handle = await client.build.start({ name: 'demo' });
    await handle.ready;
    const progress: Array<{ step: string }> = [];
    handle.onProgress((entry) => progress.push(entry));
    gate.resolve();

    await expect(handle.result).resolves.toEqual({ artifact: 'demo.zip' });
    expect(progress).toEqual([{ step: 'build' }]);
  });

  it('cancels a running job', async () => {
    const { client } = setup(
      async (_input, ctx) =>
        new Promise((resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
          setTimeout(() => resolve({ artifact: 'late.zip' }), 10);
        })
    );

    const handle = await client.build.start({ name: 'cancel' });
    await handle.ready;
    await handle.cancel();

    await expect(handle.result).rejects.toBeInstanceOf(LiveJobCancelledError);
  });

  it('reattaches to a terminal job state by id', async () => {
    const gate = deferred<void>();
    const { client } = setup(async (input) => {
      await gate.promise;
      return { artifact: `${input.name}.zip` };
    });

    const handle = await client.build.start({ name: 'reattach' });
    gate.resolve();
    await expect(handle.result).resolves.toEqual({ artifact: 'reattach.zip' });

    const reattached = await client.build.attach(handle.jobId);
    await reattached.ready;

    await expect(reattached.result).resolves.toEqual({ artifact: 'reattach.zip' });
  });

  it('cancels running jobs when the controller is disposed', async () => {
    const { client, controller } = setup(
      async (_input, ctx) =>
        new Promise((resolve, reject) => {
          ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
          setTimeout(() => resolve({ artifact: 'late.zip' }), 10);
        })
    );

    const handle = await client.build.start({ name: 'dispose' });
    await handle.ready;
    controller.dispose?.();

    await expect(handle.result).rejects.toBeInstanceOf(LiveJobCancelledError);
  });

  it('validates job start input in full validation mode', async () => {
    const { client } = setup(async (input) => ({ artifact: `${input.name}.zip` }), {
      validate: 'full',
    });

    await expect(client.build.start({ name: 1 } as never)).rejects.toMatchObject({
      code: 'ERROR',
    });
  });
});

function setup(
  run: (
    input: BuildInput,
    ctx: LiveJobContext<BuildProgress>
  ) => Promise<BuildResult> | BuildResult,
  options: { validate?: 'none' | 'inputs' | 'full' } = {}
) {
  const pair = memoryTransportPair();
  const controller = bindContract(jobContract, {
    validate: options.validate,
    impl: {
      build: {
        run,
        toError: (error) => ({
          message: error instanceof Error ? error.message : String(error),
        }),
      },
    },
  });
  serve(pair.right, controller);
  const client = contractClient(jobContract, connect(pair.left));
  return { client, controller };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}
