import { eq, isNull } from 'drizzle-orm';
import { LocalProject, SshProject } from '@shared/projects/types';
import { db } from '@main/db/client';
import { conversations, tasks, terminals } from '@main/db/schema';
import { log } from '@main/lib/logger';
import { mapConversationRowToConversation } from '../conversations/utils';
import { getProjects } from '../projects/operations/getProjects';
import { mapTaskRowToTask } from '../tasks/core';
import { mapTerminalRowToTerminal } from '../terminals/core';
import { createLocalProvider } from './local-project-provider';
import type { ProjectProvider } from './project-provider';

class ProjectManager {
  private providers = new Map<string, ProjectProvider>();

  async initialize(): Promise<void> {
    const allProjects = await getProjects();

    await Promise.all(
      allProjects.map((project) =>
        this.bootstrapProject(project).catch((e) => {
          log.error('EnvironmentProviderManager: failed to bootstrap project', {
            projectId: project.id,
            error: String(e),
          });
        })
      )
    );
  }

  private async bootstrapProject(project: LocalProject | SshProject): Promise<void> {
    const provider = await createProvider(project);
    this.providers.set(project.id, provider);

    const projectTasks = (await db.select().from(tasks).where(isNull(tasks.archivedAt))).map(
      (row) => mapTaskRowToTask(row)
    );

    await Promise.all(
      projectTasks.map(async (task) => {
        const taskConversations = (
          await db.select().from(conversations).where(eq(conversations.taskId, task.id))
        ).map((row) => mapConversationRowToConversation(row));
        const taskTerminals = (
          await db.select().from(terminals).where(eq(terminals.taskId, task.id))
        ).map((row) => mapTerminalRowToTerminal(row));
        return provider.provisionTask(task, taskConversations, taskTerminals).catch((e) => {
          log.error('EnvironmentProviderManager: failed to provision task', {
            projectId: project.id,
            taskId: task.id,
            error: String(e),
          });
        });
      })
    );
  }

  async addProject(project: LocalProject | SshProject): Promise<ProjectProvider> {
    const existing = this.providers.get(project.id);
    if (existing) return existing;
    const provider = await createProvider(project);
    this.providers.set(project.id, provider);
    return provider;
  }

  async removeProject(projectId: string): Promise<void> {
    const provider = this.providers.get(projectId);
    if (!provider) return;

    await provider.cleanup().catch((e) => {
      log.error('EnvironmentProviderManager: error during project teardown', {
        projectId,
        error: String(e),
      });
    });

    this.providers.delete(projectId);
  }

  getProject(projectId: string): ProjectProvider | undefined {
    return this.providers.get(projectId);
  }

  async shutdown(): Promise<void> {
    const ids = Array.from(this.providers.keys());
    await Promise.allSettled(ids.map((id) => this.removeProject(id)));
  }
}

export async function createProvider(project: LocalProject | SshProject): Promise<ProjectProvider> {
  if (project.type === 'ssh') {
    throw new Error('SSH projects are not yet supported');
  }
  return await createLocalProvider(project);
}

export const projectManager = new ProjectManager();
