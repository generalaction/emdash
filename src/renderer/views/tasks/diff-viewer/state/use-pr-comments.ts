import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/core/ipc';
import type { PrComment } from '@renderer/lib/github';

function mergeAndSort(
  rawComments: Array<{
    id: number;
    author: { login: string; avatarUrl?: string };
    body: string;
    createdAt: string;
  }>,
  rawReviews: Array<{
    id: number;
    author: { login: string; avatarUrl?: string };
    body: string;
    submittedAt?: string;
    state: string;
  }>
): PrComment[] {
  const comments: PrComment[] = rawComments.map((c) => ({
    id: String(c.id),
    author: c.author,
    body: c.body,
    createdAt: c.createdAt,
    type: 'comment',
  }));

  const reviews: PrComment[] = rawReviews
    .filter((r) => r.body || r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED')
    .map((r) => ({
      id: String(r.id),
      author: r.author,
      body: r.body,
      createdAt: r.submittedAt ?? '',
      type: 'review',
      reviewState: r.state as PrComment['reviewState'],
    }));

  const toMillis = (dateStr: string): number => {
    const ms = new Date(dateStr).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  };

  return [...comments, ...reviews].sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));
}

export function usePrComments(nameWithOwner?: string, prNumber?: number) {
  const queryClient = useQueryClient();
  const queryKey = ['pr-comments', nameWithOwner, prNumber];

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const result = await rpc.pullRequests.getPrComments(nameWithOwner!, prNumber!);
      if (!result.success) throw new Error(result.error ?? 'Failed to fetch comments');
      const rawComments = 'comments' in result ? result.comments : [];
      const rawReviews = 'reviews' in result ? result.reviews : [];
      return mergeAndSort(rawComments ?? [], rawReviews ?? []);
    },
    enabled: !!nameWithOwner && !!prNumber,
    staleTime: 30_000,
    refetchInterval: () => (document.hidden ? false : 60_000),
  });

  const addComment = useMutation({
    mutationFn: async (body: string) => {
      const result = await rpc.pullRequests.addPrComment(nameWithOwner!, prNumber!, body);
      if (!result.success) throw new Error(result.error ?? 'Failed to add comment');
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    comments: query.data ?? [],
    isLoading: query.isLoading,
    addComment: addComment.mutateAsync,
    isAddingComment: addComment.isPending,
  };
}
