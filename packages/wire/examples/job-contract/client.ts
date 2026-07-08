import { z } from 'zod';
import {
  LiveJobCancelledError,
  bindContract,
  connect,
  contractClient,
  defineContract,
  job,
  memoryTransportPair,
  serve,
} from '../../src/index';

const api = defineContract({
  build: job({
    input: z.object({ target: z.string() }),
    progress: z.object({ step: z.string() }),
    result: z.object({ artifact: z.string() }),
    error: z.object({ message: z.string() }),
  }),
});

async function main(): Promise<void> {
  const pair = memoryTransportPair();
  const controller = bindContract(api, {
    build: {
      run: async ({ target }, ctx) => {
        if (target === 'cancelled') await delay(100, ctx.signal);
        await delay(0, ctx.signal);
        ctx.progress({ step: 'compile' });
        await delay(0, ctx.signal);
        ctx.progress({ step: 'package' });
        return { artifact: `${target}.zip` };
      },
      toError: (error) => ({
        message: error instanceof Error ? error.message : String(error),
      }),
    },
  });
  serve(pair.right, controller);
  const client = contractClient(api, connect(pair.left));

  const successful = await client.build.start({ target: 'desktop' });
  successful.onProgress((progress) => console.log('job progress:', progress.step));
  console.log('job result:', await successful.result);

  const reattached = await client.build.attach(successful.jobId);
  await reattached.ready;
  console.log('reattached result:', await reattached.result);

  const cancellable = await client.build.start({ target: 'cancelled' });
  const cancelled = cancellable.result.catch((error) => error);
  await cancellable.cancel();
  const error = await cancelled;
  if (error instanceof LiveJobCancelledError) {
    console.log('job cancelled:', error.name);
  } else {
    throw error;
  }

  controller.dispose?.();
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
