import type { Project, GitPlatform } from './DatabaseService';
import { databaseService } from './DatabaseService';

export interface ProjectSettings {
  projectId: string;
  name: string;
  path: string;
  gitRemote?: string;
  gitBranch?: string;
  baseRef?: string;
  gitPlatform: GitPlatform;
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
    settings: { baseRef?: string; gitPlatform?: GitPlatform }
  ): Promise<ProjectSettings> {
    if (!projectId) {
      throw new Error('projectId is required');
    }
    if (!settings?.baseRef && !settings?.gitPlatform) {
      throw new Error('At least one of baseRef or gitPlatform is required');
    }

    let project: Project | null = null;

    if (settings.baseRef) {
      project = await databaseService.updateProjectBaseRef(projectId, settings.baseRef);
    }

    if (settings.gitPlatform) {
      project = await databaseService.updateProjectGitPlatform(projectId, settings.gitPlatform);
    }

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
      gitPlatform: project.gitPlatform,
    };
  }
}

export const projectSettingsService = new ProjectSettingsService();
