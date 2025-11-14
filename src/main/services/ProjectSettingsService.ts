import type { Project } from './DatabaseService';
import { databaseService } from './DatabaseService';

export interface ProjectSettings {
  projectId: string;
  name: string;
  path: string;
  gitRemote?: string;
  gitBranch?: string;
  baseRef?: string;
}

class ProjectSettingsService {
  async getProjectSettings(projectId: string): Promise<ProjectSettings | null> {
    if (!projectId) {
      throw new Error('projectId is required');
    }
    const project = await databaseService.getProjectById(projectId);
    if (!project) {
      return null;
    }
    return this.toSettings(project);
  }

  async updateProjectSettings(
    projectId: string,
    settings: { baseRef?: string }
  ): Promise<ProjectSettings> {
    if (!projectId) {
      throw new Error('projectId is required');
    }
    const nextBaseRef = settings?.baseRef;
    if (typeof nextBaseRef !== 'string') {
      throw new Error('baseRef is required');
    }

    const project = await databaseService.updateProjectBaseRef(projectId, nextBaseRef);
    if (!project) {
      throw new Error('Project not found');
    }
    return this.toSettings(project);
  }

  private toSettings(project: Project): ProjectSettings {
    return {
      projectId: project.id,
      name: project.name,
      path: project.path,
      gitRemote: project.gitInfo.remote,
      gitBranch: project.gitInfo.branch,
      baseRef: project.gitInfo.baseRef,
    };
  }
}

export const projectSettingsService = new ProjectSettingsService();
