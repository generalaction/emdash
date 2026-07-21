import { hostRef, LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import type { RuntimeResolveError } from '@emdash/core/primitives/runtime-resolution/api';
import type { Result } from '@emdash/shared';
import z from 'zod';

export function projectHostRef(project: Project): HostRef {
  return project.type === 'ssh' ? hostRef('remote', project.connectionId) : LOCAL_HOST_REF;
}

export type ProjectPathStatus = {
  isDirectory: boolean;
  isGitRepo: boolean;
  error?: { type: 'inspect-failed'; path: string; message: string } | RuntimeResolveError;
};

export const localProjectSchema = z.object({
  type: z.literal('local'),
  id: z.string(),
  name: z.string(),
  path: z.string(),
  baseRef: z.string(),
  repositoryWorkspaceId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type LocalProject = {
  type: 'local';
  id: string;
  name: string;
  path: string;
  baseRef: string;
  /** The workspace ID of this project's repository-root workspace. Set on first mount. */
  repositoryWorkspaceId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SshProject = {
  type: 'ssh';
  id: string;
  name: string;
  path: string;
  baseRef: string;
  connectionId: string;
  /** The workspace ID of this project's repository-root workspace. Set on first mount. */
  repositoryWorkspaceId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Project = LocalProject | SshProject;

export type CreateLocalProjectParams = {
  type: 'local';
  id?: string;
  path: string;
  name: string;
  initGitRepository?: boolean;
};

export type CreateSshProjectParams = {
  type: 'ssh';
  id?: string;
  name: string;
  path: string;
  connectionId: string;
  initGitRepository?: boolean;
};

export type CreateProjectParams = CreateLocalProjectParams | CreateSshProjectParams;

export type CreateProjectError =
  | { type: 'invalid-directory'; path: string; message: string }
  | { type: 'not-repository'; path: string }
  | { type: 'inspect-failed'; path: string; message: string }
  | { type: 'init-failed'; path: string; message: string }
  | { type: 'open-repository-failed'; path: string; message: string }
  | RuntimeResolveError;

export type CreateProjectResult = Result<Project, CreateProjectError>;

export type InspectLocalProjectPathParams = {
  type: 'local';
  path: string;
};

export type InspectSshProjectPathParams = {
  type: 'ssh';
  path: string;
  connectionId: string;
};

export type InspectProjectPathParams = InspectLocalProjectPathParams | InspectSshProjectPathParams;

export type ProjectPathInspection = ProjectPathStatus & {
  existingProject?: Project;
};

export type ProjectPlacementError =
  | RuntimeResolveError
  | { type: 'host-home-unavailable'; message: string }
  | { type: 'invalid-host-path'; path: string; message: string }
  | { type: 'filesystem-unavailable'; path: string; message: string };

export type ResolveRepositoryDestinationParams = {
  host: HostRef;
  name: string;
  chosenDir?: string;
};

export type OpenProjectError =
  | { type: 'path-not-found'; path: string }
  | { type: 'ssh-disconnected'; connectionId: string }
  | { type: 'error'; message: string }
  | RuntimeResolveError;

export type OpenProjectSuccess = {
  repositoryWorkspaceId: string | null;
};

export type UpdateProjectSettingsError =
  | { type: 'project-not-found' }
  | { type: 'invalid-settings' }
  | { type: 'invalid-worktree-directory' }
  | { type: 'write-config-failed'; message: string }
  | { type: 'error' };

export type ProjectRemoteState = {
  hasRemote: boolean;
  selectedRemoteUrl: string | null;
};
