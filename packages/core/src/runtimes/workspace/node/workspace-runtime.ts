import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { createKeyedLanes, createScope, type Scope } from '@emdash/shared/concurrency';
import { runWithTimeout, TimeoutError } from '@emdash/shared/scheduling';
import {
  createLiveModelHost,
  createLiveJobReplica,
  LiveJobCancelledError,
  LiveJobFailedError,
  type LiveJobContext,
  type LiveModelHost,
  type LiveSource,
} from '@emdash/wire';
import { bindMachineToLiveState } from '@emdash/wire';
import type { ContractClient } from '@emdash/wire/api';
import { resourceKeyFromFileRef, type HostFileRef } from '@primitives/path/api';
import {
  type ActivateWorkspaceInput,
  type CleanWorkspaceArtifactsInput,
  type CleanWorkspaceArtifactsResult,
  type ConvertWorkspaceInput,
  type DeactivateWorkspaceInput,
  type MeasureWorkspaceUsageInput,
  type ProvisionWorkspaceInput,
  type ReconcileWorkspaceInput,
  type TeardownWorkspaceInput,
  type WorkspaceError,
  type WorkspaceOperationKind,
  type WorkspaceOperationProgress,
  type WorkspaceOperationResult,
  type WorkspaceOperationStage,
  type WorkspaceTopology,
  type WorkspaceUsage,
  workspaceContract,
} from '@runtimes/workspace/api';
import {
  createMemoryWorkspaceOperationRecordStore,
  isWorkspaceOperationRecordStatusConflict,
  isTerminalStatus,
  type CancelWorkspaceOperationResult,
  type SubmitWorkspaceOperationInput,
  type SubmitWorkspaceOperationOutcome,
  type WorkspaceOperationRecord,
  type WorkspaceOperationRecordMap,
  type WorkspaceOperationRecordParams,
  type WorkspaceOperationRecordResult,
  type WorkspaceOperationRecordStore,
} from '@runtimes/workspace/api/operation-records';
import {
  compileTeardownFromProbe,
  type BootstrapProgress,
  type RunPhaseInput,
} from '@runtimes/workspace/api/provisioning';
import { WorkspaceLifecycleManager } from '@runtimes/workspace/node/provisioning/lifecycle';
import { probeWorkspace } from '@runtimes/workspace/node/provisioning/lifecycle/probe';
import {
  gitErrorMessage,
  runGit,
} from '@runtimes/workspace/node/provisioning/lifecycle/steps/run-git';
import { measureAbsolutePathUsage } from '@services/fs-usage/node';
import type { IWatchService } from '@services/fs-watch/api';
import {
  scriptWorkflowsContract,
  type RunScriptWorkflowInput,
  type ScriptWorkflowsContract,
} from '@services/script-workflows/api';
import { WorkspaceActivityIndex, type WorkspaceActivityProvider } from './activity';
import {
  createWorkspaceMachine,
  type WorkspaceCommand,
  type WorkspaceMachine,
} from './machine/machine';
import { nativePathFromWorkspace } from './provisioning/paths';
import { NodeWorkspaceProvisioner, type WorkspaceProvisioner } from './provisioning/provisioner';
import { WorkspaceTopologyObserver } from './topology-observer';

type WorkspaceRuntimeRecord = {
  machine: WorkspaceMachine;
  state: LiveSource;
  binding: { dispose(): void };
  scope: Scope;
  currentOperation?: RuntimeOperation;
};

type RuntimeOperation = {
  kind: WorkspaceOperationKind;
  operationId: string;
  controller: AbortController;
  settled: Promise<void>;
};

const PREEMPT_SETTLE_TIMEOUT_MS = 30_000;
const OPERATION_RECORD_RETENTION_MS = 24 * 60 * 60_000;
const OPERATION_LOG_PUBLISH_KEY = 'operation-log';
const NEVER_ABORTED_SIGNAL = new AbortController().signal;

export type WorkspaceRuntimeOptions = {
  lifecycle?: WorkspaceLifecycleManager;
  provisioner?: WorkspaceProvisioner;
  terminals?: ContractClient<ScriptWorkflowsContract>;
  activityProviders?: WorkspaceActivityProvider[];
  operationRecords?: WorkspaceOperationRecordStore;
  watcher?: IWatchService;
  scope?: Scope;
  now?: () => number;
  onError?: (context: string, error: unknown) => void;
};

export class WorkspaceRuntime {
  readonly host: LiveModelHost<typeof workspaceContract.workspace>;
  readonly operationLogHost: LiveModelHost<typeof workspaceContract.operationLog>;

  private readonly lifecycle: WorkspaceLifecycleManager;
  private readonly provisioner: WorkspaceProvisioner;
  private readonly terminals: ContractClient<ScriptWorkflowsContract> | undefined;
  private readonly scope: Scope;
  private readonly now: () => number;
  private readonly onError: (context: string, error: unknown) => void;
  private readonly records = new Map<string, WorkspaceRuntimeRecord>();
  private readonly activity: WorkspaceActivityIndex;
  private readonly operationRecords: WorkspaceOperationRecordStore;
  private readonly topologyObserver: WorkspaceTopologyObserver;
  private readonly reconcileLanes = createKeyedLanes();
  private readonly operationLanes = createKeyedLanes();
  private readonly operationLogPublishLanes = createKeyedLanes();
  private readonly rehydration: Promise<void>;
  private readonly operationControllers = new Map<string, AbortController>();

  constructor(options: WorkspaceRuntimeOptions = {}) {
    this.host = createLiveModelHost(workspaceContract.workspace);
    this.operationLogHost = createLiveModelHost(workspaceContract.operationLog);
    this.operationLogHost.create({}, { list: {} });
    this.lifecycle = options.lifecycle ?? new WorkspaceLifecycleManager();
    this.provisioner = options.provisioner ?? new NodeWorkspaceProvisioner();
    this.terminals = options.terminals;
    this.scope = options.scope ?? createScope({ label: 'workspace-runtime' });
    this.now = options.now ?? Date.now;
    this.onError = options.onError ?? (() => {});
    this.activity = new WorkspaceActivityIndex((workspace) => this.syncActivity(workspace));
    this.operationRecords = options.operationRecords ?? createMemoryWorkspaceOperationRecordStore();
    this.topologyObserver = new WorkspaceTopologyObserver(options.watcher, (workspace) => {
      this.reconcileLanes.coalesce(
        resourceKeyFromFileRef(workspace),
        async () => {
          const result = await this.reconcile({ workspace });
          if (!result.success) throw result.error;
        },
        (error) => this.onError('workspace topology reconcile', error)
      );
    });

    for (const provider of options.activityProviders ?? []) {
      this.activity.addProvider(provider);
    }
    this.scope.add(() => this.dispose());
    this.rehydration = this.rehydrateOperationRecords().catch((error: unknown) => {
      this.onError('workspace operation record rehydrate', error);
    });
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

  async measureUsage(
    input: MeasureWorkspaceUsageInput,
    signal?: AbortSignal
  ): Promise<Result<WorkspaceUsage, WorkspaceError>> {
    const workspacePath = nativePathFromWorkspace(input.workspace);
    const artifacts = await listIgnoredArtifacts(workspacePath, signal);
    if (!artifacts.success) return err(artifacts.error);
    const total = await measureWorkspacePath(
      workspacePath,
      '',
      artifacts.data.map((artifact) => artifact.relativePath)
    );
    if (!total.success) return err(total.error);

    return ok({
      workspace: input.workspace,
      path: workspacePath,
      totalBytes: total.data.exclusiveDiskBytes,
      artifactBytes: total.data.artifactBytes,
      errors: total.data.errors,
    });
  }

  async submitOperation(
    input: SubmitWorkspaceOperationInput
  ): Promise<Result<SubmitWorkspaceOperationOutcome, WorkspaceError>> {
    await this.waitForOperationRecordRehydration();
    await this.pruneTerminalOperationRecords();
    const existing = await this.operationRecords.get(input.requestId);
    if (!existing.success) return err(recordStoreErrorToWorkspaceError(existing.error));

    if (existing.data) {
      if (
        existing.data.status === 'pending' ||
        existing.data.status === 'running' ||
        existing.data.status === 'succeeded'
      ) {
        return ok({
          requestId: existing.data.requestId,
          seq: existing.data.seq,
          outcome: 'duplicate',
        });
      }

      const replaced = await this.operationRecords.replaceRecord(input.requestId, {
        kind: input.kind,
        workspace: input.workspace,
        params: input.params,
        initiatedBy: input.initiatedBy,
      });
      if (!replaced.success) return err(recordStoreErrorToWorkspaceError(replaced.error));
      if (!replaced.data) {
        return err({ type: 'not-found', message: 'Operation record disappeared during replace' });
      }
      this.publishOperationLog();
      this.enqueueSubmittedOperation(replaced.data);
      return ok({
        requestId: replaced.data.requestId,
        seq: replaced.data.seq,
        outcome: 'accepted',
      });
    }

    const appended = await this.operationRecords.appendRecord({
      requestId: input.requestId,
      kind: input.kind,
      workspace: input.workspace,
      params: input.params,
      initiatedBy: input.initiatedBy,
      status: 'pending',
    });
    if (!appended.success) return err(recordStoreErrorToWorkspaceError(appended.error));
    this.publishOperationLog();
    this.enqueueSubmittedOperation(appended.data);
    return ok({ requestId: appended.data.requestId, seq: appended.data.seq, outcome: 'accepted' });
  }

  async cancelOperation(
    requestId: string
  ): Promise<Result<CancelWorkspaceOperationResult, WorkspaceError>> {
    const record = await this.operationRecords.get(requestId);
    if (!record.success) return err(recordStoreErrorToWorkspaceError(record.error));
    if (!record.data) return err({ type: 'not-found', message: 'Operation record not found' });

    if (record.data.status === 'pending') {
      const cancelled = await this.operationRecords.updateRecord(requestId, {
        status: 'cancelled',
        error: { type: 'cancelled', message: 'Operation cancelled' },
        finishedAt: this.now(),
      });
      if (!cancelled.success) return err(recordStoreErrorToWorkspaceError(cancelled.error));
      this.publishOperationLog();
      return ok({ requestId, status: 'cancelled' });
    }

    const controller = this.operationControllers.get(requestId);
    if (controller && !controller.signal.aborted) {
      controller.abort({
        type: 'cancelled',
        message: 'Operation cancelled',
      } satisfies WorkspaceError);
    }
    return ok({ requestId, status: record.data.status });
  }

  private enqueueSubmittedOperation(record: WorkspaceOperationRecord): void {
    void this.operationLanes
      .run(resourceKeyFromFileRef(record.workspace), NEVER_ABORTED_SIGNAL, () =>
        this.runSubmittedOperation(record.requestId)
      )
      .catch((error) => this.onError('workspace operation log execution', error));
  }

  private async runSubmittedOperation(requestId: string): Promise<void> {
    const loaded = await this.operationRecords.get(requestId);
    if (!loaded.success) {
      this.onError('workspace operation record execute load', loaded.error);
      return;
    }
    const record = loaded.data;
    if (!record || record.status !== 'pending') return;

    const ctx: LiveJobContext<WorkspaceOperationProgress> = {
      jobId: requestId,
      signal: NEVER_ABORTED_SIGNAL,
      progress: () => {},
    };

    const result = await this.runOperationRecord(record, ctx);
    if (!result.success) {
      const latest = await this.operationRecords.get(requestId);
      if (!latest.success) {
        this.onError('workspace operation record rejection load', latest.error);
        return;
      }
      if (latest.data?.status === 'pending' || latest.data?.status === 'running') {
        const rejected = await this.operationRecords.updateRecord(requestId, {
          status: 'rejected',
          error: result.error,
          finishedAt: this.now(),
        });
        if (!rejected.success) {
          this.onError('workspace operation record rejection update', rejected.error);
        }
        this.publishOperationLog();
      }
    }
  }

  private async runOperationRecord(
    record: WorkspaceOperationRecord,
    ctx: LiveJobContext<WorkspaceOperationProgress>
  ): Promise<Result<unknown, WorkspaceError>> {
    switch (record.params.kind) {
      case 'provision':
        return this.provision(record.params.input, ctx);
      case 'convert':
        return this.convert(record.params.input, ctx);
      case 'activate':
        return this.activate(record.params.input, ctx);
      case 'deactivate':
        return this.deactivate(record.params.input, ctx);
      case 'teardown':
        return this.teardown(record.params.input, ctx);
      case 'clean-artifacts':
        return this.cleanArtifacts(record.params.input, ctx);
    }
  }

  async provision(
    input: ProvisionWorkspaceInput,
    ctx: LiveJobContext<WorkspaceOperationProgress>
  ): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
    return await this.withOperation(
      input.workspace,
      { kind: 'provision', input },
      (operationId, startedAt) => ({ type: 'Provision', operationId, startedAt }),
      ctx,
      async (stage, operationCtx) => {
        const record = this.recordFor(input.workspace);
        stage.start('inspect', 'Inspect workspace');
        await this.inspectAndPublish(record, input.workspace, operationCtx.signal);
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
            operationCtx,
            stage,
            'lifecycle'
          );
          if (!result.success) return err(result.error);
          stage.done('lifecycle');
        } else {
          stage.skip('lifecycle', 'Provision workspace');
        }

        stage.start('refresh', 'Refresh workspace');
        const topology = await this.inspectAndPublish(record, input.workspace, operationCtx.signal);
        if (!topology.success) return topology;
        stage.done('refresh');
        return ok({
          workspace: input.workspace,
          path: nativePathFromWorkspace(input.workspace),
          topology: topology.data,
        });
      }
    );
  }

  async convert(
    input: ConvertWorkspaceInput,
    ctx: LiveJobContext<WorkspaceOperationProgress>
  ): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
    return await this.withOperation(
      input.workspace,
      { kind: 'convert', input },
      (operationId, startedAt) => ({ type: 'Convert', operationId, startedAt }),
      ctx,
      async (stage, operationCtx) => {
        const record = this.recordFor(input.workspace);
        stage.start('convert', 'Convert workspace');
        const converted = await this.provisioner.convert(input, { signal: operationCtx.signal });
        if (!converted.success) return converted;
        record.machine.apply({ type: 'TopologyObserved', topology: converted.data });
        stage.done('convert');
        return ok({
          workspace: input.workspace,
          path: nativePathFromWorkspace(input.workspace),
          topology: converted.data,
        });
      }
    );
  }

  async activate(
    input: ActivateWorkspaceInput,
    ctx: LiveJobContext<WorkspaceOperationProgress>
  ): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
    const preflightRecord = this.recordFor(input.workspace);
    const preflightTopology = await this.inspectAndPublish(
      preflightRecord,
      input.workspace,
      ctx.signal
    );
    if (!preflightTopology.success) return preflightTopology;

    return await this.withOperation(
      input.workspace,
      { kind: 'activate', input },
      (operationId, startedAt) => ({
        type: 'Activate',
        operationId,
        startedAt,
        consumerId: input.consumerId,
      }),
      ctx,
      async (stage, operationCtx) => {
        const record = this.recordFor(input.workspace);
        stage.start('inspect', 'Inspect workspace');
        const topology = await this.inspectAndPublish(record, input.workspace, operationCtx.signal);
        if (!topology.success) return topology;
        stage.done('inspect');

        const stateBeforePrepare = record.machine.current();
        const shouldSkipPrepare =
          stateBeforePrepare.sessionPrepared && stateBeforePrepare.consumers.length > 0;
        if (!shouldSkipPrepare) {
          const prepareResult = await this.runTerminalsPrepare(
            input.workspace,
            input.automation,
            operationCtx,
            stage
          );
          if (!prepareResult.success) return prepareResult;
          record.machine.apply({ type: 'PrepareCompleted' });
        } else {
          stage.skip('script:prepare', 'Run prepare script');
        }

        const preparedDuringActivation = !stateBeforePrepare.sessionPrepared && !shouldSkipPrepare;
        record.machine.apply({
          type: 'ConsumerActivated',
          consumer: { id: input.consumerId, activatedAt: this.now() },
        });
        if (preparedDuringActivation)
          this.startPostActivationAutomation(input.workspace, input.automation);
        return ok({ workspace: input.workspace, path: nativePathFromWorkspace(input.workspace) });
      }
    );
  }

  async deactivate(
    input: DeactivateWorkspaceInput,
    ctx: LiveJobContext<WorkspaceOperationProgress>
  ): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
    return await this.withOperation(
      input.workspace,
      { kind: 'deactivate', input },
      (operationId, startedAt) => ({ type: 'Deactivate', operationId, startedAt }),
      ctx,
      async (stage, operationCtx) => {
        const record = this.recordFor(input.workspace);
        record.machine.apply({ type: 'ConsumerDeactivated', consumerId: input.consumerId });

        if (record.machine.current().consumers.length === 0 && input.strategy === 'detach') {
          await this.detachTerminalsScope(input.workspace);
        }

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
              operationCtx,
              stage,
              'deactivation-plan'
            );
            if (!result.success) return err(result.error);
            stage.done('deactivation-plan');
          } else {
            stage.skip('deactivation-plan', 'Run deactivation plan');
          }

          await this.runTerminalsTeardown(input.workspace, input.automation, operationCtx, stage);
          await this.killTerminalsScope(input.workspace);
        }

        return ok({ workspace: input.workspace, path: nativePathFromWorkspace(input.workspace) });
      }
    );
  }

  async teardown(
    input: TeardownWorkspaceInput,
    ctx: LiveJobContext<WorkspaceOperationProgress>
  ): Promise<Result<WorkspaceOperationResult, WorkspaceError>> {
    return await this.withOperation(
      input.workspace,
      { kind: 'teardown', input },
      (operationId, startedAt) => ({
        type: 'Teardown',
        operationId,
        startedAt,
        force: input.force,
      }),
      ctx,
      async (stage, operationCtx) => {
        const record = this.recordFor(input.workspace);
        const teardownPlan =
          input.lifecycle && !input.lifecycle.teardownPlan
            ? compileTeardownFromProbe(
                await probeWorkspace(input.lifecycle.ref, { signal: operationCtx.signal }),
                input.lifecycle.ref,
                { deleteBranch: input.lifecycle.deleteBranch }
              )
            : input.lifecycle?.teardownPlan;

        if (input.lifecycle && teardownPlan && teardownPlan.steps.length > 0) {
          stage.start('teardown-plan', 'Remove workspace');
          const result = await this.runLifecyclePhase(
            {
              ref: input.lifecycle.ref,
              context: input.lifecycle.context,
              plan: teardownPlan,
              phase: 'teardown',
              force: input.force,
            },
            operationCtx,
            stage,
            'teardown-plan'
          );
          if (!result.success) return err(result.error);
          stage.done('teardown-plan');
        } else {
          stage.skip('teardown-plan', 'Remove workspace');
        }

        const topology = await this.inspectAndPublish(record, input.workspace, operationCtx.signal);
        if (!topology.success) return topology;
        return ok({
          workspace: input.workspace,
          path: nativePathFromWorkspace(input.workspace),
          topology: topology.data,
        });
      }
    );
  }

  async cleanArtifacts(
    input: CleanWorkspaceArtifactsInput,
    ctx: LiveJobContext<WorkspaceOperationProgress>
  ): Promise<Result<CleanWorkspaceArtifactsResult, WorkspaceError>> {
    return await this.withOperation(
      input.workspace,
      { kind: 'clean-artifacts', input },
      (operationId, startedAt) => ({ type: 'CleanArtifacts', operationId, startedAt }),
      ctx,
      async (stage, operationCtx) => {
        const workspacePath = nativePathFromWorkspace(input.workspace);
        stage.start('scan', 'Find ignored artifacts');
        const artifacts = await listIgnoredArtifacts(workspacePath, operationCtx.signal);
        if (!artifacts.success) return err(artifacts.error);
        const cleanable = artifacts.data.filter(
          (artifact) => !matchesPreservePatterns(artifact.relativePath, input.preservePatterns)
        );
        stage.done('scan');

        stage.start('measure', 'Measure ignored artifacts');
        const measured = await measureArtifacts(workspacePath, cleanable);
        if (!measured.success) return err(measured.error);
        stage.done('measure');

        stage.start('delete', 'Delete ignored artifacts');
        for (let index = 0; index < cleanable.length; index += 1) {
          const artifact = cleanable[index];
          if (operationCtx.signal.aborted) {
            return err({ type: 'cancelled', message: 'Operation cancelled' });
          }
          await rm(artifact.absolutePath, { recursive: true, force: true });
          stage.update('delete', {
            percent: Math.round(((index + 1) / Math.max(cleanable.length, 1)) * 100),
            message: artifact.relativePath,
          });
        }
        stage.done('delete');

        return ok({
          workspace: input.workspace,
          path: workspacePath,
          reclaimedBytes: measured.data.bytes,
        });
      }
    );
  }

  dispose(): void {
    for (const record of this.records.values()) {
      record.binding.dispose();
      void record.scope.dispose();
      record.machine.dispose();
    }
    this.records.clear();
    this.host.dispose();
    this.operationLogHost.dispose();
    this.lifecycle.dispose();
    this.activity.dispose();
    void this.topologyObserver.dispose();
  }

  /** Ensures a workspace state exists so a fresh daemon can restore a live-topic attachment. */
  resolveState(workspace: HostFileRef): LiveSource {
    return this.recordFor(workspace).state;
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
      state: cell.states.state,
      binding,
      scope: this.scope.child(`workspace:${key}`),
    };
    this.records.set(key, record);
    this.topologyObserver.watch(workspace);
    this.syncActivity(workspace);
    return record;
  }

  private async withOperation<T>(
    workspace: HostFileRef,
    params: WorkspaceOperationRecordParams,
    commandFactory: (operationId: string, startedAt: number) => WorkspaceCommand,
    ctx: LiveJobContext<WorkspaceOperationProgress>,
    run: (
      stage: StageReporter,
      ctx: LiveJobContext<WorkspaceOperationProgress>
    ) => Promise<Result<T, WorkspaceError>>
  ): Promise<Result<T, WorkspaceError>> {
    await this.waitForOperationRecordRehydration();
    const record = this.recordFor(workspace);
    const startedAt = this.now();
    const command = commandFactory(ctx.jobId, startedAt);
    if (command.type === 'Teardown') {
      const preempted = await this.preemptForTeardown(record, ctx.signal);
      if (!preempted.success) return preempted;
    }
    const started = record.machine.dispatch(command, undefined);
    if (!started.success) {
      return started;
    }

    const kind = operationKindForCommand(command);
    const controller = new AbortController();
    const operationCtx = {
      ...ctx,
      signal: controller.signal,
    };
    const abortOperation = () => {
      if (!controller.signal.aborted) controller.abort(ctx.signal.reason);
    };
    if (ctx.signal.aborted) abortOperation();
    else ctx.signal.addEventListener('abort', abortOperation, { once: true });
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => {
      settle = resolve;
    });
    record.currentOperation = {
      kind,
      operationId: ctx.jobId,
      controller,
      settled,
    };
    this.operationControllers.set(ctx.jobId, controller);
    const stage = new StageReporter(kind, ctx.jobId, ctx, (progress) =>
      this.updateOperationStages(ctx.jobId, progress)
    );
    try {
      const startResult = await this.markOperationStarted(ctx.jobId, kind, workspace, params);
      if (!startResult.success) {
        record.machine.apply({ type: 'OperationFailed', error: startResult.error });
        return err(startResult.error);
      }

      const result = await run(stage, operationCtx);
      if (result.success) {
        record.machine.apply({ type: 'OperationCompleted' });
        await this.markOperationSucceeded(ctx.jobId, kind, result.data);
      } else {
        record.machine.apply({ type: 'OperationFailed', error: result.error });
        stage.failCurrent(result.error);
        await this.markOperationFailed(ctx.jobId, result.error);
      }
      return result;
    } catch (error) {
      const workspaceError = toWorkspaceError(error);
      record.machine.apply({ type: 'OperationFailed', error: workspaceError });
      stage.failCurrent(workspaceError);
      await this.markOperationFailed(ctx.jobId, workspaceError);
      return err(workspaceError);
    } finally {
      ctx.signal.removeEventListener('abort', abortOperation);
      if (record.currentOperation?.operationId === ctx.jobId) {
        record.currentOperation = undefined;
      }
      this.operationControllers.delete(ctx.jobId);
      settle();
    }
  }

  private async waitForOperationRecordRehydration(): Promise<void> {
    await this.rehydration;
  }

  private async rehydrateOperationRecords(): Promise<void> {
    await this.pruneTerminalOperationRecords();

    const listed = await this.operationRecords.list();
    if (!listed.success) {
      this.onError('workspace operation record rehydrate list', listed.error);
      return;
    }

    for (const record of listed.data) {
      const inspected = await this.provisioner.inspect(record.workspace);
      if (inspected.success && inspected.data.kind === 'missing') {
        if (isTerminalStatus(record.status)) {
          const removed = await this.operationRecords.removeRecord(record.requestId);
          if (!removed.success) {
            this.onError('workspace operation record stale prune', removed.error);
          } else {
            this.publishOperationLog();
          }
          continue;
        }
      }

      if (isTerminalStatus(record.status)) continue;
      if (record.kind === 'teardown' || record.kind === 'clean-artifacts') {
        const resumed = await this.operationRecords.updateRecord(record.requestId, {
          status: 'pending',
          suspendedCause: undefined,
          error: undefined,
          result: undefined,
          finishedAt: undefined,
        });
        if (!resumed.success) {
          this.onError('workspace operation record resume', resumed.error);
        } else if (resumed.data && !isWorkspaceOperationRecordStatusConflict(resumed.data)) {
          this.publishOperationLog();
          this.enqueueSubmittedOperation(resumed.data);
        }
      } else {
        const suspended = await this.operationRecords.updateRecord(record.requestId, {
          status: 'suspended',
          suspendedCause: 'daemon-restart',
          finishedAt: this.now(),
        });
        if (!suspended.success) {
          this.onError('workspace operation record suspend', suspended.error);
        } else {
          this.publishOperationLog();
        }
      }
    }
  }

  private async pruneTerminalOperationRecords(): Promise<void> {
    const pruned = await this.operationRecords.pruneTerminal(OPERATION_RECORD_RETENTION_MS);
    if (!pruned.success) {
      this.onError('workspace operation record terminal prune', pruned.error);
    } else if (pruned.data.length > 0) {
      this.publishOperationLog();
    }
  }

  private async markOperationStarted(
    requestId: string,
    kind: WorkspaceOperationKind,
    workspace: HostFileRef,
    params: WorkspaceOperationRecordParams
  ): Promise<Result<void, WorkspaceError>> {
    const updated = await this.operationRecords.updateRecord(
      requestId,
      {
        status: 'running',
        suspendedCause: undefined,
        stages: undefined,
        result: undefined,
        error: undefined,
        finishedAt: undefined,
      },
      { expectStatus: ['pending', 'running'] }
    );
    if (!updated.success) {
      this.onError('workspace operation record start update', updated.error);
      return err(recordStoreErrorToWorkspaceError(updated.error));
    }
    if (isWorkspaceOperationRecordStatusConflict(updated.data)) {
      return err(operationStatusConflict(updated.data.record.status));
    }
    if (updated.data) {
      this.publishOperationLog();
      return ok(undefined);
    }

    const appended = await this.operationRecords.appendRecord({
      requestId,
      kind,
      workspace,
      params,
      status: 'running',
    });
    if (!appended.success) {
      this.onError('workspace operation record append', appended.error);
      return err(recordStoreErrorToWorkspaceError(appended.error));
    }
    this.publishOperationLog();
    return ok(undefined);
  }

  private updateOperationStages(requestId: string, stages: WorkspaceOperationProgress): void {
    void this.operationRecords
      .updateRecord(requestId, { stages }, { expectStatus: ['running'] })
      .then((updated) => {
        if (!updated.success) {
          this.onError('workspace operation record progress update', updated.error);
          return;
        }
        if (isWorkspaceOperationRecordStatusConflict(updated.data)) return;
        this.publishOperationLog();
      });
  }

  private async markOperationSucceeded(
    requestId: string,
    kind: WorkspaceOperationKind,
    data: unknown
  ): Promise<void> {
    const updated = await this.operationRecords.updateRecord(requestId, {
      status: 'succeeded',
      result: resultRecordForKind(kind, data),
      error: undefined,
      finishedAt: this.now(),
    });
    if (!updated.success) {
      this.onError('workspace operation record success update', updated.error);
      return;
    }
    this.publishOperationLog();
  }

  private async markOperationFailed(requestId: string, error: WorkspaceError): Promise<void> {
    const updated = await this.operationRecords.updateRecord(requestId, {
      status: error.type === 'cancelled' ? 'cancelled' : 'failed',
      error,
      finishedAt: this.now(),
    });
    if (!updated.success) {
      this.onError('workspace operation record failure update', updated.error);
      return;
    }
    this.publishOperationLog();
  }

  private publishOperationLog(): void {
    this.operationLogPublishLanes.coalesce(
      OPERATION_LOG_PUBLISH_KEY,
      async () => {
        const listed = await this.operationRecords.list();
        if (!listed.success) {
          this.onError('workspace operation log publish', listed.error);
          return;
        }
        const list: WorkspaceOperationRecordMap = {};
        for (const record of listed.data) {
          list[record.requestId] = record;
        }
        this.operationLogHost.get({})?.states.list.replace(list);
      },
      (error) => this.onError('workspace operation log publish', error)
    );
  }

  private async preemptForTeardown(
    record: WorkspaceRuntimeRecord,
    signal: AbortSignal
  ): Promise<Result<void, WorkspaceError>> {
    const current = record.currentOperation;
    if (!current || current.kind === 'teardown') return ok(undefined);

    if (!current.controller.signal.aborted) {
      current.controller.abort({
        type: 'cancelled',
        message: 'Workspace operation was preempted by teardown',
      } satisfies WorkspaceError);
    }

    try {
      await runWithTimeout(() => current.settled, {
        timeoutMs: PREEMPT_SETTLE_TIMEOUT_MS,
        signal,
      });
      return ok(undefined);
    } catch (error) {
      if (error instanceof TimeoutError) {
        return err(operationInFlight(record.machine.current().operation.kind));
      }
      return err(toWorkspaceError(error));
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

  private async runTerminalsTeardown(
    workspace: HostFileRef,
    automation: ActivateWorkspaceInput['automation'],
    ctx: LiveJobContext<WorkspaceOperationProgress>,
    stage: StageReporter
  ): Promise<Result<void, WorkspaceError>> {
    if (!this.terminals || !automation?.teardown) return ok(undefined);

    const stageId = 'script:teardown';
    stage.start(stageId, 'Run teardown script');
    const jobs = createLiveJobReplica(
      scriptWorkflowsContract.runWorkflow,
      this.terminals.runWorkflow
    );
    const lease = await jobs.start({
      workspace,
      kind: 'teardown',
      nodes: [
        {
          id: 'teardown',
          label: 'Teardown',
          command: automation.teardown,
          shellSetup: automation.shellSetup,
          cwd: nativePathFromWorkspace(workspace),
          env: automationEnv(automation),
        },
      ],
    });
    const job = await lease.ready();
    const cancel = () => void job.cancel();
    ctx.signal.addEventListener('abort', cancel, { once: true });
    try {
      await job.result;
      stage.done(stageId);
      return ok(undefined);
    } catch (error) {
      const workspaceError = terminalJobErrorToWorkspaceError(error);
      stage.fail(stageId, workspaceError);
      return err(workspaceError);
    } finally {
      ctx.signal.removeEventListener('abort', cancel);
      await lease.release();
      await jobs.dispose();
    }
  }

  private async runTerminalsPrepare(
    workspace: HostFileRef,
    automation: ActivateWorkspaceInput['automation'],
    ctx: LiveJobContext<WorkspaceOperationProgress>,
    stage: StageReporter
  ): Promise<Result<void, WorkspaceError>> {
    if (!automation?.prepare) {
      stage.skip('script:prepare', 'Run prepare script');
      return ok(undefined);
    }
    if (!this.terminals) {
      return err({
        type: 'terminal-runtime-unavailable',
        message: 'Terminal runtime is unavailable for prepare script',
        stageId: 'script:prepare',
      });
    }

    const stageId = 'script:prepare';
    stage.start(stageId, 'Run prepare script');
    const jobs = createLiveJobReplica(
      scriptWorkflowsContract.runWorkflow,
      this.terminals.runWorkflow
    );
    const lease = await jobs.start({
      workspace,
      kind: 'prepare',
      nodes: [
        {
          id: 'prepare',
          label: 'Prepare',
          command: automation.prepare,
          shellSetup: automation.shellSetup,
          cwd: nativePathFromWorkspace(workspace),
          env: automationEnv(automation),
        },
      ],
    });
    const job = await lease.ready();
    const unsubscribe = job.onProgress((progress) => {
      if (progress.message) stage.update(stageId, { message: progress.message });
    });
    const cancel = () => void job.cancel();
    ctx.signal.addEventListener('abort', cancel, { once: true });
    try {
      await job.result;
      stage.done(stageId);
      return ok(undefined);
    } catch (error) {
      const workspaceError = terminalJobErrorToWorkspaceError(error);
      stage.fail(stageId, workspaceError);
      return err(workspaceError);
    } finally {
      ctx.signal.removeEventListener('abort', cancel);
      unsubscribe();
      await lease.release();
      await jobs.dispose();
    }
  }

  private startPostActivationAutomation(
    workspace: HostFileRef,
    automation: ActivateWorkspaceInput['automation']
  ): void {
    const nodes = postActivationWorkflowNodes(workspace, automation);
    if (nodes.length === 0) return;
    if (!this.terminals) {
      this.onError(
        'workspace post-activation automation',
        new Error('Terminal runtime is unavailable for setup/run scripts')
      );
      return;
    }

    void this.runPostActivationAutomation(workspace, nodes).catch((error: unknown) => {
      this.onError('workspace post-activation automation', error);
    });
  }

  private async runPostActivationAutomation(
    workspace: HostFileRef,
    nodes: RunScriptWorkflowInput['nodes']
  ): Promise<void> {
    if (!this.terminals) return;
    const jobs = createLiveJobReplica(
      scriptWorkflowsContract.runWorkflow,
      this.terminals.runWorkflow
    );
    const lease = await jobs.start({ workspace, kind: 'post-activation', nodes });
    try {
      const job = await lease.ready();
      await job.result;
    } catch (error) {
      this.onError('workspace post-activation automation', terminalJobErrorToWorkspaceError(error));
    } finally {
      await lease.release();
      await jobs.dispose();
    }
  }

  private async killTerminalsScope(workspace: HostFileRef): Promise<void> {
    if (!this.terminals) return;
    await this.terminals.killScope({ workspace });
  }

  private async detachTerminalsScope(workspace: HostFileRef): Promise<void> {
    if (!this.terminals) return;
    await this.terminals.detachScope({ workspace });
  }
}

function operationKindForCommand(command: WorkspaceCommand): WorkspaceOperationKind {
  switch (command.type) {
    case 'Provision':
      return 'provision';
    case 'Convert':
      return 'convert';
    case 'Activate':
      return 'activate';
    case 'Deactivate':
      return 'deactivate';
    case 'Teardown':
      return 'teardown';
    case 'CleanArtifacts':
      return 'clean-artifacts';
  }
}

function resultRecordForKind(
  kind: WorkspaceOperationKind,
  data: unknown
): WorkspaceOperationRecordResult {
  switch (kind) {
    case 'provision':
    case 'convert':
    case 'activate':
    case 'deactivate':
    case 'teardown':
      return { kind, data: data as WorkspaceOperationResult };
    case 'clean-artifacts':
      return { kind, data: data as CleanWorkspaceArtifactsResult };
  }
}

function operationInFlight(kind: WorkspaceOperationKind | 'idle'): WorkspaceError {
  return {
    type: 'operation-in-flight',
    message:
      kind === 'idle'
        ? 'Workspace operation did not settle before teardown'
        : `Workspace already has an active ${kind} operation`,
  };
}

function operationStatusConflict(status: string): WorkspaceError {
  return {
    type: status === 'cancelled' ? 'cancelled' : 'operation-status-conflict',
    message:
      status === 'cancelled'
        ? 'Operation was cancelled before it started'
        : `Operation cannot start from ${status} status`,
  };
}

class StageReporter {
  private readonly stages: WorkspaceOperationStage[] = [];
  private current: string | undefined;

  constructor(
    private readonly kind: WorkspaceOperationKind,
    private readonly operationId: string,
    private readonly ctx: LiveJobContext<WorkspaceOperationProgress>,
    private readonly onProgress?: (progress: WorkspaceOperationProgress) => void
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
    const progress = {
      operationId: this.operationId,
      kind: this.kind,
      stages: this.stages.map((stage) => ({ ...stage })),
    };
    this.ctx.progress(progress);
    this.onProgress?.(progress);
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

function recordStoreErrorToWorkspaceError(error: {
  type: string;
  message: string;
}): WorkspaceError {
  return {
    type: `operation-record-${error.type}`,
    message: error.message,
  };
}

function terminalJobErrorToWorkspaceError(error: unknown): WorkspaceError {
  if (error instanceof LiveJobFailedError) {
    return toWorkspaceError(error.error);
  }
  if (error instanceof LiveJobCancelledError) {
    return { type: 'cancelled', message: 'Terminal script workflow was cancelled' };
  }
  return toWorkspaceError(error);
}

function postActivationWorkflowNodes(
  workspace: HostFileRef,
  automation: ActivateWorkspaceInput['automation']
): RunScriptWorkflowInput['nodes'] {
  if (!automation) return [];
  const cwd = nativePathFromWorkspace(workspace);
  const env = automationEnv(automation);
  const nodes: RunScriptWorkflowInput['nodes'] = [];
  if (automation.setup && automation.autoRunSetup) {
    nodes.push({
      id: 'setup',
      label: 'Setup',
      command: automation.setup,
      shellSetup: automation.shellSetup,
      cwd,
      env,
    });
  }
  if (automation.run && automation.autoRunRun) {
    nodes.push({
      id: 'run',
      label: 'Run',
      command: automation.run,
      shellSetup: automation.shellSetup,
      cwd,
      env,
      dependsOn: nodes.some((node) => node.id === 'setup') ? ['setup'] : undefined,
      lifecycle: 'background',
    });
  }
  return nodes;
}

function automationEnv(automation: ActivateWorkspaceInput['automation']): Record<string, string> {
  return { ...stringEnv(process.env), ...(automation?.env ?? {}) };
}

type IgnoredArtifact = {
  relativePath: string;
  absolutePath: string;
};

type ArtifactMeasurement = {
  bytes: number;
  errors: { path: string; message: string }[];
};

async function measureWorkspacePath(
  absolutePath: string,
  displayPath: string,
  artifactRoots?: string[]
): Promise<Result<Awaited<ReturnType<typeof measureAbsolutePathUsage>>, WorkspaceError>> {
  try {
    return ok(await measureAbsolutePathUsage(absolutePath, displayPath, { artifactRoots }));
  } catch (error) {
    return err({
      type: 'io',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function measureArtifacts(
  workspacePath: string,
  artifacts: IgnoredArtifact[]
): Promise<Result<ArtifactMeasurement, WorkspaceError>> {
  let bytes = 0;
  const errors: { path: string; message: string }[] = [];
  for (const artifact of artifacts) {
    if (!isContainedBy(workspacePath, artifact.absolutePath)) {
      return err({
        type: 'invalid-path',
        message: `Ignored artifact escapes workspace: ${artifact.relativePath}`,
      });
    }
    const measured = await measureWorkspacePath(artifact.absolutePath, artifact.relativePath);
    if (!measured.success) {
      errors.push({ path: artifact.relativePath, message: measured.error.message });
      continue;
    }
    bytes += measured.data.exclusiveDiskBytes;
    errors.push(...measured.data.errors);
  }
  return ok({ bytes, errors });
}

async function listIgnoredArtifacts(
  workspacePath: string,
  signal?: AbortSignal
): Promise<Result<IgnoredArtifact[], WorkspaceError>> {
  const result = await runGit(['-c', 'core.quotePath=false', 'clean', '-ndX', '--'], {
    cwd: workspacePath,
    signal,
  });
  if (!result.success) {
    return err({
      type: result.error.type,
      message: gitErrorMessage(result.error),
    });
  }

  const root = path.resolve(workspacePath);
  const artifacts: IgnoredArtifact[] = [];
  for (const line of result.data.stdout.split(/\r?\n/u)) {
    const relativePath = parseGitCleanDryRunLine(line);
    if (!relativePath) continue;
    const absolutePath = path.resolve(root, relativePath);
    if (!isContainedBy(root, absolutePath)) {
      return err({
        type: 'invalid-path',
        message: `Ignored artifact escapes workspace: ${relativePath}`,
      });
    }
    artifacts.push({ relativePath, absolutePath });
  }
  return ok(artifacts);
}

function parseGitCleanDryRunLine(line: string): string | undefined {
  const prefix = 'Would remove ';
  if (!line.startsWith(prefix)) return undefined;
  return normalizeArtifactPath(line.slice(prefix.length));
}

function normalizeArtifactPath(value: string): string | undefined {
  const normalized = value.trim().replace(/\/$/u, '');
  if (!normalized || normalized === '.' || normalized === '..') return undefined;
  return normalized.split('\\').join('/');
}

function matchesPreservePatterns(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPreservePattern(relativePath, pattern));
}

function matchesPreservePattern(relativePath: string, pattern: string): boolean {
  if (!isSafePreservePattern(pattern)) return false;
  const normalized = toPosixPath(pattern);
  if (globMatcher(normalized)(relativePath)) return true;

  const artifactPrefix = relativePath.endsWith('/') ? relativePath : `${relativePath}/`;
  return normalized.startsWith(artifactPrefix);
}

function isSafePreservePattern(pattern: string): boolean {
  if (!pattern || path.isAbsolute(pattern)) return false;
  return !toPosixPath(pattern)
    .split('/')
    .some((part) => part === '..');
}

function globMatcher(pattern: string): (relativePath: string) => boolean {
  const regexp = new RegExp(`^${globToRegex(pattern)}$`);
  return (relativePath) => regexp.test(relativePath);
}

function globToRegex(pattern: string): string {
  let regex = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === '*' && next === '*') {
      regex += '.*';
      index++;
    } else if (char === '*') {
      regex += '[^/]*';
    } else if (char === '?') {
      regex += '[^/]';
    } else {
      regex += escapeRegex(char);
    }
  }
  return regex;
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function isContainedBy(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  );
}

export function createUnavailableWorkspaceError(error: unknown): WorkspaceError {
  return toWorkspaceError(error);
}

export function workspaceOperationId(): string {
  return randomUUID();
}
