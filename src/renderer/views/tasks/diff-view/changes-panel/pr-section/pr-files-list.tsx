import { observer } from 'mobx-react-lite';
import type { GitChange } from '@shared/git';
import type { PullRequest } from '@shared/pull-requests';
import { usePrefetchModels } from '@renderer/views/tasks/diff-view/changes-panel/use-prefetch-models';
import { useProvisionedTask, useTaskViewContext } from '@renderer/views/tasks/task-view-context';
import { VirtualizedChangesList } from '../virtualized-changes-list';

export const PrFilesList = observer(function PrFilesList({ pr }: { pr: PullRequest }) {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const prStore = provisioned.workspace.pr;
  const diffView = provisioned.taskView.diffView;

  const baseRef = pr.metadata.baseRefName;
  const prFiles = prStore.getFiles(pr).data ?? [];

  const prefetchPrDiff = usePrefetchModels(projectId, taskId, 'git', baseRef);

  // Use diffView.activeFile to derive the active path — avoids separate React state.
  const activePath = diffView.activeFile?.type === 'git' ? diffView.activeFile.path : undefined;

  const handleSelectChange = (change: GitChange) => {
    diffView.setActiveFile({ path: change.path, type: 'git', originalRef: baseRef });
    provisioned.taskView.setView('diff');
  };

  return (
    <VirtualizedChangesList
      className="py-3"
      changes={prFiles}
      activePath={activePath}
      onSelectChange={handleSelectChange}
      onPrefetch={(change) => prefetchPrDiff(change.path)}
    />
  );
});
