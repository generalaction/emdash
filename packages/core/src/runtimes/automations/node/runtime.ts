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
  GetRunsError,
  RemoveError,
  StartRunError,
} from '../api/errors';
import type { AutomationRun } from '../api/run';
import type {
  CancelRunInput,
  DeployInput,
  DeployResult,
  GetRunsInput,
  GetRunsResult,
  RemoveInput,
  StartRunInput,
  StartRunResult,
} from '../api/schemas';
import { GET_RUNS_DEFAULT_LIMIT } from '../api/schemas';
import type { AutomationSessionPort, AutomationWorkspacePort } from './ports';
import { createAutomationRunExecutor } from './run-executor';
import { AutomationRunTransitions, type OnRunChanged } from './run-transitions';
import { AutomationScheduler } from './scheduler';
import type { AutomationsDb } from './sqlite/store';
import { AutomationDeploymentStore } from './storage/deployment-store';
import { AutomationRunStore } from './storage/run-store';
import { validateAutomationSchedule } from './utils/cron';

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
  readonly runEventsHost: EventStreamHost<typeof automationsContract.runEvents>;

  constructor(options: AutomationsRuntimeOptions) {
    this.clock = options.clock ?? systemClock;
    const logger = options.logger ?? noopLogger;

    this.deploymentStore = new AutomationDeploymentStore(options.handle);
    this.runStore = new AutomationRunStore(options.handle);

    this.runEventsHost = createEventStreamHost(automationsContract.runEvents, {
      onActive: (key) => this.activeAutomationIds.add(key.automationId),
      onIdle: (key) => this.activeAutomationIds.delete(key.automationId),
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

  getRuns(input: GetRunsInput): Result<GetRunsResult, GetRunsError> {
    const limit = input.limit ?? GET_RUNS_DEFAULT_LIMIT;
    const runs = this.runStore.listRunsSince({
      sinceSeq: input.sinceSeq,
      automationIds: input.automationIds,
      limit,
    });
    const nextSeq = runs.length > 0 ? runs[runs.length - 1].seq : input.sinceSeq;
    return ok({ runs, nextSeq });
  }

  cancelRun(input: CancelRunInput): Result<void, CancelRunError> {
    const { runId } = input;
    if (!this.scheduler.cancelRun(runId)) {
      return err({
        type: 'run-not-found',
        runId,
        message: `Run ${runId} not found`,
      });
    }
    return ok(undefined);
  }

  private emitRunEvent(run: AutomationRun): void {
    if (this.activeAutomationIds.has(run.automationId)) {
      this.runEventsHost.emit({ automationId: run.automationId }, { run });
    }
  }
}
