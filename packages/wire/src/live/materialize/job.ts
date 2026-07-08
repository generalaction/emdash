import type { Unsubscribe } from '@emdash/shared';
import type { z } from 'zod';
import type { ThinJob } from '../../api/client';
import type { JobEndpointDef, JobInput, JobProgress, JobResult, JobError } from '../../api/define';
import { LiveJobClient } from '../job';
import { liveJobStateSchema } from '../protocol';
import type { LiveJobState, LiveSnapshot, LiveUpdate } from '../protocol';

export type JobHandle<P, R, E> = {
  jobId: string;
  client: LiveJobClient<P, R, E>;
  ready: Promise<void>;
  result: Promise<R>;
  onProgress(cb: (progress: P) => void): Unsubscribe;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
};

export async function startMaterializedJob<Def extends JobEndpointDef>(
  job: ThinJob<Def>,
  input: JobInput<Def>
): Promise<JobHandle<JobProgress<Def>, JobResult<Def>, JobError<Def>>> {
  const started = await job.start(input);
  return materializeJob(job, started.jobId);
}

export function materializeJob<Def extends JobEndpointDef>(
  job: ThinJob<Def>,
  jobId: string
): JobHandle<JobProgress<Def>, JobResult<Def>, JobError<Def>> {
  const handle = job.handle(jobId);
  const stateSchema = liveJobStateSchema(
    job.def.progress,
    job.def.result,
    job.def.error
  ) as z.ZodType<LiveJobState<JobProgress<Def>, JobResult<Def>, JobError<Def>>>;
  const client = new LiveJobClient<JobProgress<Def>, JobResult<Def>, JobError<Def>>(stateSchema, {
    refetchSnapshot: () =>
      handle.snapshot() as Promise<
        LiveSnapshot<LiveJobState<JobProgress<Def>, JobResult<Def>, JobError<Def>>>
      >,
  });
  const ready = handle
    .snapshot()
    .then((snapshot) =>
      client.seed(
        snapshot as LiveSnapshot<LiveJobState<JobProgress<Def>, JobResult<Def>, JobError<Def>>>
      )
    );
  const detach = handle.attach((update: LiveUpdate) => client.applyUpdate(update), {
    onReattach: () => void client.refresh(),
  });
  let disposed = false;

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    (await detach)();
    client.dispose();
  };

  void client.result.then(
    () => dispose(),
    () => dispose()
  );

  return {
    jobId,
    client,
    ready,
    result: client.result,
    onProgress: (cb) => client.onProgress(cb),
    cancel: () => job.cancel(jobId),
    dispose,
  };
}
