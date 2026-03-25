import { observer } from 'mobx-react-lite';
import type { GitChange } from '@shared/git';
import type { PullRequest } from '@shared/pull-requests';
import { taskViewStateStore } from '@renderer/core/tasks/view/task-view-store';
import { usePrefetchModels } from '@renderer/views/tasks/diff-viewer/right-panel/use-prefetch-models';
import { usePrContext } from '@renderer/views/tasks/diff-viewer/state/pr-provider';
import { useTaskViewContext } from '@renderer/views/tasks/task-view-context';
import { getTaskStore, provisionedTask } from '@renderer/views/tasks/task-view-state';
import { VirtualizedChangesList } from '../virtualized-changes-list';

export const PrFilesList = observer(function PrFilesList({ pr }: { pr: PullRequest }) {
  const { prFilesMap, activePrFilePath, setActivePrFilePath } = usePrContext();
  const { projectId, taskId } = useTaskViewContext();
  const diffView = provisionedTask(getTaskStore(projectId, taskId))?.diffView;
  const setView = (v: string) =>
    taskViewStateStore.getOrCreate(taskId).setView(v as 'agents' | 'editor' | 'diff');

  const baseRef = pr.metadata.baseRefName;
  const prFiles = prFilesMap[pr.id] ?? [];

  const prefetchPrDiff = usePrefetchModels(projectId, taskId, 'git', baseRef);

  const handleSelectChange = (change: GitChange) => {
    setActivePrFilePath(change.path);
    diffView?.setActiveFile({ path: change.path, type: 'git', originalRef: baseRef });
    setView('diff');
  };

  return (
    <VirtualizedChangesList
      changes={prFiles}
      activePath={activePrFilePath ?? undefined}
      onSelectChange={handleSelectChange}
      onPrefetch={(change) => prefetchPrDiff(change.path)}
    />
  );
});
