import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { taskSessionManager } from '../tasks/task-session-manager';

export function resolveTask(_projectId: string, taskId: string) {
  return taskSessionManager.getTask(taskId) ?? null;
}

export function resolveWorkspace(_projectId: string, workspaceId: string) {
  return workspaceRegistry.get(workspaceId) ?? null;
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
