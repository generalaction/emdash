import { LiveJobCancelledError, LiveJobClient } from '../../src/live/job/index';
import {
  attachCancellable,
  attachSuccessful,
  cancelCancellableJob,
  disposeJobServers,
  fetchCancellableSnapshot,
  fetchSuccessfulSnapshot,
  jobStateSchema,
  startCancellableJob,
  startSuccessfulJob,
} from './server';

async function main(): Promise<void> {
  try {
    await runSuccessfulJob();
    await runCancelledJob();
  } finally {
    disposeJobServers();
  }
}

async function runSuccessfulJob(): Promise<void> {
  const jobId = startSuccessfulJob();
  const client = new LiveJobClient(jobStateSchema, {
    refetchSnapshot: () => fetchSuccessfulSnapshot(jobId),
    onState: (state) => console.log('job state:', state.status),
  });
  client.onProgress((progress) => console.log('job progress:', progress.step));
  client.seed(await fetchSuccessfulSnapshot(jobId));
  const detach = await attachSuccessful(jobId, (update) => client.applyUpdate(update));

  console.log('job result:', await client.result);
  detach();
}

async function runCancelledJob(): Promise<void> {
  const jobId = startCancellableJob();
  const client = new LiveJobClient(jobStateSchema, {
    refetchSnapshot: () => fetchCancellableSnapshot(jobId),
  });
  client.seed(await fetchCancellableSnapshot(jobId));
  const detach = await attachCancellable(jobId, (update) => client.applyUpdate(update));

  const result = client.result.catch((error: unknown) => error);
  cancelCancellableJob(jobId);
  const error = await result;

  if (error instanceof LiveJobCancelledError) {
    console.log('job cancelled:', error.name);
  } else {
    throw error;
  }

  detach();
}

void main();
