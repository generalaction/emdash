import { observer } from 'mobx-react-lite';
import { DiffToolbar } from './diff-toolbar';
import { FileDiffView } from './file-diff-view';

export const DiffView = observer(function DiffView() {
  return (
    <div className="flex h-full flex-col">
      <DiffToolbar />
      <div className="min-h-0 flex-1">
        <FileDiffView />
      </div>
    </div>
  );
});
