import type { HostFileRef } from '@primitives/path/api';
import type {
  AutomationRun,
  AutomationRunError,
  AutomationRunErrorStep,
  AutomationRunId,
  AutomationRunStatus,
} from '../api/run';
import type { AutomationRunStore } from './storage/run-store';

export type OnRunChanged = (run: AutomationRun) => void;

type RunTransition = {
  from: AutomationRunStatus[];
  to: AutomationRunStatus;
};

export const INTERRUPTED_BY_RESTART = 'interrupted_by_restart';

/** Statuses owned by an executing run worker. */
export const IN_FLIGHT_RUN_STATUSES = [
  'provisioning_workspace',
  'starting_session',
] as const satisfies readonly AutomationRunStatus[];

const NON_TERMINAL_RUN_STATUSES = [
  'scheduled',
  'queued',
  ...IN_FLIGHT_RUN_STATUSES,
] as const satisfies readonly AutomationRunStatus[];

const IN_FLIGHT_ERROR_STEPS: Partial<Record<AutomationRunStatus, AutomationRunErrorStep>> = {
  provisioning_workspace: 'provision_workspace',
  starting_session: 'start_session',
};

/**
 * Named CAS transitions over the run store. This is the single write path for
 * run state after insertion: every successful transition claims a fresh
 * journal `seq` (via the store) and is reported through `onRunChanged`, which
 * is what the `runEvents` stream hangs off.
 *
 * Every method returns the transitioned run, or `null` when the run is no
 * longer in the expected source status. `null` always means the caller lost a
 * race (another worker claimed the run, or it was cancelled or recovered) and
 * must stop acting on the run. Nothing is emitted for a `null` outcome.
 */
export class AutomationRunTransitions {
  private readonly runStore: AutomationRunStore;
  private readonly onRunChanged: OnRunChanged | undefined;

  constructor(options: { runStore: AutomationRunStore; onRunChanged?: OnRunChanged }) {
    this.runStore = options.runStore;
    this.onRunChanged = options.onRunChanged;
  }

  /** scheduled → queued, when the run's `scheduledAt` comes due. */
  markQueued(runId: AutomationRunId): AutomationRun | null {
    const transition: RunTransition = {
      from: ['scheduled'],
      to: 'queued',
    };
    return this.transition(runId, transition, { status: 'queued' });
  }

  /** queued → provisioning_workspace, stamping `startedAt`; claims the run for a worker. */
  claimQueued(runId: AutomationRunId, startedAt: number): AutomationRun | null {
    const transition: RunTransition = {
      from: ['queued'],
      to: 'provisioning_workspace',
    };
    return this.transition(runId, transition, {
      status: 'provisioning_workspace',
      startedAt,
    });
  }

  /** provisioning_workspace → starting_session, recording the provisioned workspace. */
  markStartingSession(
    runId: AutomationRunId,
    workspace: { worktree: HostFileRef; branchName: string | null }
  ): AutomationRun | null {
    const transition: RunTransition = {
      from: ['provisioning_workspace'],
      to: 'starting_session',
    };
    return this.transition(runId, transition, {
      status: 'starting_session',
      worktree: workspace.worktree,
      branchName: workspace.branchName,
    });
  }

  /** starting_session → done, recording the started session and stamping `finishedAt`. */
  markDone(
    runId: AutomationRunId,
    session: { conversationId: string; sessionId: string },
    finishedAt: number
  ): AutomationRun | null {
    const transition: RunTransition = {
      from: ['starting_session'],
      to: 'done',
    };
    return this.transition(runId, transition, {
      status: 'done',
      conversationId: session.conversationId,
      sessionId: session.sessionId,
      finishedAt,
    });
  }

  /** Any non-terminal status → failed, recording the error and `finishedAt`. */
  markFailed(
    runId: AutomationRunId,
    error: AutomationRunError,
    finishedAt: number
  ): AutomationRun | null {
    const transition: RunTransition = {
      from: [...NON_TERMINAL_RUN_STATUSES],
      to: 'failed',
    };
    return this.transition(runId, transition, {
      status: 'failed',
      error,
      finishedAt,
    });
  }

  /** scheduled/queued → skipped, before any worker has touched the run. */
  markSkipped(
    runId: AutomationRunId,
    error: AutomationRunError,
    finishedAt: number
  ): AutomationRun | null {
    const transition: RunTransition = {
      from: ['scheduled', 'queued'],
      to: 'skipped',
    };
    return this.transition(runId, transition, {
      status: 'skipped',
      error,
      finishedAt,
    });
  }

  /** queued/in-flight → cancelled, when the user manually stops the run. */
  markCancelled(runId: AutomationRunId, finishedAt: number): AutomationRun | null {
    const transition: RunTransition = {
      from: ['queued', ...IN_FLIGHT_RUN_STATUSES],
      to: 'cancelled',
    };
    return this.transition(runId, transition, { status: 'cancelled', finishedAt });
  }

  /**
   * In-flight run found at boot → failed with `interrupted_by_restart`,
   * attributing the error step to the status the run was stuck in. Callers
   * pass the run as listed so the CAS source matches what recovery observed.
   */
  markInterrupted(run: AutomationRun, finishedAt: number): AutomationRun | null {
    const step = IN_FLIGHT_ERROR_STEPS[run.status];
    if (!step) {
      throw new TypeError(
        `Run ${run.id} is not in-flight and cannot be interrupted: ${run.status}`
      );
    }
    const transition: RunTransition = {
      from: [run.status],
      to: 'failed',
    };
    return this.transition(run.id, transition, {
      status: 'failed',
      error: { step, code: INTERRUPTED_BY_RESTART },
      finishedAt,
    });
  }

  private transition(
    runId: AutomationRunId,
    transition: RunTransition,
    patch: Partial<AutomationRun> & Pick<AutomationRun, 'status'>
  ): AutomationRun | null {
    if (patch.status !== transition.to) {
      throw new TypeError(
        `Run transition target ${transition.to} does not match patch status ${patch.status}`
      );
    }
    const run = this.runStore.transitionRun(runId, transition.from, patch);
    if (run) this.onRunChanged?.(run);
    return run;
  }
}
