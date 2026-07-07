import type { Unsubscribe } from '@emdash/shared';
import { z } from 'zod';
import { LiveJobServer } from '../../src/live/job/index';
import {
  liveJobStateSchema,
  type LiveJobState,
  type LiveSnapshot,
  type LiveUpdate,
} from '../../src/live/protocol/index';

const inputSchema = z.object({ name: z.string() });
const progressSchema = z.object({ step: z.string() });
const resultSchema = z.object({ message: z.string() });
const errorSchema = z.object({ message: z.string() });

type Input = z.infer<typeof inputSchema>;
type Progress = z.infer<typeof progressSchema>;
type Result = z.infer<typeof resultSchema>;
type ErrorState = z.infer<typeof errorSchema>;

export const jobStateSchema = liveJobStateSchema(progressSchema, resultSchema, errorSchema);

const successfulJobs = new LiveJobServer<Input, Progress, Result, ErrorState>(
  async (input, ctx) => {
    await delay();
    ctx.progress({ step: 'checkout' });
    await delay();
    ctx.progress({ step: 'build' });
    return { message: `Finished ${input.name}` };
  },
  toError
);

const cancellableJobs = new LiveJobServer<Input, Progress, Result, ErrorState>(
  async (_input, ctx) => {
    await new Promise<never>((_resolve, reject) => {
      ctx.signal.addEventListener('abort', () => reject(new Error('cancelled by user')), {
        once: true,
      });
    });
    return { message: 'unreachable' };
  },
  toError
);

export function startSuccessfulJob(): string {
  return successfulJobs.start({ name: 'demo job' }).jobId;
}

export function startCancellableJob(): string {
  return cancellableJobs.start({ name: 'cancel me' }).jobId;
}

export function cancelCancellableJob(jobId: string): void {
  cancellableJobs.cancel(jobId);
}

export function disposeJobServers(): void {
  successfulJobs.dispose();
  cancellableJobs.dispose();
}

export async function fetchSuccessfulSnapshot(
  jobId: string
): Promise<LiveSnapshot<LiveJobState<Progress, Result, ErrorState>>> {
  return getJob(successfulJobs, jobId).snapshot();
}

export async function fetchCancellableSnapshot(
  jobId: string
): Promise<LiveSnapshot<LiveJobState<Progress, Result, ErrorState>>> {
  return getJob(cancellableJobs, jobId).snapshot();
}

export function attachSuccessful(jobId: string, push: (update: LiveUpdate) => void): Unsubscribe {
  return getJob(successfulJobs, jobId).subscribe(push);
}

export function attachCancellable(jobId: string, push: (update: LiveUpdate) => void): Unsubscribe {
  return getJob(cancellableJobs, jobId).subscribe(push);
}

function getJob(server: LiveJobServer<Input, Progress, Result, ErrorState>, jobId: string) {
  const model = server.job(jobId);
  if (!model) throw new Error(`Missing job ${jobId}`);
  return model;
}

function toError(err: unknown): ErrorState {
  return { message: err instanceof Error ? err.message : String(err) };
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
