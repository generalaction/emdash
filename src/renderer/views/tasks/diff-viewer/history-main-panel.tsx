import { DiffToolbar } from '@renderer/components/diff-viewer/DiffToolbar';
import { useTheme } from '@renderer/hooks/useTheme';
import { ChangesMainPanel } from './changes-main-panel';
import { CommitFileDiffEditor } from './commit-file-diff-editor';
import { useDiffViewContext } from './diff-view-provider';
import { DiffEditorStyles } from './monaco-diff-view';

export function HistoryMainPanel() {
  const { projectId, taskId, diffStyle, setDiffStyle, selectedCommit, selectedCommitFile } =
    useDiffViewContext();

  return (
    <div className="flex h-full flex-col">
      <DiffToolbar
        viewMode="file"
        onViewModeChange={() => {}}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
        hideViewModeToggle
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {selectedCommit && selectedCommitFile ? (
          <CommitFileDiffEditor
            projectId={projectId}
            taskId={taskId}
            commitHash={selectedCommit.hash}
            filePath={selectedCommitFile}
            diffStyle={diffStyle}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {selectedCommit ? 'Select a file to view changes' : 'Select a commit to view changes'}
          </div>
        )}
      </div>
    </div>
  );
}

export function DiffViewMainPanel() {
  const { activeTab } = useDiffViewContext();
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';

  return (
    <div className="flex h-full flex-col bg-background">
      <DiffEditorStyles isDark={isDark} />
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'changes' ? <ChangesMainPanel /> : <HistoryMainPanel />}
      </div>
    </div>
  );
}
