import { db } from '../db/client';
import { projects, tasks, conversations, terminals, sshConnections } from '../db/schema';
import { eq, isNull } from 'drizzle-orm';
import type { ProjectRow, TaskRow, ConversationRow, TerminalRow } from '../db/schema';
import type { EnvironmentProvider } from './environment-provider';
import { LocalEnvironmentProvider } from './impl/local-env-provider';
import { SshEnvironmentProvider } from './impl/ssh-env-provider';
import { sshConnectionManager } from '../ssh/ssh-connection-manager';
import { buildConnectConfigFromRow } from './impl/build-connect-config';
import { log } from '../lib/logger';

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
class EnvironmentProviderManager {
  private providers = new Map<string, EnvironmentProvider>();

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
  }

  async addProject(project: ProjectRow): Promise<EnvironmentProvider> {
    const existing = this.providers.get(project.id);
    if (existing) return existing;

    const provider = await this.createProvider(project);
    this.providers.set(project.id, provider);
    return provider;
  }

  async removeProject(projectId: string): Promise<void> {
    const provider = this.providers.get(projectId);
    if (!provider) return;

    await provider.teardownAll().catch((e) => {
      log.error('EnvironmentProviderManager: error during project teardown', {
        projectId,
        error: String(e),
      });
    });

    this.providers.delete(projectId);
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
        log.warn('EnvironmentProviderManager: SSH connection row not found ', {
          projectId: project.id,
          connectionId,
        });
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

    const client = sshConnectionManager.getClient(connectionId)!;
    return new SshEnvironmentProvider(project.id, client);
  }
}

export const environmentProviderManager = new EnvironmentProviderManager();
