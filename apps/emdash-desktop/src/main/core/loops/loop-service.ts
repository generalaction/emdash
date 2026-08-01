import { getPlugin } from '@main/core/agents/plugin-registry';
import { projectManager } from '@main/core/projects/project-manager';
import { getTasks } from '@main/core/tasks/operations/getTasks';
import { taskService } from '@main/core/tasks/task-service';
import { resolveTaskWorkspaceTarget } from '@main/core/workspaces/resolve-task-workspace-target';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import { err, ok, type Result } from '@main/lib/result';
import { loopPhaseUpdatedChannel, loopUpdatedChannel } from '@shared/core/loops/loopEvents';
import {
  VERIFIER_IDS,
  type CreateLoopParams,
  type Loop,
  type LoopPhase,
  type LoopVerifierAvailability,
  type LoopWithPhases,
} from '@shared/core/loops/loops';
import { getLoopSessionDriver } from './drivers/driver-registry';
import type { LoopSessionDriver } from './drivers/session-driver';
import {
  createTaskWithLoop as createTaskWithLoopOperation,
  type CreateTaskWithLoopError,
  type CreateTaskWithLoopParams,
  type CreateTaskWithLoopSuccess,
} from './operations/create-task-with-loop';
import {
  createLoop as createLoopOperation,
  deleteLoop as deleteLoopOperation,
  getLoop as getLoopOperation,
  getLoopsForProject as getLoopsForProjectOperation,
  pauseRunningLoopsForBoot,
  resetPhaseForRetry,
  updateLoop,
  updatePhase,
} from './operations/loop-operations';
import type { LoopOperationError } from './operations/types';
import { PhaseRunner, type LoopRunControl } from './phase-runner';
import { runLoopCommand } from './runtime/loop-command-runner';
import {
  resolveLoopExecutionTarget,
  type LoopExecutionTarget,
} from './runtime/loop-execution-target';
import { getVerifier } from './verifiers/registry';

export type LoopServiceError =
  | LoopOperationError
  | { kind: 'feature-disabled'; message: string }
  | { kind: 'invalid-state'; message: string }
  | { kind: 'workspace-unavailable'; message: string }
  | { kind: 'run-failed'; message: string };

class LoopRunHandle implements LoopRunControl {
  private readonly abortController = new AbortController();
  private readonly completion: Promise<void>;
  private resolveCompletion!: () => void;
  private completed = false;
  private reason: 'pause' | 'cancel' | null = null;
  private activeConversationId: string | null = null;
  private activeDriver: LoopSessionDriver | null = null;

  currentPhaseId: string | null = null;

  constructor() {
    this.completion = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  stopReason(): 'pause' | 'cancel' | null {
    return this.reason;
  }

  async setActiveConversation(
    conversationId: string | null,
    driver: LoopSessionDriver | null
  ): Promise<void> {
    this.activeConversationId = conversationId;
    this.activeDriver = driver;
    if (this.reason && conversationId && driver) {
      await driver.cancelPrompt(conversationId);
    }
  }

  async request(reason: 'pause' | 'cancel'): Promise<void> {
    if (this.reason !== 'cancel') this.reason = reason;
    if (!this.abortController.signal.aborted) {
      this.abortController.abort(new Error(`Loop ${reason}`));
    }

    if (this.activeConversationId && this.activeDriver) {
      await this.activeDriver.cancelPrompt(this.activeConversationId);
    }
  }

  finish(): void {
    if (this.completed) return;
    this.completed = true;
    this.resolveCompletion();
  }

  waitForCompletion(): Promise<void> {
    return this.completion;
  }
}

function emitLoop(loop: Loop): void {
  events.emit(loopUpdatedChannel, { loop });
}

function emitPhase(phase: LoopPhase): void {
  events.emit(loopPhaseUpdatedChannel, { loopId: phase.loopId, phase });
}

function serviceError(error: LoopOperationError): LoopServiceError {
  return error;
}

async function loadLoop(loopId: string): Promise<Result<LoopWithPhases, LoopServiceError>> {
  const loop = await getLoopOperation(loopId);
  if (!loop) return err({ kind: 'not-found', message: 'Loop not found' });
  return ok(loop);
}

async function resolveWorkspacePath(taskId: string): Promise<Result<string, LoopServiceError>> {
  const target = await resolveTaskWorkspaceTarget(taskId);
  if (!target.success) {
    return err({ kind: 'workspace-unavailable', message: target.error.message });
  }
  return ok(target.data.path);
}

async function resolveExecutionTarget(
  loop: Loop
): Promise<Result<LoopExecutionTarget, LoopServiceError>> {
  const project = projectManager.getProject(loop.projectId);
  const task = (await getTasks(loop.projectId)).find((candidate) => candidate.id === loop.taskId);
  if (!project || !task) {
    return err({ kind: 'workspace-unavailable', message: 'Loop task or project is unavailable' });
  }

  const settings = await project.settings.get();
  const defaultBranch =
    typeof settings.defaultBranch === 'string'
      ? settings.defaultBranch
      : settings.defaultBranch?.name;
  const target = await resolveLoopExecutionTarget(loop.taskId, {
    taskName: task.name,
    projectPath: project.repoPath,
    defaultBranch,
  });
  if (!target.success) {
    return err({ kind: 'workspace-unavailable', message: target.error.message });
  }
  return target;
}

export class LoopService {
  private readonly activeRuns = new Map<string, LoopRunHandle>();
  private enabled = false;
  private readonly runner = new PhaseRunner({
    onLoopUpdated: emitLoop,
    onPhaseUpdated: emitPhase,
  });

  async initialize(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    const paused = await pauseRunningLoopsForBoot();
    for (const loop of paused) {
      emitLoop(loop);
    }
  }

  async reconcileEnabledState(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    if (enabled) return;

    const handles = Array.from(this.activeRuns.values());
    await Promise.all(handles.map((handle) => handle.request('pause')));
    await Promise.all(handles.map((handle) => handle.waitForCompletion()));
    const paused = await pauseRunningLoopsForBoot();
    for (const loop of paused) emitLoop(loop);
  }

  private requireEnabled(): Result<void, LoopServiceError> {
    return this.enabled
      ? ok()
      : err({
          kind: 'feature-disabled',
          message: 'ACP Loops are disabled in Experimental Settings',
        });
  }

  async createLoop(params: CreateLoopParams): Promise<Result<LoopWithPhases, LoopServiceError>> {
    const enabled = this.requireEnabled();
    if (!enabled.success) return enabled;
    const result = await createLoopOperation(params);
    if (!result.success) return err(serviceError(result.error));

    emitLoop(result.data);
    for (const phase of result.data.phases) {
      emitPhase(phase);
    }

    return result;
  }

  async createTaskWithLoop(
    params: CreateTaskWithLoopParams
  ): Promise<Result<CreateTaskWithLoopSuccess, CreateTaskWithLoopError | LoopServiceError>> {
    const enabled = this.requireEnabled();
    if (!enabled.success) return enabled;
    const requestedModel = params.loop.model?.trim() ?? '';
    const models = getPlugin('codex').capabilities.models;
    if (models.kind !== 'selectable' || !(requestedModel in models.modelOptions)) {
      return err({
        kind: 'invalid-state',
        message: `Codex model '${requestedModel || '(empty)'}' is not available`,
      });
    }
    const result = await createTaskWithLoopOperation(params);
    if (!result.success) return result;

    taskService.notifyTaskCreated(result.data.task.task, params.task);
    emitLoop(result.data.loop);
    for (const phase of result.data.loop.phases) emitPhase(phase);
    return result;
  }

  async getLoopsForProject(projectId: string): Promise<Result<LoopWithPhases[], LoopServiceError>> {
    const enabled = this.requireEnabled();
    if (!enabled.success) return enabled;
    return ok(await getLoopsForProjectOperation(projectId));
  }

  async getLoop(loopId: string): Promise<Result<LoopWithPhases, LoopServiceError>> {
    const enabled = this.requireEnabled();
    if (!enabled.success) return enabled;
    return loadLoop(loopId);
  }

  async getVerifierAvailability(
    taskId: string
  ): Promise<Result<LoopVerifierAvailability[], LoopServiceError>> {
    const enabled = this.requireEnabled();
    if (!enabled.success) return enabled;
    const cwd = await resolveWorkspacePath(taskId);
    if (!cwd.success) {
      return ok(
        VERIFIER_IDS.map((id) => {
          const verifier = getVerifier(id);
          return {
            id,
            label: verifier?.label ?? 'Native Browser Preview',
            available: false,
            reason:
              id === 'agent-browser'
                ? 'Browser verification is provided by the v2 clean-room E2E gate'
                : cwd.error.message,
          };
        })
      );
    }

    const availability = await Promise.all(
      VERIFIER_IDS.map(async (id) => {
        const verifier = getVerifier(id);
        if (!verifier) {
          return {
            id,
            label: 'Native Browser Preview',
            available: false,
            reason: 'Browser verification is provided by the v2 clean-room E2E gate',
          };
        }
        const result = await verifier.checkAvailability(cwd.data);
        return {
          id,
          label: verifier.label,
          available: result.success ? result.data.available : false,
          reason: result.success ? result.data.message : result.error.message,
        };
      })
    );

    return ok(availability);
  }

  async startLoop(loopId: string): Promise<Result<LoopWithPhases, LoopServiceError>> {
    return this.startOrResume(loopId, 'start');
  }

  async resumeLoop(loopId: string): Promise<Result<LoopWithPhases, LoopServiceError>> {
    return this.startOrResume(loopId, 'resume');
  }

  async pauseLoop(loopId: string): Promise<Result<LoopWithPhases, LoopServiceError>> {
    const handle = this.activeRuns.get(loopId);
    if (handle) {
      await handle.request('pause');
      await handle.waitForCompletion();
    }

    const updated = await updateLoop(loopId, { status: 'paused' });
    if (!updated.success) return err(serviceError(updated.error));
    emitLoop(updated.data);

    return loadLoop(loopId);
  }

  async cancelLoop(loopId: string): Promise<Result<LoopWithPhases, LoopServiceError>> {
    const handle = this.activeRuns.get(loopId);
    if (handle) {
      await handle.request('cancel');
      await handle.waitForCompletion();
      if (handle.currentPhaseId) {
        const phase = await updatePhase(handle.currentPhaseId, {
          status: 'failed',
          lastError: 'Loop cancelled',
        });
        if (phase.success) emitPhase(phase.data);
      }
    }

    const updated = await updateLoop(loopId, { status: 'failed' });
    if (!updated.success) return err(serviceError(updated.error));
    emitLoop(updated.data);

    return loadLoop(loopId);
  }

  async retryPhase(
    loopId: string,
    phaseId: string
  ): Promise<Result<LoopWithPhases, LoopServiceError>> {
    const enabled = this.requireEnabled();
    if (!enabled.success) return enabled;
    if (this.activeRuns.has(loopId)) {
      return err({ kind: 'conflict', message: 'Cannot retry a phase while the loop is running' });
    }

    const loopResult = await loadLoop(loopId);
    if (!loopResult.success) return loopResult;

    const phase = loopResult.data.phases.find((candidate) => candidate.id === phaseId);
    if (!phase) return err({ kind: 'not-found', message: 'Loop phase not found' });

    const reset = await resetPhaseForRetry(phaseId);
    if (!reset.success) return err(serviceError(reset.error));
    emitPhase(reset.data);

    const updated = await updateLoop(loopId, {
      status: 'paused',
      currentPhaseIndex: phase.idx,
    });
    if (!updated.success) return err(serviceError(updated.error));
    emitLoop(updated.data);

    return loadLoop(loopId);
  }

  async deleteLoop(loopId: string): Promise<Result<void, LoopServiceError>> {
    const handle = this.activeRuns.get(loopId);
    if (handle) {
      await handle.request('cancel');
      await handle.waitForCompletion();
    }

    const result = await deleteLoopOperation(loopId);
    if (!result.success) return err(serviceError(result.error));
    return ok();
  }

  private async startOrResume(
    loopId: string,
    action: 'start' | 'resume'
  ): Promise<Result<LoopWithPhases, LoopServiceError>> {
    const enabled = this.requireEnabled();
    if (!enabled.success) return enabled;
    if (this.activeRuns.has(loopId)) {
      return err({ kind: 'conflict', message: 'Loop is already running' });
    }

    const handle = new LoopRunHandle();
    this.activeRuns.set(loopId, handle);
    let executionTarget: LoopExecutionTarget | undefined;
    let launched = false;

    try {
      const stopped = this.preLaunchStop(handle, action);
      if (stopped) return stopped;

      const loopResult = await loadLoop(loopId);
      if (!loopResult.success) return loopResult;
      const stoppedAfterLoad = this.preLaunchStop(handle, action);
      if (stoppedAfterLoad) return stoppedAfterLoad;

      const allowed =
        action === 'start'
          ? ['draft', 'paused', 'failed'].includes(loopResult.data.status)
          : loopResult.data.status === 'paused';
      if (!allowed) {
        return err({
          kind: 'invalid-state',
          message: `Cannot ${action} loop with status '${loopResult.data.status}'`,
        });
      }

      const resolvedTarget = await resolveExecutionTarget(loopResult.data);
      if (!resolvedTarget.success) return resolvedTarget;
      executionTarget = resolvedTarget.data;
      const stoppedAfterTarget = this.preLaunchStop(handle, action);
      if (stoppedAfterTarget) return stoppedAfterTarget;

      const checkpoint = await this.initializeCheckpointAuthority(loopResult.data, executionTarget);
      if (!checkpoint.success) return checkpoint;
      const stoppedAfterCheckpoint = this.preLaunchStop(handle, action);
      if (stoppedAfterCheckpoint) return stoppedAfterCheckpoint;

      const running = await updateLoop(loopId, { status: 'running' });
      if (!running.success) return err(serviceError(running.error));
      const stoppedAfterTransition = this.preLaunchStop(handle, action);
      if (stoppedAfterTransition) {
        await updateLoop(loopId, { status: 'paused' });
        return stoppedAfterTransition;
      }
      emitLoop(running.data);

      const ownedTarget = executionTarget;
      launched = true;
      void this.runLoop(loopId, ownedTarget, handle).finally(() => {
        ownedTarget.dispose();
        if (this.activeRuns.get(loopId) === handle) this.activeRuns.delete(loopId);
        handle.finish();
      });

      return loadLoop(loopId);
    } finally {
      if (!launched) {
        executionTarget?.dispose();
        if (this.activeRuns.get(loopId) === handle) this.activeRuns.delete(loopId);
        handle.finish();
      }
    }
  }

  private preLaunchStop(
    handle: LoopRunHandle,
    action: 'start' | 'resume'
  ): Result<never, LoopServiceError> | null {
    if (!this.enabled) {
      return err({
        kind: 'feature-disabled',
        message: 'ACP Loops are disabled in Experimental Settings',
      });
    }
    const reason = handle.stopReason();
    if (!reason) return null;
    return err({
      kind: 'invalid-state',
      message: `Loop ${action} was ${reason === 'pause' ? 'paused' : 'cancelled'}`,
    });
  }

  private async initializeCheckpointAuthority(
    loop: LoopWithPhases,
    target: LoopExecutionTarget
  ): Promise<Result<void, LoopServiceError>> {
    if (loop.config?.version !== '2' || loop.state?.version !== '2') return ok();
    try {
      const head = (
        await runLoopCommand(target, 'git', ['rev-parse', 'HEAD'], { timeoutMs: 60_000 })
      ).stdout.trim();
      const expected = loop.state.checkpointCommit;
      if (expected && expected !== head) {
        return err({
          kind: 'invalid-state',
          message: `Loop checkpoint drift: expected ${expected}, observed ${head}`,
        });
      }
      if (!loop.state.baseCommit) {
        const initialized = await updateLoop(loop.id, {
          state: {
            ...loop.state,
            baseCommit: head,
            expectedFeatureHead: head,
            checkpointCommit: head,
          },
        });
        if (!initialized.success) return err(serviceError(initialized.error));
        emitLoop(initialized.data);
      }
      return ok();
    } catch (error) {
      return err({
        kind: 'workspace-unavailable',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async runLoop(
    loopId: string,
    executionTarget: LoopExecutionTarget,
    handle: LoopRunHandle
  ): Promise<void> {
    try {
      const driver = getLoopSessionDriver('acp');

      while (!handle.stopReason()) {
        const loop = await getLoopOperation(loopId);
        if (!loop) return;
        if (loop.status !== 'running') return;

        const phase = loop.phases.find((candidate) => candidate.idx === loop.currentPhaseIndex);
        if (!phase) {
          const completed = await updateLoop(loopId, { status: 'completed' });
          if (completed.success) emitLoop(completed.data);
          return;
        }

        if (phase.status === 'passed') {
          const next = await updateLoop(loopId, { currentPhaseIndex: phase.idx + 1 });
          if (next.success) emitLoop(next.data);
          continue;
        }

        handle.currentPhaseId = phase.id;
        const current = await updateLoop(loopId, { currentPhaseIndex: phase.idx });
        if (current.success) emitLoop(current.data);

        const result = await this.runner.runPhase({
          loop,
          phase,
          executionTarget,
          driver,
          control: handle,
        });

        if (!result.success) {
          const failed = await updateLoop(loopId, { status: 'failed' });
          if (failed.success) emitLoop(failed.data);
          log.warn('Loop run failed', { loopId, error: result.error.message });
          return;
        }

        if (result.data.kind === 'passed') {
          const next = await updateLoop(loopId, { currentPhaseIndex: phase.idx + 1 });
          if (next.success) emitLoop(next.data);
          continue;
        }

        if (result.data.kind === 'failed' || result.data.kind === 'paused') return;
        if (result.data.kind === 'cancelled') return;
      }
    } catch (error) {
      const failed = await updateLoop(loopId, { status: 'failed' });
      if (failed.success) emitLoop(failed.data);
      log.error('Loop run threw unexpectedly', {
        loopId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const loopService = new LoopService();
