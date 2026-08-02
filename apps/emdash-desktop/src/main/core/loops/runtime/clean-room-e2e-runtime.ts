import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { app } from 'electron';
import { configureBrowserVerificationSession } from '@main/core/browser/browser-profile-session';
import { browserWebContentsRegistry } from '@main/core/browser/browser-webcontents-registry';
import { NativeBrowserVerificationService } from '@main/core/browser/native-browser-verification-service';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { previewServerService } from '@main/core/preview-servers/preview-server-service-instance';
import { projectManager } from '@main/core/projects/project-manager';
import { runtimeManager } from '@main/core/runtime/runtime-manager';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { getTaskEnvVars } from '@main/core/workspaces/workspace-env';
import { createWorkspaceFactory } from '@main/core/workspaces/workspace-factory';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { tasks, workspaces } from '@main/db/schema';
import { events } from '@main/lib/events';
import { err, ok, type Result } from '@main/lib/result';
import { loopPhaseStateV2Schema, type LoopStageResult } from '@shared/core/loops/loop-phase-state';
import { loopStateV2Schema, type LoopSessionTarget } from '@shared/core/loops/loop-state';
import type { LoopPhase, LoopWithPhases } from '@shared/core/loops/loops';
import {
  loopBrowserActionChannel,
  loopBrowserCloseChannel,
  loopBrowserClosedChannel,
  loopBrowserReadyChannel,
  loopBrowserRequestChannel,
  loopBrowserResultChannel,
} from '@shared/events/loopBrowserEvents';
import { CleanRoomWorkspaceService } from '../clean-room/clean-room-workspace-service';
import { DurableCleanRoomCleanupJournal } from '../clean-room/durable-cleanup-journal';
import { FeatureSnapshotService } from '../clean-room/feature-snapshot-service';
import type { LoopSessionDriver } from '../drivers/session-driver';
import { LoopEvidenceStore } from '../evidence/loop-evidence-store';
import { CleanRoomE2EGate, type E2EGateDependencyError } from '../gates/clean-room-e2e-gate';
import { sameE2EDurableProgress } from '../gates/clean-room-e2e-progress';
import { CleanRoomE2ERequiredChecksAdapter } from '../gates/clean-room-e2e-required-checks';
import { e2eProgressStore } from '../operations/e2e-progress-store';
import { getLoop } from '../operations/loop-operations';
import { createNativeBrowserVerifier } from '../verifiers/native-browser';
import { NativeBrowserE2EAttestationService } from '../verifiers/native-browser-e2e-attestation';
import { priorPhasesForE2E } from './clean-room-e2e-prerequisites';
import { runLoopCommand } from './loop-command-runner';
import {
  resolveExplicitLoopExecutionTarget,
  type LoopExecutionTarget,
} from './loop-execution-target';

export type CleanRoomE2ERuntimeError = { message: string };

let cleanupJournal: DurableCleanRoomCleanupJournal | undefined;
let cleanRoomService: CleanRoomWorkspaceService | undefined;
let evidenceStore: LoopEvidenceStore | undefined;
let browserService: NativeBrowserVerificationService | undefined;

function getCleanupJournal(): DurableCleanRoomCleanupJournal {
  return (cleanupJournal ??= new DurableCleanRoomCleanupJournal(
    join(app.getPath('userData'), 'loops', 'clean-room-cleanup.json')
  ));
}

function getCleanRoomService(): CleanRoomWorkspaceService {
  return (cleanRoomService ??= new CleanRoomWorkspaceService({
    createWorkspaceFactory,
    workspaceRegistry,
    runtimeManager,
    cleanupJournal: getCleanupJournal(),
    resolveSourceCapability: async (project, target) => {
      const [row] = await db
        .select({
          path: workspaces.path,
          kind: workspaces.kind,
          location: workspaces.location,
          sshConnectionId: workspaces.sshConnectionId,
        })
        .from(workspaces)
        .innerJoin(
          tasks,
          and(eq(tasks.workspaceId, workspaces.id), eq(tasks.projectId, project.projectId))
        )
        .where(eq(workspaces.id, target.workspaceId))
        .limit(1);
      const machineMatches =
        row?.location === 'remote'
          ? target.machine.kind === 'ssh' && row.sshConnectionId === target.machine.connectionId
          : target.machine.kind === 'local' && row?.sshConnectionId === null;
      return row?.kind === 'worktree' && row.path === target.path && machineMatches
        ? {
            kind: 'immutable-same-machine-git-worktree' as const,
            projectId: project.projectId,
            machine: { ...target.machine },
          }
        : { kind: 'unsupported' as const, provider: row?.kind ?? 'unknown' };
    },
    createFeatureSnapshotService: (ctx) => new FeatureSnapshotService(ctx),
    createId: randomUUID,
  }));
}

function getEvidenceStore(): LoopEvidenceStore {
  return (evidenceStore ??= new LoopEvidenceStore({ appDataPath: app.getPath('userData') }));
}

function getBrowserService(): NativeBrowserVerificationService {
  return (browserService ??= new NativeBrowserVerificationService({
    previewServers: previewServerService,
    registry: browserWebContentsRegistry,
    transport: {
      emitRequest: (message) => events.emit(loopBrowserRequestChannel, message),
      emitAction: (message) => events.emit(loopBrowserActionChannel, message),
      emitResult: (message) => events.emit(loopBrowserResultChannel, message),
      emitClose: (message) => events.emit(loopBrowserCloseChannel, message),
      onReady: (listener) => events.on(loopBrowserReadyChannel, listener),
      onClosed: (listener) => events.on(loopBrowserClosedChannel, listener),
    },
    configurePartition: configureBrowserVerificationSession,
  }));
}

export async function runCleanRoomE2EPhase(input: {
  loop: LoopWithPhases;
  phase: LoopPhase;
  executionTarget: LoopExecutionTarget;
  driver: LoopSessionDriver;
  signal: AbortSignal;
  setActiveConversation(
    conversationId: string | null,
    driver: LoopSessionDriver | null
  ): void | Promise<void>;
}): Promise<Result<{ stageResult: LoopStageResult }, CleanRoomE2ERuntimeError>> {
  const config = input.loop.config;
  const state = loopStateV2Schema.safeParse(input.loop.state);
  const phaseState = loopPhaseStateV2Schema.safeParse(input.phase.state);
  const project = projectManager.getProject(input.loop.projectId);
  const [task] = await db
    .select({ id: tasks.id, name: tasks.name })
    .from(tasks)
    .where(and(eq(tasks.id, input.loop.taskId), eq(tasks.projectId, input.loop.projectId)))
    .limit(1);
  if (
    config?.version !== '2' ||
    !config.model ||
    !state.success ||
    !phaseState.success ||
    !state.data.baseCommit ||
    !state.data.checkpointCommit ||
    !project ||
    !task
  ) {
    return err({ message: 'Clean-room E2E authority is unavailable.' });
  }

  const cleanRoom = getCleanRoomService();
  const recovered = await recoverInterruptedVerification(
    input.loop,
    input.phase,
    project,
    cleanRoom
  );
  if (!recovered.success) return recovered;
  const current = await getLoop(input.loop.id);
  const phase = current?.phases.find((candidate) => candidate.id === input.phase.id);
  if (!current || !phase) return err({ message: 'Clean-room E2E phase disappeared.' });
  const currentState = loopStateV2Schema.safeParse(current.state);
  if (
    !currentState.success ||
    !currentState.data.baseCommit ||
    !currentState.data.checkpointCommit
  ) {
    return err({ message: 'Clean-room E2E checkpoint authority is unavailable.' });
  }

  const taskEnvironment = {
    taskName: task.name,
    projectPath: project.repoPath,
    defaultBranch: await project.settings.getDefaultBranch(),
  };
  const bindTarget = async (target: LoopSessionTarget) =>
    await resolveExplicitLoopExecutionTarget(target, task.id, taskEnvironment, {
      createLocalExecutionContext: (root) => new LocalExecutionContext({ root }),
      createSshExecutionContext: async (connectionId, root) =>
        new SshExecutionContext(await sshConnectionManager.connect(connectionId), {
          connectionId,
          root,
        }),
    });
  const inspect = async (target: LoopSessionTarget, baseline?: string) => {
    const binding = await bindTarget(target);
    if (!binding.success) return err(dependencyError(binding.error.message));
    try {
      const [head, status, branch] = await Promise.all([
        runLoopCommand(binding.data, 'git', ['rev-parse', 'HEAD'], { signal: input.signal }),
        runLoopCommand(binding.data, 'git', ['status', '--porcelain=v2', '--untracked-files=all'], {
          signal: input.signal,
        }),
        runLoopCommand(binding.data, 'git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          signal: input.signal,
        }),
      ]);
      const headCommit = head.stdout.trim();
      const mutationBaseline = createHash('sha256')
        .update(headCommit)
        .update('\0')
        .update(status.stdout)
        .update('\0')
        .update(branch.stdout)
        .digest('hex');
      return ok({
        target: { ...target, machine: { ...target.machine } },
        headCommit,
        clean: status.stdout.trim() === '',
        branchAttached: branch.stdout.trim() !== 'HEAD',
        mutationBaseline,
        mutated: baseline !== undefined && mutationBaseline !== baseline,
      });
    } catch (error) {
      return err(dependencyError(error instanceof Error ? error.message : String(error)));
    } finally {
      binding.data.dispose();
    }
  };

  const requiredChecks = new CleanRoomE2ERequiredChecksAdapter({
    resolveContext: async (authority) => {
      const resolved = await getLoop(authority.loopId);
      const resolvedPhase = resolved?.phases.find(
        (candidate) => candidate.id === authority.phaseId
      );
      const progress = await e2eProgressStore.read({
        loopId: authority.loopId,
        phaseId: authority.phaseId,
      });
      if (
        !resolved ||
        !resolvedPhase ||
        resolved.projectId !== authority.projectId ||
        resolved.taskId !== authority.taskId ||
        !progress.success ||
        !sameE2EDurableProgress(progress.data, authority.progress)
      ) {
        return err(dependencyError('Required-check authority changed concurrently.'));
      }
      return ok({ loop: resolved, phase: resolvedPhase });
    },
    native: new NativeBrowserE2EAttestationService({
      resolveTrustedBinding: async () => {
        const progress = await e2eProgressStore.read({ loopId: current.id, phaseId: phase.id });
        const verification = progress.success ? progress.data.loopState.verification : null;
        if (!verification?.target) {
          return err({
            kind: 'authority-unavailable',
            message: 'Native browser clean-room authority is unavailable.',
          });
        }
        return ok({
          verificationRunId: verification.verificationRunId,
          target: { ...verification.target, machine: { ...verification.target.machine } },
          taskEnvironment: Object.freeze(
            getTaskEnvVars({
              taskId: task.id,
              taskName: task.name,
              taskPath: verification.target.path,
              projectPath: project.repoPath,
              defaultBranch: taskEnvironment.defaultBranch,
              portSeed: verification.target.path,
            })
          ),
        });
      },
      startExactSession: async (request) => {
        const started = await input.driver.startVerificationSession({
          loop: request.loop,
          phase: request.phase,
          purpose: 'browser-verification',
          target: request.target,
          taskEnvironment: request.taskEnvironment,
          conversationId: request.sessionIdentity.conversationId,
        });
        if (!started.success) {
          return err({
            kind: started.error.kind,
            message: started.error.message,
            quiescent: false,
            recoveryRequired: true,
          });
        }
        await input.setActiveConversation(started.data.conversationId, input.driver);
        return ok({
          ...started.data,
          attemptId: request.sessionIdentity.attemptId,
          purpose: 'browser-verification' as const,
          phaseId: request.phase.id,
          verificationRunId: request.verificationRunId,
          target: { ...request.target, machine: { ...request.target.machine } },
          taskEnvironment: Object.freeze({ ...request.taskEnvironment }),
          provider: request.provider,
          model: request.model,
          checkpointCommit: request.checkpointCommit,
          driver: input.driver,
        });
      },
      browser: getBrowserService(),
      evidenceStore: getEvidenceStore(),
      createVerifier: createNativeBrowserVerifier,
      now: () => new Date(),
      outerSessionDriver: input.driver,
      setActiveConversation: input.setActiveConversation,
    }),
    now: () => new Date(),
  });

  const gate = new CleanRoomE2EGate({
    cleanRoom: {
      create: async (request) => mapDependency(await cleanRoom.create(request)),
      integrateFix: async (request) => mapDependency(await cleanRoom.integrateFix(request)),
      destroy: async (workspace, owner) => mapDependency(await cleanRoom.destroy(workspace, owner)),
    },
    authority: {
      beginAttempt: async ({ target, expectedFeatureHead }) => {
        const observed = await inspect(target);
        if (!observed.success) return observed;
        if (observed.data.headCommit !== expectedFeatureHead) {
          return err(dependencyError('Clean-room head does not match the reviewed checkpoint.'));
        }
        return observed;
      },
      inspectAttempt: async ({ target, expectedFeatureHead, mutationBaseline }) => {
        const observed = await inspect(target, mutationBaseline);
        if (!observed.success) return observed;
        if (!observed.data.mutated && observed.data.headCommit !== expectedFeatureHead) {
          return err(dependencyError('Clean-room authority changed without an owned mutation.'));
        }
        return observed;
      },
      inspectFeature: async ({ target, expectedFeatureHead }) => {
        const observed = await inspect(target);
        if (!observed.success) return observed;
        if (observed.data.headCommit !== expectedFeatureHead) {
          return err(dependencyError('Feature head changed concurrently.'));
        }
        return ok({
          target: observed.data.target,
          headCommit: observed.data.headCommit,
          clean: observed.data.clean,
          branchAttached: observed.data.branchAttached,
        });
      },
    },
    execution: {
      acquire: async ({ cleanRoom: workspace }) => {
        const binding = await bindTarget(workspace.target);
        return binding.success
          ? ok({
              target: { ...workspace.target, machine: { ...workspace.target.machine } },
              executionTarget: binding.data,
              taskEnvironment: binding.data.taskEnv,
            })
          : err(dependencyError(binding.error.message));
      },
      release: async ({ target, executionTarget }) => {
        executionTarget.dispose();
        return ok({
          target: { ...target, machine: { ...target.machine } },
          released: true as const,
        });
      },
    },
    session: {
      startFreshE2ESession: async (request) => {
        const started = await input.driver.startVerificationSession({
          loop: current,
          phase,
          purpose: 'e2e',
          target: request.target,
          taskEnvironment: request.taskEnvironment,
          conversationId: request.conversationId,
        });
        if (!started.success) return err(dependencyError(started.error.message));
        await input.setActiveConversation(started.data.conversationId, input.driver);
        return ok({
          attemptId: request.attemptId,
          conversationId: started.data.conversationId,
          purpose: 'e2e' as const,
          phaseId: request.phaseId,
          verificationRunId: request.verificationRunId,
          attempt: request.attempt,
          target: { ...request.target, machine: { ...request.target.machine } },
          provider: request.provider,
          model: request.model,
          taskEnvironment: Object.freeze({ ...request.taskEnvironment }),
        });
      },
      sendE2EPrompt: async (request) => {
        const sent = await input.driver.sendPrompt(request.conversationId, request.prompt);
        return sent.success
          ? ok({
              attemptId: request.attemptId,
              conversationId: request.conversationId,
              purpose: 'e2e' as const,
              phaseId: request.phaseId,
              verificationRunId: request.verificationRunId,
              attempt: request.attempt,
              target: { ...request.target, machine: { ...request.target.machine } },
              finalText: sent.data.finalText,
            })
          : err(dependencyError(sent.error.message));
      },
      cancelE2ESession: async (request) => {
        const cancelled = await input.driver.cancelPrompt(request.conversationId);
        if (!cancelled.success) return err(dependencyError(cancelled.error.message));
        await input.setActiveConversation(null, null);
        return ok({
          ...request,
          target: { ...request.target, machine: { ...request.target.machine } },
          quiescent: true as const,
        });
      },
    },
    requiredChecks,
    progress: e2eProgressStore,
    prerequisites: {
      resolve: async ({ loopId, phaseId }) => {
        const resolved = await getLoop(loopId);
        const phases = priorPhasesForE2E(resolved, phaseId);
        return phases
          ? ok({ phases })
          : err(dependencyError('Loop E2E prerequisites are unavailable.'));
      },
    },
    createVerificationRunId: (attempt) => `${current.id}-e2e-${attempt}-${randomUUID()}`,
    createSessionIdentity: ({ purpose, verificationRunId, attempt }) => ({
      attemptId: `${verificationRunId}-${purpose}-${attempt}-${randomUUID()}`,
      conversationId: randomUUID(),
    }),
    now: () => new Date(),
  });

  const handoffs = current.phases
    .filter((candidate) => candidate.idx < phase.idx)
    .flatMap((candidate) => {
      const parsed = loopPhaseStateV2Schema.safeParse(candidate.state);
      return parsed.success && parsed.data.handoff
        ? [{ source: candidate.name, handoff: parsed.data.handoff }]
        : [];
    });
  const currentPhaseState = loopPhaseStateV2Schema.parse(phase.state);
  const result = await gate.run({
    goal: config.planSource.trim() || current.name,
    acceptanceCriteria: phase.criteria?.criteria.map((criterion) => criterion.description) ?? [],
    baseCommit: currentState.data.baseCommit,
    checkpointCommit: currentState.data.checkpointCommit,
    handoffs,
    loop: current,
    phase,
    task,
    project,
    featureTarget: {
      workspaceId: input.executionTarget.workspaceId,
      path: input.executionTarget.path,
      machine: { ...input.executionTarget.machine },
    },
    provider: config.provider,
    model: config.model,
    terminalGates: { ...config.terminalGates },
    intermediateFailures: currentPhaseState.retryHandoffs,
    signal: input.signal,
  });
  await input.setActiveConversation(null, null);
  return result.success
    ? ok({ stageResult: result.data.stageResult })
    : err({ message: result.error.message });
}

async function recoverInterruptedVerification(
  loop: LoopWithPhases,
  phase: LoopPhase,
  project: NonNullable<ReturnType<typeof projectManager.getProject>>,
  service: CleanRoomWorkspaceService
): Promise<Result<void, CleanRoomE2ERuntimeError>> {
  const state = loopStateV2Schema.safeParse(loop.state);
  if (!state.success) return err({ message: 'Interrupted E2E progress is invalid.' });
  if (state.data.verification !== null) {
    const recovered = await service.recoverPendingCleanups(project);
    if (!recovered.success) return err({ message: dependencyMessage(recovered.error) });
  }
  let progress = await e2eProgressStore.read({ loopId: loop.id, phaseId: phase.id });
  if (!progress.success) return err({ message: progress.error.message });
  for (const attempt of progress.data.loopState.sessionAttempts) {
    if (attempt.status !== 'starting' && attempt.status !== 'running') continue;
    const finishedAt = new Date(
      Math.max(Date.now(), Date.parse(attempt.startedAt) + 1)
    ).toISOString();
    const interrupted = await e2eProgressStore.commit({
      loopId: loop.id,
      phaseId: phase.id,
      expected: progress.data,
      transition: {
        kind: 'session-attempt',
        previous: attempt,
        next: {
          ...attempt,
          status: 'interrupted',
          finishedAt,
          error: 'Interrupted by application restart; the clean room was recovered.',
        },
      },
    });
    if (!interrupted.success) return err({ message: interrupted.error.message });
    progress = interrupted;
  }
  const verification = progress.data.loopState.verification;
  if (verification === null) return ok();
  if (verification.status !== 'preparing' && verification.status !== 'destroying') {
    const destroying = await e2eProgressStore.commit({
      loopId: loop.id,
      phaseId: phase.id,
      expected: progress.data,
      transition: {
        kind: 'workspace',
        verification: {
          ...verification,
          status: 'destroying',
          cleanup: { status: 'running', updatedAt: new Date().toISOString() },
        },
      },
    });
    if (!destroying.success) return err({ message: destroying.error.message });
    progress = destroying;
  }
  const latest = progress.data.loopState.verification;
  if (latest?.status !== 'destroying' && latest?.status !== 'preparing') {
    return err({ message: 'Interrupted clean-room authority is not safely clearable.' });
  }
  const cleared = await e2eProgressStore.commit({
    loopId: loop.id,
    phaseId: phase.id,
    expected: progress.data,
    transition: { kind: 'workspace', verification: null },
  });
  return cleared.success ? ok() : err({ message: cleared.error.message });
}

function mapDependency<T, E>(result: Result<T, E>): Result<T, E2EGateDependencyError> {
  if (result.success) return result;
  const mapped = dependencyError(dependencyMessage(result.error));
  if (typeof result.error === 'object' && result.error !== null) {
    if ('type' in result.error && typeof result.error.type === 'string') {
      mapped.type = result.error.type;
    }
    if ('pendingCleanup' in result.error && result.error.pendingCleanup !== undefined) {
      mapped.pendingCleanup = result.error.pendingCleanup;
      mapped.recoveryRequired = true;
    }
  }
  return err(mapped);
}

function dependencyMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    if ('message' in error && typeof error.message === 'string') return error.message;
    if ('cause' in error) return dependencyMessage(error.cause);
    if ('type' in error && typeof error.type === 'string') return error.type;
  }
  return 'Clean-room dependency failed.';
}

function dependencyError(message: string): E2EGateDependencyError {
  return { type: 'dependency-rejected', message };
}
