import { ptySessionRegistry } from '@main/core/pty/pty-session-registry';
import type { Workspace } from '@main/core/workspaces/workspace';
import { events } from '@main/lib/events';
import { redactDiagnosticLog } from '@main/lib/file-logger';
import { log } from '@main/lib/logger';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import {
  lifecycleScriptStatusChannel,
  type LifecycleScriptOrigin,
  type LifecycleScriptType,
} from '@shared/core/tasks/taskEvents';
import { createLifecycleScriptTerminalId } from '@shared/core/terminals/terminals';
import type { LifecycleScriptExecutionResult } from '../workspaces/workspace-lifecycle-service';

export type LifecycleScriptPolicy = {
  exit?: boolean;
  waitForExit?: boolean;
  respawnAfterExit?: boolean;
  timeoutMs?: number;
  logFailure: boolean;
  surfaceFailure: boolean;
  continueOnFailure: boolean;
};

export type LifecycleScriptCoordinatorResult =
  | { kind: 'succeeded'; result: LifecycleScriptExecutionResult }
  | { kind: 'failed'; message: string; result?: LifecycleScriptExecutionResult }
  | { kind: 'stopped' }
  | { kind: 'already-running' };

const activeSessions = new Set<string>();
const stoppedSessions = new Set<string>();

class LifecycleScriptTimeout extends Error {
  constructor(readonly ms: number) {
    super(`Lifecycle script timed out after ${ms}ms`);
  }
}

function withLifecycleTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LifecycleScriptTimeout(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function lifecycleScriptSessionId({
  projectId,
  workspaceId,
  type,
}: {
  projectId: string;
  workspaceId: string;
  type: LifecycleScriptType;
}): string {
  return makePtySessionId(projectId, workspaceId, createLifecycleScriptTerminalId(type));
}

export function stopLifecycleScriptSession({
  projectId,
  taskId,
  workspaceId,
  type,
  origin,
}: {
  projectId: string;
  taskId: string;
  workspaceId: string;
  type: LifecycleScriptType;
  origin: LifecycleScriptOrigin;
}): boolean {
  const sessionId = lifecycleScriptSessionId({ projectId, workspaceId, type });
  const pty = ptySessionRegistry.get(sessionId);
  if (!pty) return false;
  if (!activeSessions.has(sessionId)) return false;
  if (stoppedSessions.has(sessionId)) return false;

  stoppedSessions.add(sessionId);
  pty.kill();
  events.emit(lifecycleScriptStatusChannel, {
    projectId,
    taskId,
    workspaceId,
    type,
    origin,
    status: 'stopped',
  });
  return true;
}

function labelFor(type: LifecycleScriptType): string {
  return type[0].toUpperCase() + type.slice(1);
}

function isSuccessfulResult(result: LifecycleScriptExecutionResult): boolean {
  if (result.kind === 'started' || result.kind === 'already-running') return true;
  return result.signal === undefined && (result.exitCode === 0 || result.exitCode === undefined);
}

function failureMessage(type: LifecycleScriptType, result: LifecycleScriptExecutionResult): string {
  const label = labelFor(type);
  if (result.kind === 'started') return `${label} script did not report an exit status.`;
  if (result.kind === 'already-running') return `${label} script is already running.`;
  if (result.signal !== undefined) return `${label} script exited with signal ${result.signal}.`;
  return `${label} script exited with code ${result.exitCode ?? 'unknown'}.`;
}

export async function runLifecycleScriptWithPolicy({
  workspace,
  projectId,
  taskId,
  workspaceId,
  type,
  script,
  shellSetup,
  origin,
  policy,
  logPrefix,
}: {
  workspace: Workspace;
  projectId: string;
  taskId: string;
  workspaceId: string;
  type: LifecycleScriptType;
  script: string;
  shellSetup?: string;
  origin: LifecycleScriptOrigin;
  policy: LifecycleScriptPolicy;
  logPrefix: string;
}): Promise<LifecycleScriptCoordinatorResult> {
  const sessionId = lifecycleScriptSessionId({ projectId, workspaceId, type });
  if (activeSessions.has(sessionId)) {
    return { kind: 'already-running' };
  }

  activeSessions.add(sessionId);
  events.emit(lifecycleScriptStatusChannel, {
    projectId,
    taskId,
    workspaceId,
    type,
    origin,
    status: 'running',
  });

  let result: LifecycleScriptExecutionResult | undefined;
  try {
    const execution = workspace.lifecycleService.runLifecycleScript(
      { type, script, shellSetup },
      {
        exit: policy.exit ?? true,
        waitForExit: policy.waitForExit ?? true,
        respawnAfterExit: policy.respawnAfterExit ?? false,
      }
    );
    result =
      policy.timeoutMs === undefined
        ? await execution
        : await withLifecycleTimeout(execution, policy.timeoutMs);

    if (result.kind === 'already-running') {
      return { kind: 'already-running' };
    }

    if (stoppedSessions.delete(sessionId)) {
      return { kind: 'stopped' };
    }

    if (isSuccessfulResult(result)) {
      events.emit(lifecycleScriptStatusChannel, {
        projectId,
        taskId,
        workspaceId,
        type,
        origin,
        status: 'succeeded',
        ...(result.kind === 'exited' ? { exitCode: result.exitCode } : {}),
      });
      return { kind: 'succeeded', result };
    }

    return handleFailure({
      projectId,
      taskId,
      workspaceId,
      type,
      origin,
      policy,
      logPrefix,
      message: failureMessage(type, result),
      result,
    });
  } catch (error: unknown) {
    if (stoppedSessions.delete(sessionId)) {
      return { kind: 'stopped' };
    }

    const message =
      error instanceof LifecycleScriptTimeout
        ? `${labelFor(type)} script timed out after ${policy.timeoutMs}ms.`
        : error instanceof Error
          ? error.message
          : `${labelFor(type)} script failed to run.`;

    return handleFailure({
      projectId,
      taskId,
      workspaceId,
      type,
      origin,
      policy,
      logPrefix,
      message,
      result,
      error,
    });
  } finally {
    activeSessions.delete(sessionId);
    stoppedSessions.delete(sessionId);
  }
}

function handleFailure({
  projectId,
  taskId,
  workspaceId,
  type,
  origin,
  policy,
  logPrefix,
  message,
  result,
  error,
}: {
  projectId: string;
  taskId: string;
  workspaceId: string;
  type: LifecycleScriptType;
  origin: LifecycleScriptOrigin;
  policy: LifecycleScriptPolicy;
  logPrefix: string;
  message: string;
  result?: LifecycleScriptExecutionResult;
  error?: unknown;
}): LifecycleScriptCoordinatorResult {
  const outputTail =
    result?.kind === 'exited' && result.outputTail
      ? redactDiagnosticLog(result.outputTail)
      : undefined;

  if (policy.logFailure) {
    log.error(`${logPrefix}: ${type} script failed`, {
      taskId,
      workspaceId,
      error: message,
      exitCode: result?.kind === 'exited' ? result.exitCode : undefined,
      signal: result?.kind === 'exited' ? result.signal : undefined,
      outputTail,
    });
  }

  events.emit(lifecycleScriptStatusChannel, {
    projectId,
    taskId,
    workspaceId,
    type,
    origin,
    status: 'failed',
    message,
    surfaceFailure: policy.surfaceFailure,
    ...(result?.kind === 'exited'
      ? {
          exitCode: result.exitCode,
          signal: result.signal,
        }
      : {}),
  });

  const failure = { kind: 'failed' as const, message, result };
  if (policy.continueOnFailure) return failure;
  throw error ?? new Error(message);
}
