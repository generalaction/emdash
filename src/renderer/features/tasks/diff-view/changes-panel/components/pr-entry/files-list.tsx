import { observer } from 'mobx-react-lite';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { usePrefetchDiffModels } from '@renderer/features/tasks/diff-view/changes-panel/hooks/use-prefetch-diff-models';
import {
  useTaskViewContext,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { commitRef, remoteRef, type GitChange } from '@shared/git';
import { getPrNumber, type PullRequest } from '@shared/pull-requests';
import { useChangesViewMode } from '../../hooks/use-changes-view-mode';
import { ChangesListOrTree } from '../changes-list-or-tree';

export const PrFilesList = observer(function PrFilesList({ pr }: { pr: PullRequest }) {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const prStore = taskView.prStore!;
  const { mode: viewMode } = useChangesViewMode('pr');

  const repo = getRepositoryStore(projectId);
  const baseRef = remoteRef(repo?.baseRemote ?? 'origin', pr.baseRefName);
  const modifiedRef = commitRef(pr.headRefOid);
  const prFiles = prStore.getFiles(pr).data ?? [];

  const prefetchPrDiff = usePrefetchDiffModels(projectId, workspaceId, 'pr', baseRef, modifiedRef);

  const activePath =
    taskView.tabManager.activeDescriptor?.kind === 'diff' &&
    taskView.tabManager.activeDescriptor.diffGroup === 'pr'
      ? taskView.tabManager.activeDescriptor.path
      : undefined;

  const handleSelectChange = (change: GitChange) => {
    taskView.tabManager.openDiffPreview(
      {
        path: change.path,
        type: 'git',
        group: 'pr',
        originalRef: baseRef,
        modifiedRef,
        prNumber: getPrNumber(pr) ?? undefined,
      },
      change.status
    );
  };

  const handleDoubleClickChange = (change: GitChange) => {
    taskView.tabManager.openDiff(
      {
        path: change.path,
        type: 'git',
        group: 'pr',
        originalRef: baseRef,
        modifiedRef,
        prNumber: getPrNumber(pr) ?? undefined,
      },
      change.status
    );
  };

  return (
    <ChangesListOrTree
      viewMode={viewMode}
      className="py-3"
      changes={prFiles}
      activePath={activePath}
      onSelectChange={handleSelectChange}
      onDoubleClickChange={handleDoubleClickChange}
      onPrefetch={(change) => prefetchPrDiff(change.path)}
    />
  );
});
