import { err } from '@emdash/shared';
import { remoteRuntimeUnavailable } from '@core/features/runtime-routing/api';
import type { CreateProjectResult, ProjectPathStatus } from '@core/primitives/projects/api';

export type CreateSshProjectParams = {
  id?: string;
  name: string;
  path: string;
  connectionId: string;
  initGitRepository?: boolean;
};

export async function createSshProject(
  params: CreateSshProjectParams
): Promise<CreateProjectResult> {
  return err(remoteRuntimeUnavailable(params.connectionId, 'projects'));
}

export async function getSshProjectPathStatus(
  _path: string,
  connectionId: string
): Promise<ProjectPathStatus> {
  return {
    isDirectory: false,
    isGitRepo: false,
    error: remoteRuntimeUnavailable(connectionId, 'projects'),
  };
}
