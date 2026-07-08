import { ok } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bindContract } from '../../api/bind';
import { client } from '../../api/client';
import { connect } from '../../api/connect';
import { defineContract, liveJob } from '../../api/define';
import { serve } from '../../api/serve';
import { memoryTransportPair } from '../../api/transports';
import { type LiveJobContext } from '../job';
import { createLiveJobReplica } from './job';

const api = defineContract({
  build: liveJob({
    input: z.object({ name: z.string() }),
    progress: z.object({ step: z.string() }),
    result: z.object({ artifact: z.string() }),
    error: z.object({ message: z.string() }),
  }),
});

type BuildInput = { name: string };
type BuildProgress = { step: string };
type BuildResult = { artifact: string };

describe('createLiveJobReplica', () => {
  it('starts jobs and retains terminal state for later acquire calls', async () => {
    const gate = deferred<void>();
    const { contractClient } = setup(async (input, ctx) => {
      await gate.promise;
      ctx.progress({ step: 'compile' });
      return { artifact: `${input.name}.zip` };
    });
    const jobs = createLiveJobReplica(api.build, contractClient.build, { retentionMs: 100 });
    const lease = await jobs.start({ name: 'desktop' });
    const running = await lease.ready();
    const progress: BuildProgress[] = [];
    running.onProgress((entry) => progress.push(entry));

    gate.resolve();
    await waitFor(() => progress.length === 1);
    await expect(running.result).resolves.toEqual({ artifact: 'desktop.zip' });
    await lease.release();

    const retainedLease = jobs.acquire(running.jobId);
    const retained = await retainedLease.ready();
    expect(retained.getState()).toMatchObject({
      status: 'succeeded',
      result: { artifact: 'desktop.zip' },
    });

    await retainedLease.release();
    await jobs.dispose();
  });

  it('serves job state through bindContract from the local replica', async () => {
    const { contractClient } = setup(async (input) => ({ artifact: `${input.name}.zip` }));
    const jobs = createLiveJobReplica(api.build, contractClient.build);
    const hopPair = memoryTransportPair();
    serve(hopPair.right, bindContract(api, { build: jobs }));
    const downstream = client(api, connect(hopPair.left));

    const started = await downstream.build.start({ name: 'served' });
    const handle = downstream.build.handle(started.jobId);

    await waitForSnapshot(handle.snapshot, (state) => state.status === 'succeeded');
    expect((await handle.snapshot()).data).toMatchObject({
      status: 'succeeded',
      result: { artifact: 'served.zip' },
    });

    await jobs.dispose();
  });
});

function setup(
  run: (input: BuildInput, ctx: LiveJobContext<BuildProgress>) => Promise<BuildResult> | BuildResult
) {
  const pair = memoryTransportPair();
  const controller = bindContract(api, {
    build: {
      run: async (input, ctx) => ok(await run(input as BuildInput, ctx)),
      toError: (error) => ({
        message: error instanceof Error ? error.message : String(error),
      }),
    },
  });
  serve(pair.right, controller);
  return { contractClient: client(api, connect(pair.left)) };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}

async function waitForSnapshot<T>(
  snapshot: () => Promise<{ data: T }>,
  predicate: (data: T) => boolean
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate((await snapshot()).data)) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for snapshot');
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
