import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { GitChange } from '@shared/git';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { isBinaryFile } from '@renderer/lib/diffUtils';
import { useDiffViewContext } from './diff-view-provider';
import { FileDiffEditor } from './file-diff-editor';

const LARGE_DIFF_LINE_THRESHOLD = 2500;
const MIN_EDITOR_HEIGHT = 100;

interface StackedFileSectionProps {
  file: GitChange;
  projectId: string;
  taskId: string;
  diffStyle: 'unified' | 'split';
  onRefreshChanges: () => void;
  stageFile: (path: string) => Promise<void>;
  unstageFile: (path: string) => Promise<void>;
}

export function StackedDiffPanel() {
  const { projectId, taskId, fileChanges, diffStyle, refreshChanges, stageFile, unstageFile } =
    useDiffViewContext();

  if (fileChanges.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No changes to display
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {fileChanges.map((file) => (
        <StackedFileSection
          key={file.path}
          file={file}
          projectId={projectId}
          taskId={taskId}
          diffStyle={diffStyle}
          onRefreshChanges={refreshChanges}
          stageFile={stageFile}
          unstageFile={unstageFile}
        />
      ))}
    </div>
  );
}

function StackedFileSection({
  file,
  projectId,
  taskId,
  diffStyle,
  onRefreshChanges,
  stageFile,
  unstageFile,
}: StackedFileSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [forceLoad, setForceLoad] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  const binary = isBinaryFile(file.path);
  const totalDiffLines = file.additions + file.deletions;
  const isLarge = totalDiffLines > LARGE_DIFF_LINE_THRESHOLD;

  const parts = file.path.split('/');
  const fileName = parts.pop() || file.path;
  const dirPath = parts.length > 0 ? parts.join('/') + '/' : '';

  const handleStage = async (checked: boolean) => {
    try {
      if (checked) {
        await stageFile(file.path);
      } else {
        await unstageFile(file.path);
      }
    } catch (err) {
      console.error('Staging failed:', err);
    }
  };

  const editorHeight =
    contentHeight != null ? Math.max(contentHeight, MIN_EDITOR_HEIGHT) : MIN_EDITOR_HEIGHT;

  return (
    <div className="border-b border-border">
      <div className="flex w-full items-center gap-1.5 px-3 py-2 text-sm hover:bg-muted/50">
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          )}
          <span className="font-medium text-foreground">{fileName}</span>
          {dirPath && <span className="truncate text-muted-foreground">{dirPath}</span>}
        </button>
        <span className="shrink-0 text-xs">
          <span className="text-green-500">+{file.additions}</span>{' '}
          <span className="text-red-500">-{file.deletions}</span>
        </span>
        <Checkbox
          checked={file.isStaged}
          onCheckedChange={(checked) => {
            void handleStage(checked === true);
          }}
          onClick={(e) => e.stopPropagation()}
          className="ml-1 flex-shrink-0"
        />
      </div>

      {expanded && (
        <div style={{ height: binary || (isLarge && !forceLoad) ? 120 : editorHeight }}>
          {binary ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Binary file
            </div>
          ) : isLarge && !forceLoad ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>Large file ({totalDiffLines} diff lines). Loading may be slow.</span>
              <button
                className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted"
                onClick={() => setForceLoad(true)}
              >
                Load anyway
              </button>
            </div>
          ) : (
            <FileDiffEditor
              projectId={projectId}
              taskId={taskId}
              filePath={file.path}
              diffStyle={diffStyle}
              onRefreshChanges={onRefreshChanges}
              onContentHeightChange={setContentHeight}
            />
          )}
        </div>
      )}
    </div>
  );
}
