import { observer } from 'mobx-react-lite';
import type { GitChange } from '@shared/git';
import type { PullRequest } from '@shared/pull-requests';
import { getRepositoryStore } from '@renderer/features/projects/stores/project-selectors';
import { usePrefetchDiffModels } from '@renderer/features/tasks/diff-view/changes-panel/hooks/use-prefetch-diff-models';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { VirtualizedChangesList } from '../virtualized-changes-list';

export const PrFilesList = observer(function PrFilesList({ pr }: { pr: PullRequest }) {
  const { projectId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const prStore = provisioned.workspace.pr;
  const diffView = provisioned.taskView.diffView;

  const repo = getRepositoryStore(projectId);
  const baseRef = `${repo?.configuredRemote ?? 'origin'}/${pr.metadata.baseRefName}`;
  const prFiles = prStore.getFiles(pr).data ?? [];

  const prefetchPrDiff = usePrefetchDiffModels(projectId, provisioned.workspaceId, 'pr', baseRef);

  // Use diffView.activeFile to derive the active path — avoids separate React state.
  const activePath = diffView.activeFile?.group === 'pr' ? diffView.activeFile.path : undefined;

  const handleSelectChange = (change: GitChange) => {
    diffView.setActiveFile({
      path: change.path,
      type: 'git',
      group: 'pr',
      originalRef: baseRef,
      prNumber: pr.metadata.number,
    });
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
