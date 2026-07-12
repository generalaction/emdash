import { ok } from '@emdash/shared';
import { z } from 'zod';
import {
  LiveJobCancelledError,
  createController,
  client,
  connect,
  createLiveJobReplica,
  defineContract,
  liveJob,
  memoryTransportPair,
  serve,
} from '../../src/index';

const api = defineContract({
  build: liveJob({
    input: z.object({ target: z.string() }),
    progress: z.object({ step: z.string() }),
    result: z.object({ artifact: z.string() }),
    error: z.object({ message: z.string() }),
  }),
});

async function main(): Promise<void> {
  const pair = memoryTransportPair();
  const controller = createController(api, {
    build: {
      run: async ({ target }, ctx) => {
        if (target === 'cancelled') await delay(100, ctx.signal);
        await delay(0, ctx.signal);
        ctx.progress({ step: 'compile' });
        await delay(0, ctx.signal);
        ctx.progress({ step: 'package' });
        return ok({ artifact: `${target}.zip` });
      },
      toError: (error) => ({
        message: error instanceof Error ? error.message : String(error),
      }),
    },
  });
  serve(pair.right, controller);
  const contractClient = client(api, connect(pair.left));
  const jobs = createLiveJobReplica(api.build, contractClient.build, { retentionMs: 10_000 });

  const successfulLease = await jobs.start({ target: 'desktop' });
  const successful = await successfulLease.ready();
  successful.onProgress((progress) => console.log('job progress:', progress.step));
  console.log('job result:', await successful.result);
  await successfulLease.release();

  const reattachedLease = jobs.acquire(successful.jobId);
  const reattached = await reattachedLease.ready();
  console.log('reattached result:', await reattached.result);
  await reattachedLease.release();

  const cancellableLease = await jobs.start({ target: 'cancelled' });
  const cancellable = await cancellableLease.ready();
  const cancelled = cancellable.result.catch((error) => error);
  await cancellable.cancel();
  const error = await cancelled;
  if (error instanceof LiveJobCancelledError) {
    console.log('job cancelled:', error.name);
  } else {
    throw error;
  }
  await cancellableLease.release();
  await jobs.dispose();

  await controller.dispose?.();
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true }
    );
  });
}

void main();
