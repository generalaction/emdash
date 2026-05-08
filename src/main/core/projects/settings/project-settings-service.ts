import type {
  ProjectSettings,
  ProjectSettingsPage,
  WriteProjectConfigRequest,
} from '@shared/project-settings';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import { projectManager } from '../project-manager';
import type { ProjectProvider } from '../project-provider';
import { computeProjectSettingsOverrideState } from './project-settings-override-state';
import {
  getProjectSettingsWriteTargets,
  resolveAllProjectSettingsTargets,
} from './project-settings-target-resolver';
import { shareProjectSettingsToConfig as writeSharedProjectSettingsToConfig } from './share-project-settings-to-config';

function requireProject(projectId: string): Result<ProjectProvider, UpdateProjectSettingsError> {
  const project = projectManager.getProject(projectId);
  return project ? ok(project) : err({ type: 'project-not-found' });
}

async function getProjectSettingsPageForProject(
  project: ProjectProvider
): Promise<ProjectSettingsPage> {
  const settings = await project.settings.get();
  const defaults = {
    worktreeDirectory: await project.settings.getDefaultWorktreeDirectory(),
  };
  const resolvedTargets = await resolveAllProjectSettingsTargets(project);
  const writeTargets = getProjectSettingsWriteTargets(resolvedTargets);
  const overrideState = await computeProjectSettingsOverrideState(resolvedTargets);
  return { settings, defaults, writeTargets, overrideState };
}

export async function getProjectSettingsPage(
  projectId: string
): Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>> {
  const project = requireProject(projectId);
  if (!project.success) return project;
  return ok(await getProjectSettingsPageForProject(project.data));
}

export async function updateProjectSettings(
  projectId: string,
  settings: ProjectSettings
): Promise<Result<ProjectSettings, UpdateProjectSettingsError>> {
  const project = requireProject(projectId);
  if (!project.success) return project;

  const result = await project.data.settings.update(settings);
  if (!result.success) return result;
  return ok(await project.data.settings.get());
}

export async function shareProjectSettingsToConfig(
  projectId: string,
  request: WriteProjectConfigRequest
): Promise<Result<ProjectSettingsPage, UpdateProjectSettingsError>> {
  const project = requireProject(projectId);
  if (!project.success) return project;

  const resolvedTargets = await resolveAllProjectSettingsTargets(project.data);
  const result = await writeSharedProjectSettingsToConfig(project.data, request, resolvedTargets);
  if (!result.success) return result;

  return ok(await getProjectSettingsPageForProject(project.data));
}
