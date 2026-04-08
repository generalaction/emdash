import { GitCommitHorizontal, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { Commit } from '@shared/git';
import { formatRelativeTime } from '@renderer/lib/github';
import { useProvisionedTask } from '@renderer/views/tasks/task-view-context';

export const PrCommitsList = observer(function PrCommitsList() {
  const prStore = useProvisionedTask().workspace.pr;
  const { data, loading } = prStore.commitHistory;

  const aheadCount = data?.aheadCount ?? 0;
  const allCommits = data?.commits ?? [];
  // Show only the commits that are ahead of upstream — those belong to the PR.
  // If aheadCount is 0 (e.g. upstream not configured), fall back to all commits.
  const commits = aheadCount > 0 ? allCommits.slice(0, aheadCount) : allCommits;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (commits.length === 0) {
    return <div className="py-10 text-center text-xs text-muted-foreground">No commits</div>;
  }

  return (
    <div>
      {commits.map((commit) => (
        <CommitItem key={commit.hash} commit={commit} />
      ))}
    </div>
  );
});

function CommitItem({ commit }: { commit: Commit }) {
  const shortHash = commit.hash.slice(0, 7);

  return (
    <div className="flex items-start gap-2 px-3 py-2">
      <GitCommitHorizontal className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">{commit.subject}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="font-mono">{shortHash}</span>
          <span>·</span>
          <span className="truncate">{commit.author}</span>
          <span>·</span>
          <span className="shrink-0">{formatRelativeTime(commit.date)}</span>
        </div>
      </div>
    </div>
  );
}
