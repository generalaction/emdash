import os from 'os';
import path from 'path';
import {
  INSIDE_PROJECT_WORKTREE_BASE_PATH,
  TEMP_WORKTREE_BASE_PATH_ALIAS,
} from '@shared/worktreePaths';
import type { Project } from './DatabaseService';
import { databaseService } from './DatabaseService';

export { INSIDE_PROJECT_WORKTREE_BASE_PATH, TEMP_WORKTREE_BASE_PATH_ALIAS };
export const TEMP_WORKTREE_BASE_PATH =
  process.platform === 'win32' ? path.join(os.tmpdir(), 'emdash') : '/tmp/emdash';

const LEGACY_TEMP_WORKTREE_VALUE = '/tmp/emdash';

function isTemporaryWorktreeAlias(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (trimmed === TEMP_WORKTREE_BASE_PATH_ALIAS) return true;
  // Backward compatibility with earlier renderer hardcoded value
  if (trimmed === LEGACY_TEMP_WORKTREE_VALUE) return true;
  return (
    path.isAbsolute(trimmed) && path.resolve(trimmed) === path.resolve(TEMP_WORKTREE_BASE_PATH)
  );
}

export function getDefaultWorktreeBasePath(projectPath: string): string {
  return path.resolve(projectPath, '..', 'worktrees');
}

export function resolveWorktreeBasePath(
  projectPath: string,
  configuredBasePath?: string | null
): string {
  const trimmed = typeof configuredBasePath === 'string' ? configuredBasePath.trim() : '';
  if (!trimmed) {
    return getDefaultWorktreeBasePath(projectPath);
  }
  if (trimmed === INSIDE_PROJECT_WORKTREE_BASE_PATH) {
    return path.resolve(projectPath, INSIDE_PROJECT_WORKTREE_BASE_PATH);
  }
  if (isTemporaryWorktreeAlias(trimmed)) {
    return path.resolve(TEMP_WORKTREE_BASE_PATH);
  }
  return path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(projectPath, trimmed);
}

function normalizeWorktreeBasePathInput(
  projectPath: string,
  value: string | null | undefined
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === INSIDE_PROJECT_WORKTREE_BASE_PATH) {
    return INSIDE_PROJECT_WORKTREE_BASE_PATH;
  }
  if (isTemporaryWorktreeAlias(trimmed)) {
    return TEMP_WORKTREE_BASE_PATH_ALIAS;
  }

  const resolved = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(projectPath, trimmed);
  if (resolved === path.resolve(TEMP_WORKTREE_BASE_PATH)) {
    return TEMP_WORKTREE_BASE_PATH_ALIAS;
  }
  const insideProject = path.resolve(projectPath, INSIDE_PROJECT_WORKTREE_BASE_PATH);
  if (resolved === insideProject) {
    return INSIDE_PROJECT_WORKTREE_BASE_PATH;
  }

  return resolved;
}

function validateWorktreeBasePath(projectPath: string, configuredBasePath: string | null): void {
  if (!configuredBasePath) return;
  const resolvedBasePath = resolveWorktreeBasePath(projectPath, configuredBasePath);
  const resolvedProjectPath = path.resolve(projectPath);
  const gitDir = path.resolve(projectPath, '.git');

  if (resolvedBasePath === resolvedProjectPath) {
    throw new Error('Worktree base path cannot be the project root. Use a subdirectory instead.');
  }
  if (resolvedBasePath === gitDir || resolvedBasePath.startsWith(`${gitDir}${path.sep}`)) {
    throw new Error('Worktree base path cannot be inside .git.');
  }
}

export interface ProjectSettings {
  projectId: string;
  name: string;
  path: string;
  gitRemote?: string;
  gitBranch?: string;
  baseRef?: string;
  worktreeBasePath?: string | null;
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

  async resolveProjectWorktreeBasePath(projectId: string, projectPath: string): Promise<string> {
    const settings = await this.getProjectSettings(projectId);
    return resolveWorktreeBasePath(projectPath, settings?.worktreeBasePath ?? null);
  }

  async updateProjectSettings(
    projectId: string,
    settings: { baseRef?: string; worktreeBasePath?: string | null }
  ): Promise<ProjectSettings> {
    if (!projectId) {
      throw new Error('projectId is required');
    }

    const project = await databaseService.getProjectById(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const updates: { baseRef?: string; worktreeBasePath?: string | null } = {};

    if (settings.baseRef !== undefined) {
      if (typeof settings.baseRef !== 'string') {
        throw new Error('baseRef must be a string');
      }
      const nextBaseRef = settings.baseRef.trim();
      if (!nextBaseRef) {
        throw new Error('baseRef cannot be empty');
      }
      updates.baseRef = nextBaseRef;
    }

    if (settings.worktreeBasePath !== undefined) {
      if (project.isRemote) {
        throw new Error('Custom worktree base path is not supported for remote projects.');
      }
      if (settings.worktreeBasePath !== null && typeof settings.worktreeBasePath !== 'string') {
        throw new Error('worktreeBasePath must be a string or null');
      }
      const normalizedWorktreeBasePath = normalizeWorktreeBasePathInput(
        project.path,
        settings.worktreeBasePath
      );
      validateWorktreeBasePath(project.path, normalizedWorktreeBasePath);
      updates.worktreeBasePath = normalizedWorktreeBasePath;
    }

    if (Object.keys(updates).length === 0) {
      throw new Error('No project settings updates provided');
    }

    const updatedProject = await databaseService.updateProjectSettings(projectId, updates);
    if (!updatedProject) {
      throw new Error('Project not found');
    }
    return this.toSettings(updatedProject);
  }

  private toSettings(project: Project): ProjectSettings {
    return {
      projectId: project.id,
      name: project.name,
      path: project.path,
      gitRemote: project.gitInfo.remote,
      gitBranch: project.gitInfo.branch,
      baseRef: project.gitInfo.baseRef,
      worktreeBasePath: project.worktreeBasePath ?? null,
    };
  }
}

export const projectSettingsService = new ProjectSettingsService();
