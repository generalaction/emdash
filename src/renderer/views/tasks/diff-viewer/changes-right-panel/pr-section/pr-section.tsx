import { PullRequest } from '@shared/pull-requests';
import { CreatePullRequestSection } from './create-pr-section';
import { MergePullRequestSection } from './merge-pr-section';
import { PrFilesList } from './pr-files-list';
import { StatusSection } from './status-section';

export function PullRequestEntry({ pr }: { pr: PullRequest }) {
  if (state === 'can-create-pr') {
    return <CreatePullRequestSection nameWithOwner={nameWithOwner!} branchName={branchName!} />;
  }

  if ((state === 'merged' || state === 'closed') && pr) {
    return <StatusSection pr={pr} nameWithOwner={nameWithOwner!} />;
  }

  // state === 'has-pr'
  return (
    <>
      <StatusSection pr={pr!} nameWithOwner={nameWithOwner!} />
      <PrFilesList
        nameWithOwner={nameWithOwner!}
        prNumber={pr!.number}
        baseBranch={baseBranch ?? 'main'}
      />
      <MergePullRequestSection prDetails={prDetails} onMerge={mergePr} />
    </>
  );
}

export function CreatePullRequestCard() {
  return <div>Create Pull Request Card</div>;
}
