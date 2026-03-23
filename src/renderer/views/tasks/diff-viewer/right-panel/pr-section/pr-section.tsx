import type { PullRequest, PullRequestStatus } from '@shared/pull-requests';
import type { PullRequestDetails, PullRequestSummary } from '@renderer/lib/github';
import { usePrContext } from '../../state/pr-provider';
import { MergePullRequestSection } from './merge-pr-section';
import { StatusSection } from './status-section';

function statusToState(status: PullRequestStatus): 'OPEN' | 'CLOSED' | 'MERGED' {
  if (status === 'merged') return 'MERGED';
  if (status === 'closed') return 'CLOSED';
  return 'OPEN';
}

function toPrSummary(pr: PullRequest): PullRequestSummary {
  return {
    number: pr.metadata.number,
    title: pr.title,
    headRefName: pr.metadata.headRefName,
    baseRefName: pr.metadata.baseRefName,
    url: pr.url,
    isDraft: pr.isDraft,
    updatedAt: pr.updatedAt,
    authorLogin: pr.author?.userName ?? null,
    headRefOid: pr.metadata.headRefOid,
    state: statusToState(pr.status),
    reviewDecision: pr.metadata.reviewDecision,
  };
}

function toPrDetails(pr: PullRequest): PullRequestDetails {
  return {
    ...toPrSummary(pr),
    additions: pr.metadata.additions,
    deletions: pr.metadata.deletions,
    changedFiles: pr.metadata.changedFiles,
    mergeable: pr.metadata.mergeable,
    mergeStateStatus: pr.metadata.mergeStateStatus,
    body: pr.metadata.body,
  };
}

export function PullRequestEntry({ pr }: { pr: PullRequest }) {
  const { mergePr } = usePrContext();
  const summary = toPrSummary(pr);

  if (pr.status === 'merged' || pr.status === 'closed') {
    return <StatusSection pr={summary} nameWithOwner={pr.nameWithOwner} />;
  }

  return (
    <>
      <StatusSection pr={summary} nameWithOwner={pr.nameWithOwner} />
      <MergePullRequestSection
        prDetails={toPrDetails(pr)}
        onMerge={(options) => mergePr(pr.id, options)}
      />
    </>
  );
}
