import { ChevronDown, ChevronRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { usePrefetchDiffModels } from '@renderer/features/tasks/diff-view/changes-panel/hooks/use-prefetch-diff-models';
import {
  useTaskViewContext,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { RelativeTime } from '@renderer/lib/ui/relative-time';
import { cn } from '@renderer/utils/utils';
import { commitRef, refsEqual, type Commit, type GitChange, type GitObjectRef } from '@shared/git';
import { ChangesListItem } from '../changes-list-item';
import { useCommitFiles } from './use-commit-files';
import { usePrCommits } from './use-pr-commits';

export const PrCommitsList = observer(function PrCommitsList() {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const pr = taskView.prStore?.currentPr;
  const [expandedHashes, setExpandedHashes] = useState<Set<string>>(() => new Set());
  const { data, isFetchingNextPage, hasNextPage, fetchNextPage } = usePrCommits(
    projectId,
    workspaceId,
    pr
  );

  const commits = data?.pages.flat() ?? [];
  const toggleExpanded = (hash: string) => {
    setExpandedHashes((current) => {
      const next = new Set(current);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
  };

  if (commits.length === 0 && !isFetchingNextPage) {
    return <EmptyState label="No commits" description="No commits available" />;
  }

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto py-2">
      <div className="flex flex-col gap-1">
        {commits.map((commit, index) => (
          <CommitItem
            key={commit.hash}
            commit={commit}
            isExpanded={expandedHashes.has(commit.hash)}
            isFirst={index === 0}
            isLast={index === commits.length - 1}
            onToggleExpanded={() => toggleExpanded(commit.hash)}
          />
        ))}
      </div>
      {hasNextPage && (
        <div className="flex justify-center py-2">
          <button
            className="hover:bg-surface-raised rounded-md px-3 py-1 text-xs text-foreground-muted transition-colors hover:text-foreground"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
});

function CommitItem({
  commit,
  isExpanded,
  isFirst,
  isLast,
  onToggleExpanded,
}: {
  commit: Commit;
  isExpanded: boolean;
  isFirst: boolean;
  isLast: boolean;
  onToggleExpanded: () => void;
}) {
  const shortHash = commit.hash.slice(0, 7);

  return (
    <div className="flex items-stretch">
      <div className="relative w-3.5 shrink-0">
        <div
          className={cn(
            'absolute left-1/2 top-0 h-[19px] w-px -translate-x-1/2 bg-border',
            isFirst && 'invisible'
          )}
        />
        <div className="absolute top-[19px] left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-foreground-passive" />
        <div
          className={cn(
            'absolute bottom-0 left-1/2 top-[25px] w-px -translate-x-1/2 bg-border',
            isLast && 'invisible'
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <button
          className={cn(
            'group flex w-full rounded-md px-1.5 py-1 text-left hover:bg-background-1',
            isExpanded && 'bg-background-1'
          )}
          onClick={onToggleExpanded}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{commit.subject}</span>
            <span className="flex min-w-0 items-center gap-1 text-xs text-foreground-muted">
              <span className="min-w-0 truncate font-medium">{commit.author}</span>
              {'·'}
              <RelativeTime compact value={commit.date} className="text-foreground-muted" />
              {'·'}
              <span className="font-mono text-foreground-passive">{shortHash}</span>
              {isExpanded ? (
                <ChevronDown className="size-3.5 shrink-0 text-foreground-muted" />
              ) : (
                <ChevronRight className="size-3.5 shrink-0 text-foreground-muted" />
              )}
            </span>
          </span>
        </button>
        {isExpanded && <CommitFilesList commit={commit} />}
      </div>
    </div>
  );
}

const parentRefForCommit = (commit: Commit): GitObjectRef => commitRef(`${commit.hash}^`);

const commitRefForCommit = (commit: Commit): GitObjectRef => commitRef(commit.hash);

const refsMatch = (left: GitObjectRef | undefined, right: GitObjectRef): boolean =>
  left !== undefined && refsEqual(left, right);

const CommitFilesList = observer(function CommitFilesList({ commit }: { commit: Commit }) {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const originalRef = useMemo(() => parentRefForCommit(commit), [commit]);
  const modifiedRef = useMemo(() => commitRefForCommit(commit), [commit]);
  const filesQuery = useCommitFiles(projectId, workspaceId, commit.hash, true);
  const prefetchDiff = usePrefetchDiffModels(
    projectId,
    workspaceId,
    'git',
    originalRef,
    modifiedRef
  );

  const activePath =
    taskView.tabManager.activeDescriptor?.kind === 'diff' &&
    taskView.tabManager.activeDescriptor.diffGroup === 'git' &&
    refsEqual(taskView.tabManager.activeDescriptor.originalRef, originalRef) &&
    refsMatch(taskView.tabManager.activeDescriptor.modifiedRef, modifiedRef)
      ? taskView.tabManager.activeDescriptor.path
      : undefined;

  const openPreview = (change: GitChange) => {
    taskView.tabManager.openDiffPreview(
      {
        path: change.path,
        type: 'git',
        group: 'git',
        originalRef,
        modifiedRef,
      },
      change.status
    );
  };

  const openDiff = (change: GitChange) => {
    taskView.tabManager.openDiff(
      {
        path: change.path,
        type: 'git',
        group: 'git',
        originalRef,
        modifiedRef,
      },
      change.status
    );
  };

  if (filesQuery.isLoading) {
    return <div className="px-6 py-2 text-xs text-foreground-passive">Loading files...</div>;
  }

  if (filesQuery.isError) {
    return <div className="px-6 py-2 text-xs text-foreground-passive">Unable to load files</div>;
  }

  const files = filesQuery.data ?? [];
  if (files.length === 0) {
    return <div className="px-6 py-2 text-xs text-foreground-passive">No file changes</div>;
  }

  return (
    <div className="pr-1 pb-1 pl-5">
      <div className="flex flex-col gap-0.5">
        {files.map((change) => (
          <ChangesListItem
            key={change.path}
            change={change}
            isActive={change.path === activePath}
            className="h-7"
            onClick={() => openPreview(change)}
            onDoubleClick={() => openDiff(change)}
            onMouseEnter={() => prefetchDiff(change.path)}
          />
        ))}
      </div>
    </div>
  );
});
