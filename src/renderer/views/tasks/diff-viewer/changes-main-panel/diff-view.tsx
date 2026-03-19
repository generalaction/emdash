import { useEffect } from 'react';
import { diffEditorPool } from '@renderer/core/monaco/monaco-diff-pool';
import { useGitViewContext } from '../state/git-view-provider';
import { DiffToolbar } from './diff-toolbar';
import { FileDiffView } from './file-diff-view';
import { StackedDiffView } from './stacked-diff-view';

export function DiffView() {
  const { viewMode, setViewMode, diffStyle, setDiffStyle } = useGitViewContext();

  // Warm up the pool as soon as the diff view is first rendered.
  useEffect(() => {
    diffEditorPool.init().catch((err: unknown) => console.warn('[monaco-pool] init failed:', err));
  }, []);

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
