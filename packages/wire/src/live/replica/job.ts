import type { PendingLease, Unsubscribe } from '@emdash/shared';
import type { z } from 'zod';
import type { ThinJob } from '../../api/client';
import type { JobEndpointDef, JobError, JobInput, JobProgress, JobResult } from '../../api/define';
import type { WireInstrumentation } from '../../observability';
import { createManagedSource } from '../../util/managed-source';
import { LiveJobCancelledError, LiveJobClient, LiveJobFailedError } from '../job';
import { LiveModel } from '../model';
import { stableStringify } from '../mutations';
import { liveJobStateSchema } from '../protocol';
import type { LiveJobState, LiveSnapshot, LiveSource, LiveUpdate } from '../protocol';
import { managedLiveSource } from './source';

export type ReplicaJobOptions = {
  instrumentation?: WireInstrumentation;
};

export class ReplicaJob<Def extends JobEndpointDef = JobEndpointDef> implements LiveSource {
  readonly jobId: string;
  readonly ready: Promise<void>;
  readonly result: Promise<JobResult<Def>>;

  private readonly client: LiveJobClient<JobProgress<Def>, JobResult<Def>, JobError<Def>>;
  private local:
    | LiveModel<LiveJobState<JobProgress<Def>, JobResult<Def>, JobError<Def>>>
    | undefined;
  private readonly detachPromise: Promise<Unsubscribe>;
  private seeding = false;
  private detached = false;
  private disposed = false;

  constructor(
    private readonly job: ThinJob<Def>,
    jobId: string,
    options: ReplicaJobOptions = {}
  ) {
    this.jobId = jobId;
    const handle = this.job.handle(jobId);
    const stateSchema = liveJobStateSchema(
      this.job.def.progress,
      this.job.def.result,
      this.job.def.error
    ) as z.ZodType<LiveJobState<JobProgress<Def>, JobResult<Def>, JobError<Def>>>;
    this.client = new LiveJobClient<JobProgress<Def>, JobResult<Def>, JobError<Def>>(stateSchema, {
      refetchSnapshot: () =>
        handle.snapshot() as Promise<
          LiveSnapshot<LiveJobState<JobProgress<Def>, JobResult<Def>, JobError<Def>>>
        >,
      onState: (state) => this.handleState(state),
      instrumentation: options.instrumentation,
      topic: handle.topic,
    });
    this.result = this.client.result;
    this.ready = handle.snapshot().then((snapshot) => {
      this.local = new LiveModel(
        structuredClone(snapshot.data) as LiveJobState<
          JobProgress<Def>,
          JobResult<Def>,
          JobError<Def>
        >
      );
      this.seeding = true;
      try {
        this.client.seed(
          snapshot as LiveSnapshot<LiveJobState<JobProgress<Def>, JobResult<Def>, JobError<Def>>>
        );
      } finally {
        this.seeding = false;
      }
    });
    this.detachPromise = handle.attach((update) => this.client.applyUpdate(update), {
      onReattach: () => void this.client.refresh(),
    });
    void this.result.catch(() => undefined);
  }

  getState(): LiveJobState<JobProgress<Def>, JobResult<Def>, JobError<Def>> | undefined {
    return this.local?.snapshot().data ?? this.client.getState();
  }

  onProgress(cb: (progress: JobProgress<Def>) => void): Unsubscribe {
    return this.client.onProgress(cb);
  }

  cancel(): Promise<void> {
    return this.job.cancel(this.jobId);
  }

  async snapshot(): Promise<
    LiveSnapshot<LiveJobState<JobProgress<Def>, JobResult<Def>, JobError<Def>>>
  > {
    await this.ready;
    return this.localSource().snapshot();
  }

  subscribe(cb: (update: LiveUpdate) => void): Unsubscribe {
    return this.localSource().subscribe(cb);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.detachUpstream();
    this.client.dispose();
  }

  private handleState(state: LiveJobState<JobProgress<Def>, JobResult<Def>, JobError<Def>>): void {
    if (this.seeding) {
      if (state.status !== 'running') void this.detachUpstream();
      return;
    }

    const local = this.local;
    if (local) {
      local.produce(() => structuredClone(state));
    }
    if (state.status !== 'running') void this.detachUpstream();
  }

  private async detachUpstream(): Promise<void> {
    if (this.detached) return;
    this.detached = true;
    (await this.detachPromise)();
  }

  private localSource(): LiveModel<LiveJobState<JobProgress<Def>, JobResult<Def>, JobError<Def>>> {
    if (!this.local) throw new Error('ReplicaJob is not ready');
    return this.local;
  }
}

export type LiveJobReplicaOptions = ReplicaJobOptions & {
  retentionMs?: number;
};

export type LiveJobReplica<Def extends JobEndpointDef = JobEndpointDef> = {
  readonly kind: 'liveJobReplica';
  readonly def: Def;
  start(input: JobInput<Def>): Promise<PendingLease<ReplicaJob<Def>>>;
  acquire(jobId: string): PendingLease<ReplicaJob<Def>>;
  peek(jobId: string): ReplicaJob<Def> | undefined;
  resolve(jobId: string): LiveSource;
  cancel(jobId: string): Promise<void>;
  dispose(): Promise<void>;
};

export function createLiveJobReplica<Def extends JobEndpointDef>(
  def: Def,
  job: ThinJob<Def>,
  options: LiveJobReplicaOptions = {}
): LiveJobReplica<Def> {
  const source = createManagedSource<string, ReplicaJob<Def>>({
    key: stableStringify,
    graceMs: options.retentionMs,
    async create(jobId, scope) {
      const replica = new ReplicaJob(job, jobId, options);
      scope.add(() => replica.dispose());
      await replica.ready;
      return replica;
    },
  });

  return {
    kind: 'liveJobReplica',
    def,
    async start(input) {
      const { jobId } = await job.start(input);
      return source.acquire(jobId);
    },
    acquire(jobId) {
      return source.acquire(jobId);
    },
    peek(jobId) {
      return source.peek(jobId);
    },
    resolve(jobId) {
      return managedLiveSource(source, jobId, (replica) => replica);
    },
    cancel(jobId) {
      return job.cancel(jobId);
    },
    dispose() {
      return source.dispose();
    },
  };
}

export function isLiveJobReplica(value: unknown): value is LiveJobReplica {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'liveJobReplica'
  );
}

export { LiveJobCancelledError, LiveJobFailedError };
