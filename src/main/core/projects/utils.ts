import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { projectManager } from './project-manager';

export function resolveTask(projectId: string, taskId: string) {
  return projectManager.getProject(projectId)?.tasks.getTask(taskId) ?? null;
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
