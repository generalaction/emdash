import { useQuery } from '@tanstack/react-query';
import { useIntegrationsContext } from '@core/features/integrations/contributions/browser/integrations-provider';
import { getIssuesClient } from '@core/features/issues/api/browser/client';
import type { LinkedIssue } from '@core/primitives/linked-issues/api';

export function useLinkedIssueContext(
  issue: LinkedIssue | null,
  projectId: string | undefined,
  enabled = true
) {
  const { integrationById } = useIntegrationsContext();
  const supportsContext =
    !!issue && !!integrationById[issue.provider]?.issueCapabilities.supportsIssueContext;
  const shouldFetch = enabled && supportsContext;
  const queryKey = [
    'issues:context',
    projectId,
    issue?.provider,
    issue?.accountId,
    issue?.identifier,
    issue?.url,
  ];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      if (!issue) return null;
      const result = await (
        await getIssuesClient()
      ).getIssueContext({
        provider: issue.provider,
        options: {
          projectId,
          identifier: issue.identifier,
          accountId: issue.accountId,
          issueUrl: issue.url || undefined,
        },
      });
      if (!result.success) throw new Error(result.error.message);
      return { ...result.data, url: issue.url || result.data.url };
    },
    enabled: shouldFetch,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  return {
    issue: query.data ?? issue,
    isLoading: shouldFetch && (query.isPending || query.isFetching),
    error: shouldFetch ? (query.error?.message ?? null) : null,
    retry: () => void query.refetch(),
  };
}
