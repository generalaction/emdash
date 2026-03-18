import { DiffToolbar } from '@renderer/components/diff-viewer/DiffToolbar';
import { useGitViewContext } from '../state/git-view-provider';
import { FileDiffView } from './file-diff-view';
import { StackedDiffView } from './stacked-diff-view';

export function DiffView() {
  const { viewMode, setViewMode, diffStyle, setDiffStyle } = useGitViewContext();

  return (
    <div className="flex h-full flex-col">
      <DiffToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
      />
      <div className="min-h-0 flex-1">
        {viewMode === 'stacked' ? <StackedDiffView /> : <FileDiffView />}
      </div>
    </div>
  );
}
