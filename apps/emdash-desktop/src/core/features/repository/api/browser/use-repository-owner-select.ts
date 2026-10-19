import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useGitHubRepositoryOwnerSelect } from '@core/features/github/api/browser/useGithubRepositoryOwners';
import { getRepositoryClient } from '../client';

export type RepositoryOwnerOption = { value: string; label: string; avatarUrl: string };

export function useRepositoryOwnerSelect(provider: 'github' | 'gitlab', accountId: string | null) {
  const githubOwners = useGitHubRepositoryOwnerSelect(provider === 'github' ? accountId : null);
  const [gitlabOwnerOverride, setGitlabOwnerOverride] = useState<{
    accountId: string;
    owner: RepositoryOwnerOption;
  } | null>(null);
  const gitlabOwnersQuery = useQuery({
    queryKey: ['gitlab-repository-owners', accountId],
    queryFn: async () => (await getRepositoryClient()).gitLabOwners({ accountId: accountId! }),
    enabled: provider === 'gitlab' && accountId !== null,
  });
  const gitlabOwners: RepositoryOwnerOption[] =
    provider === 'gitlab' && gitlabOwnersQuery.data?.success
      ? gitlabOwnersQuery.data.owners.map((owner) => ({
          value: owner.login,
          label: owner.login,
          avatarUrl: owner.avatarUrl,
        }))
      : [];
  const owners = provider === 'github' ? githubOwners.owners : gitlabOwners;
  const owner =
    provider === 'github'
      ? githubOwners.owner
      : gitlabOwnerOverride?.accountId === accountId &&
          owners.some((candidate) => candidate.value === gitlabOwnerOverride.owner.value)
        ? gitlabOwnerOverride.owner
        : (owners[0] ?? null);
  const errorMessage =
    provider === 'github'
      ? githubOwners.errorMessage
      : gitlabOwnersQuery.data?.success === false
        ? gitlabOwnersQuery.data.error
        : gitlabOwnersQuery.error instanceof Error
          ? gitlabOwnersQuery.error.message
          : null;
  const handleOwnerChange = (nextOwner: RepositoryOwnerOption) => {
    if (provider === 'github') githubOwners.handleOwnerChange(nextOwner);
    else if (accountId) setGitlabOwnerOverride({ accountId, owner: nextOwner });
  };
  return {
    owners,
    owner,
    errorMessage,
    isLoading: provider === 'github' ? githubOwners.isLoading : gitlabOwnersQuery.isLoading,
    handleOwnerChange,
  };
}
