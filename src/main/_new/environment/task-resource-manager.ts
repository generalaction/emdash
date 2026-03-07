import type { TaskEnvironment } from './types';
import type { ProjectRow } from '../db/schema';
import { environmentProviderRegistry } from './registry';
import { ptySessionManager } from '../pty/session/core';
import { log } from '../lib/logger';

/**
 * `TaskResourceManager` is the single call-site for provisioning and tearing
 * down all resources associated with a task (environment, PTY sessions, etc.).
 *
 * Controllers call `getOrProvision(project, task)` to obtain a `TaskEnvironment`
 * and never branch on `project.isRemote` themselves.
 */
class TaskResourceManager {
  private environments = new Map<string, TaskEnvironment>();

  /**
   * Return the cached environment for `task.id`, or provision a new one using
   * the provider indicated by `project.environmentProvider`.
   */
  async getOrProvision(
    project: ProjectRow,
    task: { id: string; path: string }
  ): Promise<TaskEnvironment> {
    const cached = this.environments.get(task.id);
    if (cached) return cached;

    const provider = environmentProviderRegistry.resolve(
      (project as ProjectRow & { environmentProvider?: string | null }).environmentProvider
    );

    log.info('TaskResourceManager: provisioning environment', {
      taskId: task.id,
      providerType: provider.type,
    });

    const env = await provider.provision(project, task);
    this.environments.set(task.id, env);
    return env;
  }

  /**
   * Return an already-provisioned environment without triggering provisioning.
   * Returns `undefined` if the task has not been provisioned yet.
   */
  getEnvironment(taskId: string): TaskEnvironment | undefined {
    return this.environments.get(taskId);
  }

  /**
   * Tear down all resources for a task:
   *  1. Destroy PTY sessions tracked by `ptySessionManager`.
   *  2. Call the provider's `teardown()` hook.
   *  3. Remove the cached environment.
   */
  async teardown(taskId: string): Promise<void> {
    log.info('TaskResourceManager: tearing down task resources', { taskId });

    try {
      ptySessionManager.destroySessionsForTask(taskId);
    } catch (e) {
      log.error('TaskResourceManager: destroySessionsForTask failed', { taskId, error: e });
    }

    const env = this.environments.get(taskId);
    if (env) {
      const provider = environmentProviderRegistry.resolve(
        env.transport === 'ssh2' ? 'ssh' : env.transport
      );
      try {
        await provider.teardown(taskId);
      } catch (e) {
        log.error('TaskResourceManager: provider teardown failed', {
          taskId,
          providerType: provider.type,
          error: e,
        });
      }
      this.environments.delete(taskId);
    }
  }

  /** Tear down all active task environments. Called on app shutdown. */
  async teardownAll(): Promise<void> {
    const ids = Array.from(this.environments.keys());
    await Promise.all(ids.map((id) => this.teardown(id)));
  }
}

export const taskResourceManager = new TaskResourceManager();
