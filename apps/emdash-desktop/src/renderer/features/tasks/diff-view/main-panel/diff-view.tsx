import { observer } from 'mobx-react-lite';
import type { DiffTabStore } from '@renderer/features/tasks/tabs/diff-tab-store';
import { DiffFileRenderer } from './diff-file-renderer';
import { DiffToolbar } from './diff-toolbar';

interface DiffViewProps {
  tab: DiffTabStore;
}

export const DiffView = observer(function DiffView({ tab }: DiffViewProps) {
  return (
    <div className="flex h-full flex-col">
      <DiffToolbar tab={tab} />
      <div className="min-h-0 flex-1">
        <DiffFileRenderer tab={tab} />
      </div>
    </div>
  );
});
