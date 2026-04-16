import { observer } from 'mobx-react-lite';
import { Activity } from 'react';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { DiffToolbar } from './diff-toolbar';
import { FileDiffView } from './file-diff-view';
import { StackedDiffView } from './stacked-diff-view';

export const DiffView = observer(function DiffView() {
  const diffView = useProvisionedTask().taskView.diffView;

  return (
    <div className="flex h-full flex-col">
      <DiffToolbar />
      <div className="min-h-0 flex-1">
        <Activity mode={diffView.viewMode === 'stacked' ? 'visible' : 'hidden'}>
          <StackedDiffView />
        </Activity>
        <Activity mode={diffView.viewMode === 'file' ? 'visible' : 'hidden'}>
          <FileDiffView />
        </Activity>
      </div>
    </div>
  );
});
