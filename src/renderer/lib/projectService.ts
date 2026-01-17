/**
 * Service for handling project-related operations
 * Extracts complex project creation logic from App.tsx
 */

import type { Project } from '../types/app';
import {
  computeBaseRef,
  getProjectRepoKey,
  normalizePathForComparison,
  withRepoKey,
} from './projectUtils';

export interface ProjectCreationResult {
  success: boolean;
  project?: Project;
  error?: string;
}

/**
 * Creates a project from a directory path
 * Handles Git detection, GitHub connection, and database saving
 */
export async function createProjectFromPath(
  projectPath: string,
  platform: string,
  isAuthenticated: boolean,
  existingProjects: Project[]
): Promise<ProjectCreationResult> {
  try {
    const gitInfo = await window.electronAPI.getGitInfo(projectPath);
    const canonicalPath = gitInfo.rootPath || gitInfo.path || projectPath;
    const repoKey = normalizePathForComparison(canonicalPath, platform);

    // Check if project already exists
    const existingProject = existingProjects.find(
      (project) => getProjectRepoKey(project, platform) === repoKey
    );

    if (existingProject) {
      return {
        success: false,
        error: `Project "${existingProject.name}" is already open`,
      };
    }

    if (!gitInfo.isGitRepo) {
      return {
        success: false,
        error: `Directory is not a Git repository: ${projectPath}`,
      };
    }

    const remoteUrl = gitInfo.remote || '';
    const isGithubRemote = /github\.com[:/]/i.test(remoteUrl);
    const projectName = canonicalPath.split(/[/\\]/).filter(Boolean).pop() || 'Unknown Project';

    const baseProject: Project = {
      id: Date.now().toString(),
      name: projectName,
      path: canonicalPath,
      repoKey,
      gitInfo: {
        isGitRepo: true,
        remote: gitInfo.remote || undefined,
        branch: gitInfo.branch || undefined,
        baseRef: computeBaseRef(gitInfo.baseRef, gitInfo.remote, gitInfo.branch),
      },
      tasks: [],
    };

    // Try GitHub connection if authenticated
    if (isAuthenticated && isGithubRemote) {
      const githubInfo = await window.electronAPI.connectToGitHub(canonicalPath);
      if (githubInfo.success) {
        const projectWithGithub = withRepoKey(
          {
            ...baseProject,
            githubInfo: {
              repository: githubInfo.repository || '',
              connected: true,
            },
          },
          platform
        );

        const saveResult = await window.electronAPI.saveProject(projectWithGithub);
        if (saveResult.success) {
          const { captureTelemetry } = await import('./telemetryClient');
          captureTelemetry('project_added_success', { source: 'github' });
          return { success: true, project: projectWithGithub };
        } else {
          const { log } = await import('./logger');
          log.error('Failed to save project:', saveResult.error);
          return {
            success: false,
            error: 'Project opened but could not be saved to database',
          };
        }
      } else {
        // GitHub connection failed, save without GitHub info
        const projectWithoutGithub = withRepoKey(
          {
            ...baseProject,
            githubInfo: {
              repository: '',
              connected: false,
            },
          },
          platform
        );

        const saveResult = await window.electronAPI.saveProject(projectWithoutGithub);
        if (saveResult.success) {
          const { captureTelemetry } = await import('./telemetryClient');
          captureTelemetry('project_added_success', { source: 'local' });
          return { success: true, project: projectWithoutGithub };
        }
      }
    } else {
      // Not authenticated or not GitHub remote
      const projectWithoutGithub = withRepoKey(
        {
          ...baseProject,
          githubInfo: {
            repository: '',
            connected: false,
          },
        },
        platform
      );

      const saveResult = await window.electronAPI.saveProject(projectWithoutGithub);
      if (saveResult.success) {
        const { captureTelemetry } = await import('./telemetryClient');
        captureTelemetry('project_added_success', { source: 'local' });
        return { success: true, project: projectWithoutGithub };
      } else {
        const { log } = await import('./logger');
        log.error('Failed to save project:', saveResult.error);
        return {
          success: false,
          error: 'Project opened but could not be saved to database',
        };
      }
    }
  } catch (error) {
    const { log } = await import('./logger');
    log.error('Failed to create project from path:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create project',
    };
  }

  return { success: false, error: 'Unexpected error' };
}

/**
 * Handles project creation after cloning from Git
 */
export async function handleCloneSuccess(
  projectPath: string,
  platform: string,
  isAuthenticated: boolean,
  existingProjects: Project[]
): Promise<ProjectCreationResult> {
  const { captureTelemetry } = await import('./telemetryClient');
  captureTelemetry('project_cloned');

  const result = await createProjectFromPath(
    projectPath,
    platform,
    isAuthenticated,
    existingProjects
  );

  if (result.success) {
    captureTelemetry('project_clone_success');
    captureTelemetry('project_added_success', { source: 'clone' });
  }

  return result;
}

/**
 * Handles project creation after creating a new repository
 */
export async function handleNewProjectSuccess(
  projectPath: string,
  platform: string,
  isAuthenticated: boolean,
  existingProjects: Project[],
  saveProjectOrder: (projects: Project[]) => void
): Promise<ProjectCreationResult> {
  const { captureTelemetry } = await import('./telemetryClient');
  captureTelemetry('new_project_created');

  const result = await createProjectFromPath(
    projectPath,
    platform,
    isAuthenticated,
    existingProjects
  );

  if (result.success && result.project) {
    captureTelemetry('project_create_success');
    captureTelemetry('project_added_success', { source: 'new_project' });

    // Save project order with new project at the beginning
    const updatedProjects = [result.project, ...existingProjects];
    saveProjectOrder(updatedProjects);
  }

  return result;
}