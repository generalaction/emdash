import { isNull } from 'drizzle-orm';
import { LocalProject, SshProject } from '@shared/projects/types';
import { db } from '@main/db/client';
import {
  conversations,
  tasks,
  terminals,
  type ConversationRow,
  type TaskRow,
  type TerminalRow,
} from '@main/db/schema';
import { log } from '@main/lib/logger';
import { getProjects } from '../projects/operations/getProjects';
import { createProvider } from './create-project-provider';
import type { ProjectProvider } from './project-provider';

class ProjectManager {
  private providers = new Map<string, ProjectProvider>();

  async initialize(): Promise<void> {
    const allProjects = await getProjects();
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
    project: LocalProject | SshProject,
    allTasks: TaskRow[],
    allConversations: ConversationRow[],
    allTerminals: TerminalRow[]
  ): Promise<void> {
    const provider = await createProvider(project);
    this.providers.set(project.id, provider);

    const projectTasks = allTasks.filter((t) => t.projectId === project.id);

    await Promise.all(
      projectTasks.map((task) => {
        const taskConversations = allConversations.filter((c) => c.taskId === task.id);
        const taskTerminals = allTerminals.filter((t) => t.taskId === task.id);
        return provider
          .provisionTask({
            taskId: task.id,
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

export const projectManager = new ProjectManager();
