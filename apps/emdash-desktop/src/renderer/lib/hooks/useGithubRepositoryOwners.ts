import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { rpc } from '@renderer/lib/ipc';
import type { ComboboxSelectOption } from '@renderer/lib/ui/combobox-popover';

function toErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.length > 0) return error;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return fallback;
}

export function useGitHubRepositoryOwnerSelect(githubAccountId: string | null) {
  const [ownerOverride, setOwnerOverride] = useState<{
    githubAccountId: string;
    owner: ComboboxSelectOption;
  } | null>(null);

  const query = useQuery({
    queryKey: ['owners', githubAccountId],
    queryFn: () => rpc.github.getOwners(githubAccountId ?? undefined),
    enabled: githubAccountId !== null,
  });

  const owners = useMemo(
    () =>
      githubAccountId !== null && query.data?.success === true
        ? (query.data.owners ?? []).map((owner) => ({ value: owner.login, label: owner.login }))
        : [],
    [githubAccountId, query.data]
  );
  const owner =
    ownerOverride?.githubAccountId === githubAccountId ? ownerOverride.owner : (owners[0] ?? null);
  const errorMessage =
    query.data?.success === false
      ? (query.data.error ?? 'Failed to load repository owners')
      : query.error
        ? toErrorMessage(query.error, 'Failed to load repository owners')
        : null;

  const handleOwnerChange = (nextOwner: ComboboxSelectOption) => {
    if (githubAccountId === null) return;
    setOwnerOverride({ githubAccountId, owner: nextOwner });
  };

  return {
    owners,
    owner,
    isLoading: query.isLoading,
    errorMessage,
    handleOwnerChange,
  };
}
