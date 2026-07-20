import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type {
  CreateProjectParams,
  CreateProjectResult,
  InspectProjectPathParams,
  ProjectPathInspection,
} from '@core/primitives/projects/api';
import { createLocalProject, getLocalProjectPathStatus } from './create-local-project';
import { createSshProject, getSshProjectPathStatus } from './create-ssh-project';
import { getProjectByPath } from './getProjects';

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
      getProjectByPath(LOCAL_HOST_REF, params.path),
    ]);
    return { ...status, existingProject };
  }

  const [status, existingProject] = await Promise.all([
    getSshProjectPathStatus(params.path, params.connectionId),
    getProjectByPath(hostRef('remote', params.connectionId), params.path),
  ]);
  return { ...status, existingProject };
}
