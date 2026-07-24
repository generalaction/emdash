import type { HostFileRef } from '@primitives/path/api';
import type {
  AutomationRun,
  AutomationRunError,
  AutomationRunId,
  AutomationRunStatus,
} from '../../api/run';
import type { AutomationRunStore } from '../persistence/run-store';

export type OnRunChanged = (run: AutomationRun) => void;

type RunTransition = {
  from: AutomationRunStatus[];
  to: AutomationRunStatus;
};

export const INTERRUPTED_BY_RESTART = 'interrupted_by_restart';

export class AutomationRunTransitions {
  private readonly runStore: AutomationRunStore;
  private readonly onRunChanged: OnRunChanged | undefined;

  constructor(options: { runStore: AutomationRunStore; onRunChanged?: OnRunChanged }) {
    this.runStore = options.runStore;
    this.onRunChanged = options.onRunChanged;
  }

  markQueued(runId: AutomationRunId): AutomationRun | null {
    const transition: RunTransition = {
      from: ['scheduled'],
      to: 'queued',
    };
    return this.transition(runId, transition, { status: transition.to });
  }

  claimQueued(runId: AutomationRunId, startedAt: number): AutomationRun | null {
    const transition: RunTransition = {
      from: ['queued'],
      to: 'provisioning_workspace',
    };
    return this.transition(runId, transition, {
      status: transition.to,
      startedAt,
    });
  }

  markStartingSession(
    runId: AutomationRunId,
    provisioned: { workspace: HostFileRef; branchName: string | null }
  ): AutomationRun | null {
    const transition: RunTransition = {
      from: ['provisioning_workspace'],
      to: 'starting_session',
    };
    return this.transition(runId, transition, {
      status: transition.to,
      workspace: provisioned.workspace,
      branchName: provisioned.branchName,
    });
  }

  markDone(
    runId: AutomationRunId,
    session: { conversationId: string; sessionId: string | null },
    finishedAt: number
  ): AutomationRun | null {
    const transition: RunTransition = {
      from: ['starting_session'],
      to: 'done',
    };
    return this.transition(runId, transition, {
      status: transition.to,
      conversationId: session.conversationId,
      sessionId: session.sessionId,
      finishedAt,
    });
  }

  markFailed(
    runId: AutomationRunId,
    error: AutomationRunError,
    finishedAt: number
  ): AutomationRun | null {
    const transition: RunTransition = {
      from: ['scheduled', 'queued', 'provisioning_workspace', 'starting_session'],
      to: 'failed',
    };
    return this.transition(runId, transition, {
      status: transition.to,
      error,
      finishedAt,
    });
  }

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
      status: transition.to,
      error,
      finishedAt,
    });
  }

  markCancelled(runId: AutomationRunId, finishedAt: number): AutomationRun | null {
    const transition: RunTransition = {
      from: ['queued', 'provisioning_workspace', 'starting_session'],
      to: 'cancelled',
    };
    return this.transition(runId, transition, { status: transition.to, finishedAt });
  }

  markInterrupted(run: AutomationRun, finishedAt: number): AutomationRun | null {
    switch (run.status) {
      case 'provisioning_workspace': {
        const transition: RunTransition = {
          from: ['provisioning_workspace'],
          to: 'failed',
        };
        return this.transition(run.id, transition, {
          status: transition.to,
          error: { step: 'provision_workspace', code: INTERRUPTED_BY_RESTART },
          finishedAt,
        });
      }
      case 'starting_session': {
        const transition: RunTransition = {
          from: ['starting_session'],
          to: 'failed',
        };
        return this.transition(run.id, transition, {
          status: transition.to,
          error: { step: 'start_session', code: INTERRUPTED_BY_RESTART },
          finishedAt,
        });
      }
      default:
        throw new TypeError(
          `Run ${run.id} is not in-flight and cannot be interrupted: ${run.status}`
        );
    }
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
