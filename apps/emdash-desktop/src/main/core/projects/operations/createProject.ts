import type {
  CreateProjectParams,
  CreateProjectResult,
  InspectProjectPathParams,
  ProjectPathInspection,
} from '@shared/projects';
import { createLocalProject, getLocalProjectPathStatus } from './create-local-project';
import { createSshProject, getSshProjectPathStatus } from './create-ssh-project';
import { getLocalProjectByPath, getSshProjectByPath } from './getProjects';

export async function createProject(params: CreateProjectParams): Promise<CreateProjectResult> {
  if (params.type === 'local') {
    const { type: _type, ...localParams } = params;
    return createLocalProject(localParams);
  }

  const { type: _type, ...sshParams } = params;
  return createSshProject(sshParams);
}

export async function inspectProjectPath(
  params: InspectProjectPathParams
): Promise<ProjectPathInspection> {
  if (params.type === 'local') {
    const [status, existingProject] = await Promise.all([
      getLocalProjectPathStatus(params.path),
      getLocalProjectByPath(params.path),
    ]);
    return { ...status, existingProject };
  }

  const [status, existingProject] = await Promise.all([
    getSshProjectPathStatus(params.path, params.connectionId),
    getSshProjectByPath(params.path, params.connectionId),
  ]);
  return { ...status, existingProject };
}
