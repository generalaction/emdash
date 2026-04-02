import { observer } from 'mobx-react-lite';
import type { GitChange } from '@shared/git';
import type { PullRequest } from '@shared/pull-requests';
import { usePrefetchModels } from '@renderer/views/tasks/diff-view/right-panel/use-prefetch-models';
import { usePrContext } from '@renderer/views/tasks/diff-view/state/pr-provider';
import { useProvisionedTask, useTaskViewContext } from '@renderer/views/tasks/task-view-context';
import { VirtualizedChangesList } from '../virtualized-changes-list';

export const PrFilesList = observer(function PrFilesList({ pr }: { pr: PullRequest }) {
  const { prFilesMap, activePrFilePath, setActivePrFilePath } = usePrContext();
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const diffView = provisioned?.diffView;
  const setView = (v: string) => provisioned?.setView(v as 'agents' | 'editor' | 'diff');

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
      className="py-3"
      changes={prFiles}
      activePath={activePrFilePath ?? undefined}
      onSelectChange={handleSelectChange}
      onPrefetch={(change) => prefetchPrDiff(change.path)}
    />
  );
});
