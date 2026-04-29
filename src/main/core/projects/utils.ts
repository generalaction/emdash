import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { taskManager } from '../tasks/task-manager';

export function resolveTask(_projectId: string, taskId: string) {
  return taskManager.getTask(taskId) ?? null;
}

export function resolveWorkspace(_projectId: string, workspaceId: string) {
  return workspaceRegistry.get(workspaceId) ?? null;
}

export class TimeoutSignal extends Error {
  constructor(readonly ms: number) {
    super(`Operation timed out after ${ms}ms`);
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutSignal(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export type TimeoutError<T extends string> = {
  type: 'timeout';
  scope: T;
  timeout: number;
  message?: string;
};

export function timeoutError<T extends string>(
  scope: T,
  timeout: number,
  message?: string
): TimeoutError<T> {
  return {
    type: 'timeout',
    scope,
    timeout,
    message,
  };
}

export type AbortError<T extends string> = {
  type: 'abort';
  scope: T;
  message?: string;
};

export function abortError<T extends string>(scope: T, message?: string): AbortError<T> {
  return {
    type: 'abort',
    scope,
    message,
  };
}
