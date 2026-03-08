import { eq, isNull } from 'drizzle-orm';
import { worktreePoolService } from '@main/core/worktrees/WorktreePoolService';
import { db } from '@main/db/client';
import {
  conversations,
  projects,
  sshConnections,
  tasks,
  terminals,
  type ConversationRow,
  type ProjectRow,
  type TaskRow,
  type TerminalRow,
} from '@main/db/schema';
import { log } from '@main/lib/logger';
import { sshConnectionManager, type SshConnectionEvent } from '../ssh/ssh-connection-manager';
import { buildConnectConfigFromRow } from './impl/build-connect-config';
import { LocalEnvironmentProvider } from './impl/local-env-provider';
import { SshEnvironmentProvider } from './impl/ssh-env-provider';
import type { EnvironmentProvider } from './workspace-provider';

/**
 * Manages one `EnvironmentProvider` instance per project.
 *
 * On startup, `initialize()` reads all projects/tasks/conversations/terminals
 * from the DB, creates the appropriate provider for each project, and calls
 * `provider.provision()` for every active task so that existing PTY sessions
 * are hydrated (tmux reattach, shell respawn, etc.).
 *
 * Controllers look up the correct provider via `getProvider(projectId)` and
 * delegate all session operations through it — they never branch on transport
 * type themselves.
 */
class WorkspaceManager {
  private providers = new Map<string, EnvironmentProvider>();

  /** Maps connectionId → set of projectIds using that connection. */
  private connectionProjects = new Map<string, Set<string>>();

  async initialize(): Promise<void> {
    const allProjects = await db.select().from(projects);
    const allTasks = await db.select().from(tasks).where(isNull(tasks.archivedAt));
    const allConversations = await db.select().from(conversations);
    const allTerminals = await db.select().from(terminals);

    await Promise.all(
      allProjects.map((project) =>
        this.bootstrapProject(project, allTasks, allConversations, allTerminals).catch((e) => {
          log.error('EnvironmentProviderManager: failed to bootstrap project', {
            projectId: project.id,
            error: String(e),
          });
        })
      )
    );

    // Subscribe to SSH reconnect events to rehydrate terminal sessions.
    sshConnectionManager.on('connection-event', (evt: SshConnectionEvent) => {
      if (evt.type === 'reconnected') {
        this.onSshReconnected(evt.connectionId);
      } else if (evt.type === 'reconnect-failed') {
        log.warn('EnvironmentProviderManager: SSH reconnect failed permanently', {
          connectionId: evt.connectionId,
        });
      }
    });
  }

  private async bootstrapProject(
    project: ProjectRow,
    allTasks: TaskRow[],
    allConversations: ConversationRow[],
    allTerminals: TerminalRow[]
  ): Promise<void> {
    const provider = await this.createProvider(project);
    this.providers.set(project.id, provider);

    const projectTasks = allTasks.filter((t) => t.projectId === project.id);

    await Promise.all(
      projectTasks.map((task) => {
        const taskConversations = allConversations.filter((c) => c.taskId === task.id);
        const taskTerminals = allTerminals.filter((t) => t.taskId === task.id);
        return provider
          .provision({
            task,
            projectPath: project.path,
            conversations: taskConversations,
            terminals: taskTerminals,
          })
          .catch((e) => {
            log.error('EnvironmentProviderManager: failed to provision task', {
              projectId: project.id,
              taskId: task.id,
              error: String(e),
            });
          });
      })
    );

    // Pre-warm a reserve worktree for local projects so task creation is instant.
    if (!project.isRemote) {
      worktreePoolService
        .ensureReserve(project.id, project.path, project.baseRef ?? undefined)
        .catch((e) => {
          log.warn('EnvironmentProviderManager: failed to warm worktree reserve', {
            projectId: project.id,
            error: String(e),
          });
        });
    }
  }

  async addProject(project: ProjectRow): Promise<EnvironmentProvider> {
    const existing = this.providers.get(project.id);
    if (existing) return existing;

    const provider = await this.createProvider(project);
    this.providers.set(project.id, provider);

    // Pre-warm a reserve worktree for local projects so task creation is instant.
    if (!project.isRemote) {
      worktreePoolService
        .ensureReserve(project.id, project.path, project.baseRef ?? undefined)
        .catch((e) => {
          log.warn('EnvironmentProviderManager: failed to warm worktree reserve on addProject', {
            projectId: project.id,
            error: String(e),
          });
        });
    }

    return provider;
  }

  async removeProject(projectId: string): Promise<void> {
    const provider = this.providers.get(projectId);
    if (!provider) return;

    // Clean up any pooled reserve worktrees for this project.
    await worktreePoolService.removeReserve(projectId).catch((e) => {
      log.warn('EnvironmentProviderManager: failed to remove worktree reserve', {
        projectId,
        error: String(e),
      });
    });

    await provider.teardownAll().catch((e) => {
      log.error('EnvironmentProviderManager: error during project teardown', {
        projectId,
        error: String(e),
      });
    });

    this.providers.delete(projectId);

    // Remove the project from the connection tracking map.
    for (const [connId, projectIds] of this.connectionProjects) {
      projectIds.delete(projectId);
      if (projectIds.size === 0) {
        this.connectionProjects.delete(connId);
      }
    }
  }

  getProvider(projectId: string): EnvironmentProvider | undefined {
    return this.providers.get(projectId);
  }

  async teardownTask(taskId: string): Promise<void> {
    await Promise.allSettled(Array.from(this.providers.values()).map((p) => p.teardown(taskId)));
  }

  async shutdown(): Promise<void> {
    const ids = Array.from(this.providers.keys());
    await Promise.allSettled(ids.map((id) => this.removeProject(id)));
    await worktreePoolService.cleanup().catch((e) => {
      log.warn('EnvironmentProviderManager: failed to cleanup worktree pool on shutdown', {
        error: String(e),
      });
    });
  }

  private async createProvider(project: ProjectRow): Promise<EnvironmentProvider> {
    const envType = project.environmentProvider ?? 'local';

    if (envType === 'ssh') {
      return this.createSshProvider(project);
    }

    // 'local' and anything else (including future 'vm') fall back to local for now.
    return new LocalEnvironmentProvider(project.id);
  }

  private async createSshProvider(project: ProjectRow): Promise<EnvironmentProvider> {
    if (!project.sshConnectionId) {
      log.warn(
        'EnvironmentProviderManager: SSH project has no sshConnectionId, falling back to local',
        { projectId: project.id }
      );
      return new LocalEnvironmentProvider(project.id);
    }

    const connectionId = project.sshConnectionId;

    // Ensure an active SSH connection exists in SshConnectionManager.
    if (!sshConnectionManager.isConnected(connectionId)) {
      const [row] = await db
        .select()
        .from(sshConnections)
        .where(eq(sshConnections.id, connectionId))
        .limit(1);

      if (!row) {
        log.warn('EnvironmentProviderManager: SSH connection row not found', {
          projectId: project.id,
          connectionId,
        });
        return new LocalEnvironmentProvider(project.id);
      }

      const config = await buildConnectConfigFromRow(row);
      const result = await sshConnectionManager.connect(connectionId, config);
      if (!result.success) {
        log.warn('EnvironmentProviderManager: SSH connection failed', {
          projectId: project.id,
          connectionId,
          error: result.error,
        });
      }
    }

    const proxy = sshConnectionManager.getProxy(connectionId);
    if (!proxy) {
      log.warn(
        'EnvironmentProviderManager: no proxy after connect attempt, falling back to local',
        { projectId: project.id, connectionId }
      );
      return new LocalEnvironmentProvider(project.id);
    }

    // Track which projects use this connection so we can rehydrate them on reconnect.
    const projectSet = this.connectionProjects.get(connectionId) ?? new Set<string>();
    projectSet.add(project.id);
    this.connectionProjects.set(connectionId, projectSet);

    return new SshEnvironmentProvider(project.id, proxy);
  }

  /** Called when SshConnectionManager fires a 'reconnected' event. */
  private onSshReconnected(connectionId: string): void {
    const projectIds = this.connectionProjects.get(connectionId);
    if (!projectIds || projectIds.size === 0) return;

    log.info('EnvironmentProviderManager: SSH reconnected — rehydrating terminals', {
      connectionId,
      projects: Array.from(projectIds),
    });

    for (const projectId of projectIds) {
      const provider = this.providers.get(projectId);
      if (provider instanceof SshEnvironmentProvider) {
        provider.rehydrateTerminals().catch((e: unknown) => {
          log.error('EnvironmentProviderManager: rehydrateTerminals failed', {
            projectId,
            connectionId,
            error: String(e),
          });
        });
      }
    }
  }
}

export const workspaceManager = new WorkspaceManager();
