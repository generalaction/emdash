import { FileCode } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkdownPreview } from '@renderer/components/FileExplorer/MarkdownPreview';
import { BinaryRenderer } from '@renderer/core/editor/binary-renderer';
import { ImageRenderer } from '@renderer/core/editor/image-renderer';
import { LoadingRenderer } from '@renderer/core/editor/loading-renderer';
import { SvgRenderer } from '@renderer/core/editor/svg-renderer';
import { TooLargeRenderer } from '@renderer/core/editor/too-large-renderer';
import type { ManagedFile } from '@renderer/core/editor/types';
import { useDiffDecorations } from '@renderer/core/editor/use-diff-decorations';
import { isMarkdownPath } from '@renderer/core/editor/utils';
import { codeEditorPool } from '@renderer/core/monaco/monaco-code-pool';
import { addMonacoKeyboardShortcuts } from '@renderer/core/monaco/monaco-config';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monacoModelPath';
import { FileTabs } from '@renderer/views/tasks/editor/file-tabs';
import { useEditorContext } from './editor-provider';
import { useEditorViewContext } from './editor-view-provider';
import { PooledCodeEditor } from './pooled-code-editor';

export function EditorMainPanel() {
  const {
    modelRootPath,
    openFiles,
    activeFilePath,
    activeFile,
    previewFilePath,
    handleCloseFile,
    setActiveFile,
    pinFile,
    saveFile,
    saveAllFiles,
    markDirty,
  } = useEditorContext();

  const { previewMode, togglePreview } = useEditorViewContext();

  const editorRef = useRef<any>(null);
  const [editorReady, setEditorReady] = useState(false);

  const bufferUri =
    editorReady && activeFilePath ? buildMonacoModelPath(modelRootPath, activeFilePath) : '';

  useDiffDecorations(editorRef, bufferUri);

  // Stable refs so the Monaco keyboard command (registered once at lease time)
  // always calls the latest version of each function without a stale closure.
  const saveFileRef = useRef(saveFile);
  const saveAllFilesRef = useRef(saveAllFiles);
  useEffect(() => {
    saveFileRef.current = saveFile;
    saveAllFilesRef.current = saveAllFiles;
  });

  // Pre-warm the code editor pool (loads Monaco, registers themes, creates idle instance).
  useEffect(() => {
    codeEditorPool
      .init()
      .catch((err: unknown) => console.warn('[monaco-code-pool] init failed:', err));
  }, []);

  const handleEditorMount = useCallback(
    (editor: any, monaco: any) => {
      editorRef.current = editor;

      addMonacoKeyboardShortcuts(editor, monaco, {
        onSave: () => void saveFileRef.current(),
        onSaveAll: () => void saveAllFilesRef.current(),
      });

      setEditorReady(true);
    },
    [] // no deps — all functions accessed via always-current refs above
  );

  const handleEditorChange = useCallback(
    (_value: string) => {
      if (!activeFilePath) return;
      markDirty(activeFilePath);
    },
    [activeFilePath, markDirty]
  );

  // Default preview mode: markdown and SVG default to rendered view.
  const isPreviewActive = activeFilePath
    ? (previewMode.get(activeFilePath) ??
      (isMarkdownPath(activeFilePath) || activeFile?.kind === 'svg'))
    : false;

  // For markdown/SVG preview, get live content from the registry model (source of truth).
  const previewContent = activeFile
    ? (modelRegistry.getValue(buildMonacoModelPath(modelRootPath, activeFile.path)) ??
      activeFile.content)
    : '';

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
        openFiles={openFiles}
        activeFilePath={activeFilePath}
        previewFilePath={previewFilePath}
        onTabClick={setActiveFile}
        onTabClose={handleCloseFile}
        onPinTab={pinFile}
        previewMode={previewMode}
        onTogglePreview={togglePreview}
      />
      <ActiveFileRenderer
        file={activeFile}
        isPreviewActive={isPreviewActive}
        previewContent={previewContent}
        modelRootPath={modelRootPath}
        handleEditorChange={handleEditorChange}
        handleEditorMount={handleEditorMount}
      />
    </div>
  );
}

interface ActiveFileRendererProps {
  file: ManagedFile | null;
  isPreviewActive: boolean;
  previewContent: string;
  modelRootPath: string;
  handleEditorChange: (value: string) => void;
  handleEditorMount: (editor: any, monaco: any) => void;
}

function ActiveFileRenderer({
  file,
  isPreviewActive,
  previewContent,
  modelRootPath,
  handleEditorChange,
  handleEditorMount,
}: ActiveFileRendererProps) {
  if (!file) return null;

  // Loading state is orthogonal to kind — check it first.
  if (file.isLoading) {
    return <LoadingRenderer />;
  }

  switch (file.kind) {
    case 'text':
    case 'svg':
      return (
        <CodeEditorSection
          file={file}
          isPreviewActive={isPreviewActive}
          previewContent={previewContent}
          modelRootPath={modelRootPath}
          onEditorChange={handleEditorChange}
          onMount={handleEditorMount}
        />
      );
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

interface CodeEditorSectionProps {
  file: ManagedFile;
  isPreviewActive: boolean;
  previewContent: string;
  modelRootPath: string;
  onEditorChange: (value: string) => void;
  onMount: (editor: any, monaco: any) => void;
}

function CodeEditorSection({
  file,
  isPreviewActive,
  previewContent,
  modelRootPath,
  onEditorChange,
  onMount,
}: CodeEditorSectionProps) {
  if (isPreviewActive) {
    if (file.kind === 'svg') {
      // Pass the live model content as `content` so SvgRenderer always shows
      // the latest edits (previewContent comes from the Monaco buffer model).
      return <SvgRenderer file={{ ...file, content: previewContent }} />;
    }
    if (isMarkdownPath(file.path)) {
      return (
        <MarkdownPreview
          content={previewContent}
          rootPath={modelRootPath}
          fileDir={
            file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : ''
          }
        />
      );
    }
  }

  const bufferUri = buildMonacoModelPath(modelRootPath, file.path);
  return (
    <PooledCodeEditor
      bufferUri={bufferUri}
      glyphMargin={true}
      onEditorChange={onEditorChange}
      onMount={onMount}
    />
  );
}
