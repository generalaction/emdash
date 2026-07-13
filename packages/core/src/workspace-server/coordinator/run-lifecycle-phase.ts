import { err, ok, type Result } from '@emdash/shared';
import {
  createLiveJobReplica,
  LiveJobCancelledError,
  LiveJobFailedError,
  type LiveJobClientHandle,
} from '@emdash/wire';
import {
  type BootstrapError,
  type BootstrapProgress,
  type BootstrapResult,
  type RunPhaseInput,
  workspaceLifecycleContract,
} from '@services/workspace-lifecycle/api';
import type { CoordinatorStageView } from './schema';

export type WorkspaceLifecycleRunPhaseClient = LiveJobClientHandle<
  typeof workspaceLifecycleContract.runPhase
>;

export type RunLifecyclePhaseOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: CoordinatorStageView['progress']) => void;
};

export async function runLifecyclePhase(
  runPhase: WorkspaceLifecycleRunPhaseClient,
  input: RunPhaseInput,
  options: RunLifecyclePhaseOptions = {}
): Promise<Result<BootstrapResult, BootstrapError>> {
  if (options.signal?.aborted) {
    return {
      success: false,
      error: {
        type: 'cancelled',
        message: 'Workspace lifecycle phase was cancelled',
      },
    };
  }

  const jobs = createLiveJobReplica(workspaceLifecycleContract.runPhase, runPhase);
  const lease = await jobs.start(input);
  const job = await lease.ready();
  const abort = () => void job.cancel();
  const unsubscribe = job.onProgress((progress) => {
    options.onProgress?.(mapLifecycleProgress(progress));
  });
  options.signal?.addEventListener('abort', abort, { once: true });

  try {
    return ok(await job.result);
  } catch (error) {
    if (error instanceof LiveJobFailedError) {
      return err(
        error.error ?? {
          type: 'lifecycle-failed',
          message: 'Workspace lifecycle phase failed',
        }
      );
    }
    if (error instanceof LiveJobCancelledError) {
      return err({
        type: 'cancelled',
        message: 'Workspace lifecycle phase was cancelled',
      });
    }
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', abort);
    unsubscribe();
    await lease.release();
    await jobs.dispose();
  }
}

function mapLifecycleProgress(progress: BootstrapProgress): CoordinatorStageView['progress'] {
  const total = progress.steps.length;
  if (total === 0) return { percent: 100 };

  const terminal = progress.steps.filter(
    (step) => step.status === 'done' || step.status === 'skipped' || step.status === 'failed'
  ).length;
  const running = progress.steps.find((step) => step.status === 'running');
  const failed = progress.steps.find((step) => step.status === 'failed');
  const pending = progress.steps.find((step) => step.status === 'pending');
  const current = running ?? failed ?? pending ?? progress.steps.at(-1);

  return {
    percent: Math.round((terminal / total) * 100),
    message: current?.label,
  };
}
