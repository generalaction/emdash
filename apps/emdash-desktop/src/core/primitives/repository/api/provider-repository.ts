import type { Result } from '@emdash/shared';

/** The integration that owns the repository's host, e.g. `'github'`. */
export type RepositoryProvider = string;

export type ProviderRepositoryCapabilities = {
  pullRequests: boolean;
  issues: boolean;
};

export type ProviderRepository = {
  provider: RepositoryProvider;
  host: string;
  repositoryUrl: string;
  nameWithOwner: string;
  capabilities: ProviderRepositoryCapabilities;
};

export type ProviderRepositoryError =
  | { type: 'no_remote' }
  | { type: 'invalid_remote' }
  | { type: 'no_integration_for_host'; host: string }
  | { type: 'ambiguous_host'; host: string; integrationIds: string[] }
  | { type: 'host_unreachable'; host: string; reason: string }
  | { type: 'host_error'; host: string; reason: string };

export type ProviderRepositoryResult = Result<ProviderRepository, ProviderRepositoryError>;

export function providerRepositoryErrorMessage(error: ProviderRepositoryError): string {
  switch (error.type) {
    case 'no_remote':
      return 'This project has no git remote.';
    case 'invalid_remote':
      return 'The selected git remote is not a recognized repository URL.';
    case 'no_integration_for_host':
      return `No connected integration handles ${error.host}. Connect an account for that host in settings.`;
    case 'ambiguous_host':
      return `More than one integration (${error.integrationIds.join(', ')}) claims ${error.host}.`;
    case 'host_unreachable':
      return `Could not reach ${error.host}.`;
    case 'host_error':
      return `${error.host} returned an error: ${error.reason}`;
  }
}
