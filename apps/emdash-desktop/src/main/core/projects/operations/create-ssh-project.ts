import { err } from '@emdash/shared';
import type { CreateProjectResult, ProjectPathStatus } from '@shared/projects';

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
  return err({
    type: 'inspect-failed',
    path: params.path,
    message: 'Remote projects require the workspace server and are not supported by this build',
  });
}

export async function getSshProjectPathStatus(
  path: string,
  _connectionId: string
): Promise<ProjectPathStatus> {
  return {
    isDirectory: false,
    isGitRepo: false,
    error: {
      type: 'inspect-failed',
      path,
      message: 'Remote projects require the workspace server and are not supported by this build',
    },
  };
}
