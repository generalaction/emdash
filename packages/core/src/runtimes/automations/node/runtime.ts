import { err, ok, type Result } from '@emdash/shared';
import { noopLogger, type Logger } from '@emdash/shared/logger';
import { systemClock, type Clock } from '@emdash/shared/scheduling';
import { createEventStreamHost, type EventStreamHost } from '@emdash/wire';
import type { StoreHandle } from '@primitives/sqlite-store/api';
import { automationsContract } from '../api/contract';
import type { AutomationId } from '../api/deployment';
import type {
  CancelRunError,
  DeployError,
  RunReadError,
  RemoveError,
  StartRunError,
} from '../api/errors';
import { automationRunStatuses, type AutomationRun } from '../api/run';
import type {
  CancelRunInput,
  DeployInput,
  DeployResult,
  GetRunInput,
  GetRunOverviewInput,
  GetRunOverviewResult,
  GetRunResult,
  ListChangedRunsInput,
  ListChangedRunsResult,
  ListRunsInput,
  ListRunsResult,
  RemoveInput,
  StartRunInput,
  StartRunResult,
} from '../api/schemas';
import { LIST_CHANGED_RUNS_DEFAULT_LIMIT, LIST_RUNS_DEFAULT_LIMIT } from '../api/schemas';
import { AutomationDeploymentStore } from './persistence/deployment-store';
import { AutomationRunStore } from './persistence/run-store';
import type { AutomationsDb } from './persistence/store';
import type { AutomationSessionPort } from './ports/session-start';
import type { AutomationWorkspacePort } from './ports/workspace-provisioning';
import { createAutomationRunExecutor } from './runs/executor';
import { AutomationRunTransitions, type OnRunChanged } from './runs/transitions';
import { validateAutomationSchedule } from './scheduling/cron';
import { AutomationScheduler } from './scheduling/scheduler';

export type AutomationsRuntimeOptions = {
  handle: StoreHandle<AutomationsDb>;
  workspacePort: AutomationWorkspacePort;
  sessionPort: AutomationSessionPort;
  clock?: Clock;
  logger?: Logger;
  tickIntervalMs?: number;
  maxConcurrentRuns?: number;
};

export class AutomationsRuntime {
  private readonly deploymentStore: AutomationDeploymentStore;
  private readonly runStore: AutomationRunStore;
  private readonly transitions: AutomationRunTransitions;
  private readonly scheduler: AutomationScheduler;
  private readonly clock: Clock;
  private readonly activeAutomationIds = new Set<AutomationId>();
  private allRunEventsActive = false;
  readonly runEventsHost: EventStreamHost<typeof automationsContract.runEvents>;

  constructor(options: AutomationsRuntimeOptions) {
    this.clock = options.clock ?? systemClock;
    const logger = options.logger ?? noopLogger;

    this.deploymentStore = new AutomationDeploymentStore(options.handle);
    this.runStore = new AutomationRunStore(options.handle);

    this.runEventsHost = createEventStreamHost(automationsContract.runEvents, {
      onActive: (key) => {
        if (key.automationId) this.activeAutomationIds.add(key.automationId);
        else this.allRunEventsActive = true;
      },
      onIdle: (key) => {
        if (key.automationId) this.activeAutomationIds.delete(key.automationId);
        else this.allRunEventsActive = false;
      },
    });

    const onRunChanged: OnRunChanged = (run) => {
      this.emitRunEvent(run);
    };

    this.transitions = new AutomationRunTransitions({
      runStore: this.runStore,
      onRunChanged,
    });

    const executor = createAutomationRunExecutor({
      transitions: this.transitions,
      workspacePort: options.workspacePort,
      sessionPort: options.sessionPort,
    });

    this.scheduler = new AutomationScheduler({
      deploymentStore: this.deploymentStore,
      runStore: this.runStore,
      transitions: this.transitions,
      execute: executor,
      clock: this.clock,
      logger,
      tickIntervalMs: options.tickIntervalMs,
      maxConcurrentRuns: options.maxConcurrentRuns,
      onRunChanged,
    });
  }

  start(): void {
    this.scheduler.start();
  }

  async dispose(): Promise<void> {
    await this.scheduler.stop();
    this.runEventsHost.dispose();
  }

  async deploy(input: DeployInput): Promise<Result<DeployResult, DeployError>> {
    const now = this.clock.now();
    const scheduleError = validateAutomationSchedule(input.schedule, now);
    if (scheduleError) return err(scheduleError);

    const stored = this.deploymentStore.upsertDeployment(input, now);
    this.scheduler.reconcile();
    return ok(stored);
  }

  async remove(input: RemoveInput): Promise<Result<void, RemoveError>> {
    const { automationId } = input;
    const existing = this.deploymentStore.getDeployment(automationId);
    if (!existing) {
      return err({
        type: 'automation-not-found',
        automationId,
        message: `Automation ${automationId} not found`,
      });
    }

    for (const run of this.runStore.listRunsInStatuses([
      'scheduled',
      'queued',
      'provisioning_workspace',
      'starting_session',
    ])) {
      if (run.automationId !== automationId) continue;
      this.scheduler.cancelRun(run.id);
    }
    this.runStore.deleteRunsForAutomation(automationId);
    this.deploymentStore.removeDeployment(automationId);
    return ok(undefined);
  }

  async startRun(input: StartRunInput): Promise<Result<StartRunResult, StartRunError>> {
    const { automationId } = input;
    const deployment = this.deploymentStore.getDeployment(automationId);
    if (!deployment) {
      return err({
        type: 'automation-not-found',
        automationId,
        message: `Automation ${automationId} not found`,
      });
    }
    if (!deployment.enabled) {
      return err({
        type: 'automation-disabled',
        automationId,
        message: `Automation ${automationId} is disabled`,
      });
    }
    const run = this.scheduler.runNow(deployment);
    return ok({ run });
  }

  cancelRun(input: CancelRunInput): Result<void, CancelRunError> {
    const { automationId, runId } = input;
    const run = this.runStore.getRun(runId);
    if (!run || run.automationId !== automationId) {
      return err({
        type: 'run-not-found',
        runId,
        message: `Run ${runId} not found`,
      });
    }
    if (!this.scheduler.cancelRun(runId)) {
      return err({
        type: 'run-not-found',
        runId,
        message: `Run ${runId} not found`,
      });
    }
    return ok(undefined);
  }

  getRun(input: GetRunInput): Result<GetRunResult, RunReadError> {
    return ok({
      run: this.runStore.getRunForAutomation(input.automationId, input.runId),
    });
  }

  listRuns(input: ListRunsInput): Result<ListRunsResult, RunReadError> {
    return ok({
      runs: this.runStore.listRuns({
        automationId: input.automationId,
        status: input.status,
        before: input.before,
        limit: input.limit ?? LIST_RUNS_DEFAULT_LIMIT,
      }),
    });
  }

  listChangedRuns(input: ListChangedRunsInput): Result<ListChangedRunsResult, RunReadError> {
    const limit = input.limit ?? LIST_CHANGED_RUNS_DEFAULT_LIMIT;
    const runs = this.runStore.listChangedRuns({
      sinceSeq: input.sinceSeq,
      automationId: input.automationId,
      limit,
    });
    const nextSeq = runs.length > 0 ? runs[runs.length - 1].seq : input.sinceSeq;
    return ok({ runs, nextSeq });
  }

  getRunOverview(input: GetRunOverviewInput): Result<GetRunOverviewResult, RunReadError> {
    const counts = Object.fromEntries(
      automationRunStatuses.map((status) => [status, 0])
    ) as GetRunOverviewResult['counts'];
    Object.assign(counts, this.runStore.countRunsByStatus(input.automationId));
    return ok({
      counts,
      latestRun: this.runStore.getLatestRun(input.automationId),
      nextScheduledRun: this.runStore.getNextScheduledRun(input.automationId),
    });
  }

  private emitRunEvent(run: AutomationRun): void {
    if (this.allRunEventsActive) this.runEventsHost.emit({}, { run });
    if (this.activeAutomationIds.has(run.automationId)) {
      this.runEventsHost.emit({ automationId: run.automationId }, { run });
    }
  }
}
