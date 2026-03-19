import { usePullRequestSection } from '../../state/use-pr-section';
import { CreatePullRequestSection } from './create-pr-section';
import { MergePullRequestSection } from './merge-pr-section';
import { PrFilesList } from './pr-files-list';
import { StatusSection } from './status-section';

export function PullRequestSection() {
  const { state, pr, prDetails, branchName, baseBranch, nameWithOwner, isLoading, actions } =
    usePullRequestSection();

  if (isLoading || state === 'no-remote' || state === 'up-to-date') {
    return null;
  }

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
      <MergePullRequestSection prDetails={prDetails} onMerge={actions.mergePr} />
    </>
  );
}
