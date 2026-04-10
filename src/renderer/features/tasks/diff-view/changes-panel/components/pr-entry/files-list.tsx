import { observer } from 'mobx-react-lite';
import type { GitChange } from '@shared/git';
import type { PullRequest } from '@shared/pull-requests';
import { usePrefetchDiffModels } from '@renderer/features/tasks/diff-view/changes-panel/hooks/use-prefetch-diff-models';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { VirtualizedChangesList } from '../virtualized-changes-list';

export const PrFilesList = observer(function PrFilesList({ pr }: { pr: PullRequest }) {
  const { projectId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const prStore = provisioned.workspace.pr;
  const diffView = provisioned.taskView.diffView;

  const baseRef = pr.metadata.baseRefName;
  const prFiles = prStore.getFiles(pr).data ?? [];

  const prefetchPrDiff = usePrefetchDiffModels(projectId, provisioned.workspaceId, 'git', baseRef);

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
