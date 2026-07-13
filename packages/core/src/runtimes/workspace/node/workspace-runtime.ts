import { randomUUID } from 'node:crypto';
import { err, ok, type Result } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import {
  createLiveModelHost,
  LiveLog,
  type LiveJobContext,
  type LiveModelHost,
} from '@emdash/wire';
import { bindMachineToLiveState } from '@emdash/wire';
import { resourceKeyFromFileRef, type HostFileRef } from '@primitives/path/api';
import {
  type ActivateWorkspaceInput,
  type ConvertWorkspaceInput,
  type DeactivateWorkspaceInput,
  type ProvisionWorkspaceInput,
  type ReconcileWorkspaceInput,
  type RunWorkspaceScriptInput,
  type TeardownWorkspaceInput,
  type WorkspaceError,
  type WorkspaceOperationKind,
  type WorkspaceOperationProgress,
  type WorkspaceOperationResult,
  type WorkspaceOperationStage,
  type WorkspaceScriptOutputKey,
  type WorkspaceTopology,
  workspaceContract,
} from '@runtimes/workspace/api';
import type { BootstrapProgress, RunPhaseInput } from '@runtimes/workspace/api/provisioning';
import { WorkspaceLifecycleManager } from '@runtimes/workspace/node/provisioning/lifecycle';
import type { IWatchService } from '@services/fs-watch/api';
import { WorkspaceActivityIndex, type WorkspaceActivityProvider } from './activity';
import { createWorkspaceMachine, type WorkspaceMachine } from './machine/machine';
import { nativePathFromWorkspace } from './provisioning/paths';
import { NodeWorkspaceProvisioner, type WorkspaceProvisioner } from './provisioning/provisioner';
import { NodeWorkspaceScriptEngine, type WorkspaceScriptEngine } from './scripts';
import { WorkspaceTopologyObserver } from './topology-observer';

type WorkspaceRuntimeRecord = {
  machine: WorkspaceMachine;
  binding: { dispose(): void };
  scope: Scope;
};

export type WorkspaceRuntimeOptions = {
  lifecycle?: WorkspaceLifecycleManager;
  provisioner?: WorkspaceProvisioner;
  scripts?: WorkspaceScriptEngine;
  activityProviders?: WorkspaceActivityProvider[];
  watcher?: IWatchService;
  scope?: Scope;
  now?: () => number;
  onError?: (context: string, error: unknown) => void;
};

export class WorkspaceRuntime {
  readonly host: LiveModelHost<typeof workspaceContract.workspace>;

  private readonly lifecycle: WorkspaceLifecycleManager;
  private readonly provisioner: WorkspaceProvisioner;
  private readonly scripts: WorkspaceScriptEngine;
  private readonly scope: Scope;
  private readonly now: () => number;
  private readonly onError: (context: string, error: unknown) => void;
  private readonly records = new Map<string, WorkspaceRuntimeRecord>();
  private readonly operationLane = new Set<string>();
  private readonly scriptLogs = new Map<string, LiveLog>();
  private readonly activity: WorkspaceActivityIndex;
  private readonly topologyObserver: WorkspaceTopologyObserver;

  constructor(options: WorkspaceRuntimeOptions = {}) {
    this.host = createLiveModelHost(workspaceContract.workspace);
    this.lifecycle = options.lifecycle ?? new WorkspaceLifecycleManager();
    this.provisioner = options.provisioner ?? new NodeWorkspaceProvisioner();
    this.scripts = options.scripts ?? new NodeWorkspaceScriptEngine();
    this.scope = options.scope ?? createScope({ label: 'workspace-runtime' });
    this.now = options.now ?? Date.now;
    this.onError = options.onError ?? (() => {});
    this.activity = new WorkspaceActivityIndex((workspace) => this.syncActivity(workspace));
    this.topologyObserver = new WorkspaceTopologyObserver(options.watcher, (workspace) => {
      void this.reconcile({ workspace }).catch((error) =>
        this.onError('workspace topology reconcile', error)
      );
    });

    for (const provider of options.activityProviders ?? []) {
      this.activity.addProvider(provider);
    }
    this.scope.add(() => this.dispose());
  }

  async reconcile(
    input: ReconcileWorkspaceInput,
    signal?: AbortSignal
  ): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
    const record = this.recordFor(input.workspace);
    const inspected = await this.inspectAndPublish(record, input.workspace, signal);
    if (!inspected.success) return inspected;
    return ok({
      workspace: input.workspace,
      path: nativePathFromWorkspace(input.workspace),
      topology: inspected.data,
    });
  }

  async provision(
    input: ProvisionWorkspaceInput,
    ctx: LiveJobContext<WorkspaceOperationProgress>
  ): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
    return await this.withOperation(input.workspace, 'provision', ctx, async (stage) => {
      const record = this.recordFor(input.workspace);
      stage.start('inspect', 'Inspect workspace');
      await this.inspectAndPublish(record, input.workspace, ctx.signal);
      stage.done('inspect');

      if (input.lifecycle?.setupPlan && input.lifecycle.setupPlan.steps.length > 0) {
        stage.start('lifecycle', 'Provision workspace');
        const result = await this.runLifecyclePhase(
          {
            ref: input.lifecycle.ref,
            context: input.lifecycle.context,
            plan: input.lifecycle.setupPlan,
            phase: 'provision',
          },
          ctx,
          stage,
          'lifecycle'
        );
        if (!result.success) return err(result.error);
        stage.done('lifecycle');
      } else {
        stage.skip('lifecycle', 'Provision workspace');
      }

      stage.start('refresh', 'Refresh workspace');
      const topology = await this.inspectAndPublish(record, input.workspace, ctx.signal);
      if (!topology.success) return topology;
      stage.done('refresh');
      return ok({
        workspace: input.workspace,
        path: nativePathFromWorkspace(input.workspace),
        topology: topology.data,
      });
    });
  }

  async convert(
    input: ConvertWorkspaceInput,
    ctx: LiveJobContext<WorkspaceOperationProgress>
  ): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
    return await this.withOperation(input.workspace, 'convert', ctx, async (stage) => {
      const record = this.recordFor(input.workspace);
      stage.start('convert', 'Convert workspace');
      const converted = await this.provisioner.convert(input, { signal: ctx.signal });
      if (!converted.success) return converted;
      record.machine.apply({ type: 'TopologyObserved', topology: converted.data });
      stage.done('convert');
      return ok({
        workspace: input.workspace,
        path: nativePathFromWorkspace(input.workspace),
        topology: converted.data,
      });
    });
  }

  async activate(
    input: ActivateWorkspaceInput,
    ctx: LiveJobContext<WorkspaceOperationProgress>
  ): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
    return await this.withOperation(input.workspace, 'activate', ctx, async (stage) => {
      const record = this.recordFor(input.workspace);
      stage.start('inspect', 'Inspect workspace');
      const topology = await this.inspectAndPublish(record, input.workspace, ctx.signal);
      if (!topology.success) return topology;
      stage.done('inspect');

      record.machine.apply({
        type: 'ConsumerActivated',
        consumer: { id: input.consumerId, activatedAt: this.now() },
      });
      return ok({ workspace: input.workspace, path: nativePathFromWorkspace(input.workspace) });
    });
  }

  async deactivate(
    input: DeactivateWorkspaceInput,
    ctx: LiveJobContext<WorkspaceOperationProgress>
  ): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
    return await this.withOperation(input.workspace, 'deactivate', ctx, async (stage) => {
      const record = this.recordFor(input.workspace);
      record.machine.apply({ type: 'ConsumerDeactivated', consumerId: input.consumerId });

      if (record.machine.current().consumers.length === 0 && input.strategy === 'stop') {
        if (
          input.lifecycle?.deactivationPlan &&
          input.lifecycle.deactivationPlan.steps.length > 0
        ) {
          stage.start('deactivation-plan', 'Run deactivation plan');
          const result = await this.runLifecyclePhase(
            {
              ref: input.lifecycle.ref,
              context: input.lifecycle.context,
              plan: input.lifecycle.deactivationPlan,
              phase: 'setup',
            },
            ctx,
            stage,
            'deactivation-plan'
          );
          if (!result.success) return err(result.error);
          stage.done('deactivation-plan');
        } else {
          stage.skip('deactivation-plan', 'Run deactivation plan');
        }

        await this.runAutomationScript(input.workspace, input.automation, 'teardown', ctx, stage);
        await this.scripts.stopWorkspace(input.workspace, { signal: ctx.signal });
      }

      return ok({ workspace: input.workspace, path: nativePathFromWorkspace(input.workspace) });
    });
  }

  async teardown(
    input: TeardownWorkspaceInput,
    ctx: LiveJobContext<WorkspaceOperationProgress>
  ): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
    return await this.withOperation(input.workspace, 'teardown', ctx, async (stage) => {
      const record = this.recordFor(input.workspace);
      const idle = record.machine.dispatch(
        { type: 'RequireIdleForTeardown', force: input.force },
        undefined
      );
      if (!idle.success) return idle;

      if (input.lifecycle?.teardownPlan && input.lifecycle.teardownPlan.steps.length > 0) {
        stage.start('teardown-plan', 'Remove workspace');
        const result = await this.runLifecyclePhase(
          {
            ref: input.lifecycle.ref,
            context: input.lifecycle.context,
            plan: input.lifecycle.teardownPlan,
            phase: 'teardown',
            force: input.force,
          },
          ctx,
          stage,
          'teardown-plan'
        );
        if (!result.success) return err(result.error);
        stage.done('teardown-plan');
      } else {
        stage.skip('teardown-plan', 'Remove workspace');
      }

      const topology = await this.inspectAndPublish(record, input.workspace, ctx.signal);
      if (!topology.success) return topology;
      return ok({
        workspace: input.workspace,
        path: nativePathFromWorkspace(input.workspace),
        topology: topology.data,
      });
    });
  }

  async runScript(
    input: RunWorkspaceScriptInput,
    ctx: LiveJobContext<WorkspaceOperationProgress>
  ): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
    return await this.withOperation(input.workspace, 'run-script', ctx, async (stage) => {
      await this.runAutomationScript(
        input.workspace,
        input.automation,
        input.script,
        ctx,
        stage,
        true
      );
      return ok({ workspace: input.workspace, path: nativePathFromWorkspace(input.workspace) });
    });
  }

  scriptOutput(key: WorkspaceScriptOutputKey): LiveLog {
    const logKey = `${resourceKeyFromFileRef(key.workspace)}:${key.operationId}:${key.script}`;
    const existing = this.scriptLogs.get(logKey);
    if (existing) return existing;
    const log = new LiveLog();
    this.scriptLogs.set(logKey, log);
    return log;
  }

  dispose(): void {
    for (const record of this.records.values()) {
      record.binding.dispose();
      void record.scope.dispose();
      record.machine.dispose();
    }
    this.records.clear();
    this.host.dispose();
    this.lifecycle.dispose();
    this.activity.dispose();
    void this.topologyObserver.dispose();
    this.scriptLogs.clear();
  }

  private recordFor(workspace: HostFileRef): WorkspaceRuntimeRecord {
    const key = resourceKeyFromFileRef(workspace);
    const existing = this.records.get(key);
    if (existing) return existing;

    const machine = createWorkspaceMachine(workspace);
    const cell =
      this.host.get(workspace) ??
      this.host.create(workspace, {
        state: machine.current(),
      });
    const binding = bindMachineToLiveState({
      machine,
      liveState: cell.states.state,
      project: (state) => state,
    });
    const record = {
      machine,
      binding,
      scope: this.scope.child(`workspace:${key}`),
    };
    this.records.set(key, record);
    this.topologyObserver.watch(workspace);
    this.syncActivity(workspace);
    return record;
  }

  private async withOperation(
    workspace: HostFileRef,
    kind: WorkspaceOperationKind,
    ctx: LiveJobContext<WorkspaceOperationProgress>,
    run: (stage: StageReporter) => Promise<Result<WorkspaceOperationResult, WorkspaceError>>
  ): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
    const key = resourceKeyFromFileRef(workspace);
    if (this.operationLane.has(key)) {
      return err({
        type: 'operation-in-flight',
        message: 'Workspace already has an active operation',
      });
    }
    this.operationLane.add(key);

    const record = this.recordFor(workspace);
    const started = record.machine.dispatch(
      { type: 'BeginOperation', kind, operationId: ctx.jobId, startedAt: this.now() },
      undefined
    );
    if (!started.success) {
      this.operationLane.delete(key);
      return started;
    }

    const stage = new StageReporter(kind, ctx.jobId, ctx);
    try {
      const result = await run(stage);
      if (result.success) {
        record.machine.apply({ type: 'OperationCompleted' });
      } else {
        record.machine.apply({ type: 'OperationFailed', error: result.error });
        stage.failCurrent(result.error);
      }
      return result;
    } catch (error) {
      const workspaceError = toWorkspaceError(error);
      record.machine.apply({ type: 'OperationFailed', error: workspaceError });
      stage.failCurrent(workspaceError);
      return err(workspaceError);
    } finally {
      this.operationLane.delete(key);
    }
  }

  private async inspectAndPublish(
    record: WorkspaceRuntimeRecord,
    workspace: HostFileRef,
    signal?: AbortSignal
  ): Promise<Result<WorkspaceTopology, WorkspaceError>> {
    const inspected = await this.provisioner.inspect(workspace, { signal });
    if (!inspected.success) return inspected;
    record.machine.apply({ type: 'TopologyObserved', topology: inspected.data });
    this.syncActivity(workspace);
    return inspected;
  }

  private syncActivity(workspace: HostFileRef): void {
    const record = this.records.get(resourceKeyFromFileRef(workspace));
    if (!record) return;
    record.machine.apply({
      type: 'ActivityObserved',
      resources: this.activity.resourcesFor(workspace),
    });
  }

  private async runLifecyclePhase(
    input: RunPhaseInput,
    ctx: LiveJobContext<WorkspaceOperationProgress>,
    stage: StageReporter,
    stageId: string
  ): Promise<Result<unknown, WorkspaceError>> {
    const result = await this.lifecycle.runPhase(input, {
      jobId: ctx.jobId,
      signal: ctx.signal,
      progress: (progress) => stage.update(stageId, mapLifecycleProgress(progress)),
    });
    return result.success ? ok(result.data) : err(toWorkspaceError(result.error));
  }

  private async runAutomationScript(
    workspace: HostFileRef,
    automation: ActivateWorkspaceInput['automation'],
    script: 'setup' | 'run' | 'teardown',
    ctx: LiveJobContext<WorkspaceOperationProgress>,
    stage: StageReporter,
    force = false
  ): Promise<Result<void, WorkspaceError>> {
    if (!automation) return ok(undefined);
    if (script === 'setup' && !automation.autoRunSetup && !force) return ok(undefined);
    if (script === 'run' && !automation.autoRunRun && !force) return ok(undefined);
    if (!automation[script]) return ok(undefined);

    const stageId = `script:${script}`;
    stage.start(stageId, `Run ${script} script`);
    const log = this.scriptOutput({ workspace, operationId: ctx.jobId, script });
    const result = await this.scripts.run({
      workspace,
      script,
      automation,
      signal: ctx.signal,
      appendOutput: (chunk) => log.append(chunk),
    });
    if (!result.success) {
      stage.fail(stageId, result.error);
      return result;
    }
    stage.done(stageId);
    return ok(undefined);
  }
}

class StageReporter {
  private readonly stages: WorkspaceOperationStage[] = [];
  private current: string | undefined;

  constructor(
    private readonly kind: WorkspaceOperationKind,
    private readonly operationId: string,
    private readonly ctx: LiveJobContext<WorkspaceOperationProgress>
  ) {}

  start(id: string, label: string): void {
    this.current = id;
    this.upsert({ id, label, status: 'running' });
  }

  update(id: string, progress: WorkspaceOperationStage['progress']): void {
    const existing = this.stages.find((stage) => stage.id === id);
    if (!existing) return;
    existing.progress = progress;
    this.publish();
  }

  done(id: string): void {
    const existing = this.stages.find((stage) => stage.id === id);
    if (existing) {
      existing.status = 'done';
      existing.progress = undefined;
    }
    this.publish();
  }

  skip(id: string, label: string): void {
    this.upsert({ id, label, status: 'skipped' });
  }

  fail(id: string, error: WorkspaceError): void {
    const existing = this.stages.find((stage) => stage.id === id);
    if (existing) {
      existing.status = 'failed';
      existing.progress = { message: error.message };
    }
    this.publish();
  }

  failCurrent(error: WorkspaceError): void {
    if (this.current) this.fail(this.current, error);
  }

  private upsert(stage: WorkspaceOperationStage): void {
    const index = this.stages.findIndex((candidate) => candidate.id === stage.id);
    if (index >= 0) this.stages[index] = stage;
    else this.stages.push(stage);
    this.publish();
  }

  private publish(): void {
    this.ctx.progress({
      operationId: this.operationId,
      kind: this.kind,
      stages: this.stages.map((stage) => ({ ...stage })),
    });
  }
}

function mapLifecycleProgress(progress: BootstrapProgress): WorkspaceOperationStage['progress'] {
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

function toWorkspaceError(error: unknown): WorkspaceError {
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { type?: unknown }).type === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return error as WorkspaceError;
  }
  return {
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  };
}

export function createUnavailableWorkspaceError(error: unknown): WorkspaceError {
  return toWorkspaceError(error);
}

export function workspaceJobError(error: unknown): WorkspaceError {
  return toWorkspaceError(error);
}

export function workspaceOperationId(): string {
  return randomUUID();
}
