import { observer } from 'mobx-react-lite';
import { usePrefetchDiffModels } from '@renderer/features/tasks/diff-view/changes-panel/hooks/use-prefetch-diff-models';
import {
  useTaskViewContext,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { commitRef, refsEqual, type GitChange } from '@shared/git';
import { getPrNumber, type PullRequest } from '@shared/pull-requests';
import { VirtualizedChangesList } from '../virtualized-changes-list';

export const PrFilesList = observer(function PrFilesList({ pr }: { pr: PullRequest }) {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const prStore = taskView.prStore!;

  const prNumber = getPrNumber(pr) ?? undefined;
  const baseRef = commitRef(pr.baseRefOid);
  const modifiedRef = commitRef(pr.headRefOid);
  const prFiles = prStore.getFiles(pr).data ?? [];

  const prefetchPrDiff = usePrefetchDiffModels(projectId, workspaceId, 'pr', baseRef, modifiedRef);

  const activePath =
    taskView.tabManager.activeDescriptor?.kind === 'diff' &&
    taskView.tabManager.activeDescriptor.diffGroup === 'pr' &&
    taskView.tabManager.activeDescriptor.prNumber === prNumber &&
    refsEqual(taskView.tabManager.activeDescriptor.originalRef, baseRef) &&
    refsEqual(taskView.tabManager.activeDescriptor.modifiedRef ?? modifiedRef, modifiedRef)
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
        prNumber,
        prBaseOid: pr.baseRefOid,
        prHeadOid: pr.headRefOid,
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
        prNumber,
        prBaseOid: pr.baseRefOid,
        prHeadOid: pr.headRefOid,
      },
      change.status
    );
  };

  return (
    <VirtualizedChangesList
      className="py-3"
      changes={prFiles}
      activePath={activePath}
      onSelectChange={handleSelectChange}
      onDoubleClickChange={handleDoubleClickChange}
      onPrefetch={(change) => prefetchPrDiff(change.path)}
    />
  );
});
