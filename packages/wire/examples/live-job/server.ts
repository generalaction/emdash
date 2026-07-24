import { ok, type Unsubscribe } from '@emdash/shared';
import { systemClock } from '@emdash/shared/scheduling';
import { z } from 'zod';
import { LiveJob } from '../../src/live/job/index';
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

const successfulJobs = new LiveJob<Input, Progress, Result, ErrorState>(
  async (input, ctx) => {
    await delay(ctx.signal);
    ctx.progress({ step: 'checkout' });
    await delay(ctx.signal);
    ctx.progress({ step: 'build' });
    return ok({ message: `Finished ${input.name}` });
  },
  { toError, clock: systemClock }
);

const cancellableJobs = new LiveJob<Input, Progress, Result, ErrorState>(
  async (_input, ctx) => {
    await new Promise<never>((_resolve, reject) => {
      ctx.signal.addEventListener('abort', () => reject(new Error('cancelled by user')), {
        once: true,
      });
    });
    return ok({ message: 'unreachable' });
  },
  { toError, clock: systemClock }
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

export async function disposeJobServers(): Promise<void> {
  await successfulJobs.dispose();
  await cancellableJobs.dispose();
}

export async function fetchSuccessfulSnapshot(
  jobId: string
): Promise<LiveSnapshot<LiveJobState<Progress, Result, ErrorState>>> {
  return getSnapshot(successfulJobs, jobId);
}

export async function fetchCancellableSnapshot(
  jobId: string
): Promise<LiveSnapshot<LiveJobState<Progress, Result, ErrorState>>> {
  return getSnapshot(cancellableJobs, jobId);
}

export async function attachSuccessful(
  jobId: string,
  push: (update: LiveUpdate) => void
): Promise<Unsubscribe> {
  return await getSource(successfulJobs, jobId).subscribe(push);
}

export async function attachCancellable(
  jobId: string,
  push: (update: LiveUpdate) => void
): Promise<Unsubscribe> {
  return await getSource(cancellableJobs, jobId).subscribe(push);
}

function getSource(server: LiveJob<Input, Progress, Result, ErrorState>, jobId: string) {
  const source = server.source(jobId);
  if (!source) throw new Error(`Missing job ${jobId}`);
  return source;
}

async function getSnapshot(
  server: LiveJob<Input, Progress, Result, ErrorState>,
  jobId: string
): Promise<LiveSnapshot<LiveJobState<Progress, Result, ErrorState>>> {
  return (await getSource(server, jobId).snapshot()) as LiveSnapshot<
    LiveJobState<Progress, Result, ErrorState>
  >;
}

function toError(err: unknown): ErrorState {
  return { message: err instanceof Error ? err.message : String(err) };
}

function delay(signal: AbortSignal): Promise<void> {
  return systemClock.sleep(0, { signal });
}
