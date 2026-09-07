import { comparer, computed, makeObservable, reaction, type IReactionDisposer } from 'mobx';
import type { ProjectManagerStore } from '@core/features/projects/api/browser/stores/project-manager';
import { asAvailableProject } from '@core/features/projects/api/browser/stores/project-selectors';
import { taskManagerStoreToken } from '@core/features/tasks/contributions/browser/project-store-tokens';
import { log } from '@core/primitives/logging/browser/logger';
import type { NavigationStore } from '@core/primitives/navigation/browser/navigation-store';
import {
  isProvisioned,
  isUnprovisioned,
  isUnregistered,
} from '@core/primitives/task-state/browser/task-state';

type TaskActivationIdentity = {
  projectId: string;
  taskId: string;
};

export type TaskActivationState =
  | { kind: 'inactive'; reason: 'not-a-task-view' }
  | ({ kind: 'inactive'; reason: 'archived' | 'tearing-down' } & TaskActivationIdentity)
  | ({ kind: 'waiting-for-project' } & TaskActivationIdentity)
  | ({ kind: 'waiting-for-task' } & TaskActivationIdentity)
  | ({ kind: 'waiting-for-host' } & TaskActivationIdentity)
  | ({ kind: 'ready-to-activate'; hostGeneration: number } & TaskActivationIdentity)
  | ({ kind: 'activating' } & TaskActivationIdentity)
  | ({ kind: 'active' } & TaskActivationIdentity)
  | ({ kind: 'failed'; message: string | undefined } & TaskActivationIdentity);

/**
 * Owns the invariant that the Task selected by navigation has an active workspace session.
 *
 * Activation is app lifecycle, not component lifecycle: restored navigation can become current
 * before its Project Host is live, and no React remount is required when that Host later recovers.
 */
export class TaskActivationCoordinator {
  private disposeReaction: IReactionDisposer | undefined;

  constructor(
    private readonly navigation: NavigationStore,
    private readonly projects: ProjectManagerStore
  ) {
    makeObservable(this, { state: computed });
  }

  get state(): TaskActivationState {
    const current = this.navigation.currentRef;
    if (current.viewId !== 'task') {
      return { kind: 'inactive', reason: 'not-a-task-view' };
    }

    const { projectId, taskId } = current.params as {
      projectId?: string;
      taskId?: string;
    };
    if (!projectId || !taskId) {
      return { kind: 'inactive', reason: 'not-a-task-view' };
    }

    const identity = { projectId, taskId };
    const project = asAvailableProject(this.projects.projects.get(projectId));
    if (!project) return { kind: 'waiting-for-project', ...identity };

    const task = project.get(taskManagerStoreToken).tasks.get(taskId);
    if (!task) return { kind: 'waiting-for-task', ...identity };
    if ('archivedAt' in task.data && task.data.archivedAt) {
      return { kind: 'inactive', reason: 'archived', ...identity };
    }
    if (isProvisioned(task)) return { kind: 'active', ...identity };
    if (isUnregistered(task)) {
      return task.phase === 'create-error'
        ? { kind: 'failed', message: task.errorMessage, ...identity }
        : { kind: 'waiting-for-task', ...identity };
    }
    if (!isUnprovisioned(task)) return { kind: 'waiting-for-task', ...identity };

    switch (task.phase) {
      case 'provision':
        return { kind: 'activating', ...identity };
      case 'provision-error':
      case 'teardown-error':
        return { kind: 'failed', message: task.errorMessage, ...identity };
      case 'teardown':
        return { kind: 'inactive', reason: 'tearing-down', ...identity };
      case 'idle': {
        const host = project.host.state;
        return host.kind === 'ready'
          ? { kind: 'ready-to-activate', hostGeneration: host.hostGeneration, ...identity }
          : { kind: 'waiting-for-host', ...identity };
      }
    }
  }

  start(): void {
    if (this.disposeReaction) return;
    this.disposeReaction = reaction(
      () => this.state,
      (state) => {
        if (state.kind !== 'ready-to-activate') return;
        const project = asAvailableProject(this.projects.projects.get(state.projectId));
        if (!project) return;

        void project
          .get(taskManagerStoreToken)
          .provisionTask(state.taskId)
          .catch((error) => {
            log.error('Failed to activate current task', {
              projectId: state.projectId,
              taskId: state.taskId,
              error,
            });
          });
      },
      { equals: comparer.structural, fireImmediately: true }
    );
  }

  dispose(): void {
    this.disposeReaction?.();
    this.disposeReaction = undefined;
  }
}
