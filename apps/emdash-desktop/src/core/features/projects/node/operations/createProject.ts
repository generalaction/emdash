import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type {
  CreateProjectParams,
  CreateProjectResult,
  InspectProjectPathParams,
  ProjectPathInspection,
} from '@core/primitives/projects/api';
import { createLocalProject, getLocalProjectPathStatus } from './create-local-project';
import type { LocalProjectOperationDependencies } from './create-local-project';
import { createSshProject, getSshProjectPathStatus } from './create-ssh-project';
import { getProjectByPath } from './getProjects';

export async function createProject(
  dependencies: LocalProjectOperationDependencies,
  params: CreateProjectParams
): Promise<CreateProjectResult> {
  if (params.type === 'local') {
    const { type: _type, ...localParams } = params;
    return createLocalProject(dependencies, localParams);
  }

  const { type: _type, ...sshParams } = params;
  return createSshProject(sshParams);
}

export async function inspectProjectPath(
  dependencies: LocalProjectOperationDependencies,
  params: InspectProjectPathParams
): Promise<ProjectPathInspection> {
  if (params.type === 'local') {
    const [status, existingProject] = await Promise.all([
      getLocalProjectPathStatus(dependencies, params.path),
      getProjectByPath(dependencies.db, LOCAL_HOST_REF, params.path),
    ]);
    return { ...status, existingProject };
  }

  const [status, existingProject] = await Promise.all([
    getSshProjectPathStatus(params.path, params.connectionId),
    getProjectByPath(dependencies.db, hostRef('remote', params.connectionId), params.path),
  ]);
  return { ...status, existingProject };
}
