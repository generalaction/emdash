import { FileCode, Pencil } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { BinaryRenderer } from '@renderer/core/editor/binary-renderer';
import { ImageRenderer } from '@renderer/core/editor/image-renderer';
import { MarkdownEditorRenderer } from '@renderer/core/editor/markdown-renderer';
import { SvgRenderer } from '@renderer/core/editor/svg-renderer';
import { TooLargeRenderer } from '@renderer/core/editor/too-large-renderer';
import type { ManagedFile } from '@renderer/core/editor/types';
import { useOpenedFile } from '@renderer/core/editor/use-opened-file';
import { taskViewStateStore } from '@renderer/core/tasks/view/task-view-store';
import { FileTabs } from '@renderer/views/tasks/editor/file-tabs';
import { useEditorContext } from './editor-provider';

export const EditorMainPanel = observer(function EditorMainPanel() {
  const {
    modelRootPath,
    tabs,
    activeFilePath,
    previewFilePath,
    handleCloseFile,
    setActiveFile,
    pinFile,
    taskId,
    setEditorHost,
  } = useEditorContext();

  const editorView = taskViewStateStore.getOrCreate(taskId).editorView;
  const openFiles = editorView.openFiles;
  const activeFile = editorView.activeFile;

  const isMonacoActive =
    activeFile &&
    (activeFile.renderer.kind === 'text' ||
      activeFile.renderer.kind === 'markdown-source' ||
      activeFile.renderer.kind === 'svg-source');

  if (openFiles.size === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <FileCode className="h-10 w-10 opacity-20" />
        <div className="text-center">
          <p className="text-sm font-medium opacity-50">No file open</p>
          <p className="mt-1 text-xs opacity-35">Select a file from the tree to open it here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <FileTabs
        tabs={tabs}
        openFiles={openFiles as unknown as Map<string, ManagedFile>}
        activeFilePath={activeFilePath}
        previewFilePath={previewFilePath}
        modelRootPath={modelRootPath}
        onTabClick={setActiveFile}
        onTabClose={handleCloseFile}
        onPinTab={pinFile}
      />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/* Stable Monaco host — always in DOM, shown/hidden by CSS only. Never re-parented. */}
        <div
          ref={setEditorHost}
          className="absolute inset-0"
          style={{ display: isMonacoActive ? 'flex' : 'none' }}
        />
        {/* Floating "Edit source" toggle for markdown/svg in Monaco source mode */}
        {isMonacoActive &&
          activeFile &&
          (activeFile.kind === 'markdown' || activeFile.kind === 'svg') && (
            <SourceToggleOverlay filePath={activeFile.path} kind={activeFile.kind} />
          )}
        {/* Non-Monaco renderers */}
        {!isMonacoActive && activeFile && <ActiveNonMonacoRenderer file={activeFile} />}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Floating "View rendered" toggle shown when editing markdown/svg source
// ---------------------------------------------------------------------------

interface SourceToggleOverlayProps {
  filePath: string;
  kind: 'markdown' | 'svg';
}

function SourceToggleOverlay({ filePath, kind }: SourceToggleOverlayProps) {
  const { updateRenderer } = useOpenedFile(filePath);
  const label = kind === 'markdown' ? 'View preview' : 'View rendered';
  const targetKind = kind === 'markdown' ? 'markdown' : 'svg';
  return (
    <button
      className="absolute right-3 top-3 z-10 rounded p-1 bg-background/80 hover:bg-accent text-muted-foreground hover:text-foreground"
      onClick={() => updateRenderer(() => ({ kind: targetKind }))}
      title={label}
      aria-label={label}
    >
      <Pencil className="h-3.5 w-3.5" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Non-Monaco renderer dispatcher
// ---------------------------------------------------------------------------

interface ActiveNonMonacoRendererProps {
  file: ManagedFile;
}

function ActiveNonMonacoRenderer({ file }: ActiveNonMonacoRendererProps) {
  switch (file.renderer.kind) {
    case 'markdown':
      return <MarkdownEditorRenderer filePath={file.path} />;
    case 'svg':
      return <SvgRenderer filePath={file.path} />;
    case 'image':
      return <ImageRenderer file={file} />;
    case 'too-large':
      return <TooLargeRenderer file={file} />;
    case 'binary':
      return <BinaryRenderer file={file} />;
    default:
      return null;
  }
}
