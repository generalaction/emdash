import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import {
  createLiveModelHost,
  createLiveJobReplica,
  LiveJobCancelledError,
  LiveJobFailedError,
  type LiveJobContext,
  type LiveModelHost,
} from '@emdash/wire';
import type { ContractClient } from '@emdash/wire/api';
import { bindMachineToLiveState } from '@emdash/wire';
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
import type { BootstrapProgress, RunPhaseInput } from '@runtimes/workspace/api/provisioning';
import { WorkspaceLifecycleManager } from '@runtimes/workspace/node/provisioning/lifecycle';
import { gitErrorMessage, runGit } from '@runtimes/workspace/node/provisioning/lifecycle/steps/run-git';
import type { IWatchService } from '@services/fs-watch/api';
import { measureAbsolutePathUsage } from '@services/fs-usage/node';
import {
  scriptWorkflowsContract,
  type ScriptWorkflowsContract,
} from '@services/script-workflows/api';
import { WorkspaceActivityIndex, type WorkspaceActivityProvider } from './activity';
import { createWorkspaceMachine, type WorkspaceMachine } from './machine/machine';
import { nativePathFromWorkspace } from './provisioning/paths';
import { NodeWorkspaceProvisioner, type WorkspaceProvisioner } from './provisioning/provisioner';
import { WorkspaceTopologyObserver } from './topology-observer';

type WorkspaceRuntimeRecord = {
  machine: WorkspaceMachine;
  binding: { dispose(): void };
  scope: Scope;
};

export type WorkspaceRuntimeOptions = {
  lifecycle?: WorkspaceLifecycleManager;
  provisioner?: WorkspaceProvisioner;
  terminals?: ContractClient<ScriptWorkflowsContract>;
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
  private readonly terminals: ContractClient<ScriptWorkflowsContract> | undefined;
  private readonly scope: Scope;
  private readonly now: () => number;
  private readonly onError: (context: string, error: unknown) => void;
  private readonly records = new Map<string, WorkspaceRuntimeRecord>();
  private readonly operationLane = new Set<string>();
  private readonly activity: WorkspaceActivityIndex;
  private readonly topologyObserver: WorkspaceTopologyObserver;

  constructor(options: WorkspaceRuntimeOptions = {}) {
    this.host = createLiveModelHost(workspaceContract.workspace);
    this.lifecycle = options.lifecycle ?? new WorkspaceLifecycleManager();
    this.provisioner = options.provisioner ?? new NodeWorkspaceProvisioner();
    this.terminals = options.terminals;
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

  async measureUsage(
    input: MeasureWorkspaceUsageInput,
    signal?: AbortSignal
  ): Promise<Result<WorkspaceUsage, WorkspaceError>> {
    const workspacePath = nativePathFromWorkspace(input.workspace);
    const total = await measureWorkspacePath(workspacePath, '');
    if (!total.success) return err(total.error);

    const artifacts = await measureIgnoredArtifacts(workspacePath, signal);
    if (!artifacts.success) return err(artifacts.error);

    return ok({
      workspace: input.workspace,
      path: workspacePath,
      totalBytes: total.data.exclusiveDiskBytes,
      artifactBytes: artifacts.data.bytes,
      errors: [...total.data.errors, ...artifacts.data.errors],
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
            ctx,
            stage,
            'deactivation-plan'
          );
          if (!result.success) return err(result.error);
          stage.done('deactivation-plan');
        } else {
          stage.skip('deactivation-plan', 'Run deactivation plan');
        }

        await this.runTerminalsTeardown(input.workspace, input.automation, ctx, stage);
        await this.killTerminalsScope(input.workspace);
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

  async cleanArtifacts(
    input: CleanWorkspaceArtifactsInput,
    ctx: LiveJobContext<WorkspaceOperationProgress>
  ): Promise<Result<CleanWorkspaceArtifactsResult, WorkspaceError>> {
    return await this.withOperation(input.workspace, 'clean-artifacts', ctx, async (stage) => {
      const workspacePath = nativePathFromWorkspace(input.workspace);
      stage.start('scan', 'Find ignored artifacts');
      const artifacts = await listIgnoredArtifacts(workspacePath, ctx.signal);
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
        if (ctx.signal.aborted) return err({ type: 'cancelled', message: 'Operation cancelled' });
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
    });
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

  private async withOperation<T>(
    workspace: HostFileRef,
    kind: WorkspaceOperationKind,
    ctx: LiveJobContext<WorkspaceOperationProgress>,
    run: (stage: StageReporter) => Promise<Result<T, WorkspaceError>>
  ): Promise<Result<T, WorkspaceError>> {
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
          env: stringEnv(process.env),
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

  private async killTerminalsScope(workspace: HostFileRef): Promise<void> {
    if (!this.terminals) return;
    await this.terminals.killScope({ workspace });
  }

  private async detachTerminalsScope(workspace: HostFileRef): Promise<void> {
    if (!this.terminals) return;
    await this.terminals.detachScope({ workspace });
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

function terminalJobErrorToWorkspaceError(error: unknown): WorkspaceError {
  if (error instanceof LiveJobFailedError) {
    return toWorkspaceError(error.error);
  }
  if (error instanceof LiveJobCancelledError) {
    return { type: 'cancelled', message: 'Terminal script workflow was cancelled' };
  }
  return toWorkspaceError(error);
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
  displayPath: string
): Promise<Result<Awaited<ReturnType<typeof measureAbsolutePathUsage>>, WorkspaceError>> {
  try {
    return ok(await measureAbsolutePathUsage(absolutePath, displayPath));
  } catch (error) {
    return err({
      type: 'io',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function measureIgnoredArtifacts(
  workspacePath: string,
  signal?: AbortSignal
): Promise<Result<ArtifactMeasurement, WorkspaceError>> {
  const artifacts = await listIgnoredArtifacts(workspacePath, signal);
  if (!artifacts.success) return artifacts;
  return measureArtifacts(workspacePath, artifacts.data);
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

export function workspaceJobError(error: unknown): WorkspaceError {
  return toWorkspaceError(error);
}

export function workspaceOperationId(): string {
  return randomUUID();
}
