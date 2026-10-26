import type { Result } from '@emdash/shared';
import type { IntegrationError } from '../integrations/types';

export type RepositoryOwner = {
  login: string;
  type: 'User' | 'Organization';
  avatarUrl: string;
};

export type RepositoryVisibility = 'public' | 'private';

export type CreateRepositoryOpts = {
  owner: string;
  name: string;
  description?: string;
  visibility: RepositoryVisibility;
  initializeWithReadme?: boolean;
};

export type CreatedRepository = {
  repositoryUrl: string;
  cloneUrl: string;
  nameWithOwner: string;
  defaultBranch: string;
};

export type DeleteRepositoryOpts = {
  owner: string;
  name: string;
};

export type RepositoryError = IntegrationError;

/**
 * `unsupported_host`: the host answered but is not this platform.
 * `host_unreachable` / `host_error`: no verdict; the host may still be this platform.
 */
export type RepositoryHostProbeError = {
  type: 'unsupported_host' | 'host_unreachable' | 'host_error';
  host: string;
  message: string;
};

export type RepositoryHostProbeResult = Result<void, RepositoryHostProbeError>;
