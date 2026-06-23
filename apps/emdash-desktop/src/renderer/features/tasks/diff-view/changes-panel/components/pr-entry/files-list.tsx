import type { GitChange } from '@emdash/core/git';
import { observer } from 'mobx-react-lite';
import { usePrefetchDiffModels } from '@renderer/features/tasks/diff-view/changes-panel/hooks/use-prefetch-diff-models';
import {
  useTaskViewContext,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { commitRef, refsEqual } from '@shared/core/git/utils';
import { getPrNumber, type PullRequest } from '@shared/core/pull-requests/pull-requests';
import { useChangesViewMode } from '../../hooks/use-changes-view-mode';
import { ChangesListOrTree } from '../changes-list-or-tree';

export const PrFilesList = observer(function PrFilesList({ pr }: { pr: PullRequest }) {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const prStore = taskView.prStore!;
  const { mode: viewMode } = useChangesViewMode('pr');

  const prNumber = getPrNumber(pr) ?? undefined;
  const baseRef = commitRef(pr.baseRefOid);
  const modifiedRef = commitRef(pr.headRefOid);
  const prFiles = prStore.getFiles(pr).data ?? [];

  const prefetchPrDiff = usePrefetchDiffModels(projectId, workspaceId, 'pr', baseRef, modifiedRef);

  const activePath =
    taskView.activePane.activeDescriptor?.kind === 'diff' &&
    taskView.activePane.activeDescriptor.diffGroup === 'pr' &&
    taskView.activePane.activeDescriptor.prNumber === prNumber &&
    refsEqual(taskView.activePane.activeDescriptor.originalRef, baseRef) &&
    refsEqual(taskView.activePane.activeDescriptor.modifiedRef ?? modifiedRef, modifiedRef)
      ? taskView.activePane.activeDescriptor.path
      : undefined;

  const handleSelectChange = (change: GitChange) => {
    taskView.activePane.open('diff', {
      activeFile: {
        path: change.path,
        type: 'git',
        group: 'pr',
        originalRef: baseRef,
        modifiedRef,
        prNumber,
        prBaseOid: pr.baseRefOid,
        prHeadOid: pr.headRefOid,
      },
      status: change.status,
      preview: true,
    });
  };

  const handleDoubleClickChange = (change: GitChange) => {
    taskView.activePane.open('diff', {
      activeFile: {
        path: change.path,
        type: 'git',
        group: 'pr',
        originalRef: baseRef,
        modifiedRef,
        prNumber,
        prBaseOid: pr.baseRefOid,
        prHeadOid: pr.headRefOid,
      },
      status: change.status,
      preview: false,
    });
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
