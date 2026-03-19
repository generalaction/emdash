import { FileCode } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { FileTabs } from '@renderer/components/FileExplorer/FileTabs';
import { MarkdownPreview } from '@renderer/components/FileExplorer/MarkdownPreview';
import { isMarkdownFile } from '@renderer/constants/file-explorer';
import { BinaryRenderer } from '@renderer/core/editor/binary-renderer';
import { ImageRenderer } from '@renderer/core/editor/image-renderer';
import { LoadingRenderer } from '@renderer/core/editor/loading-renderer';
import { SvgRenderer } from '@renderer/core/editor/svg-renderer';
import { TooLargeRenderer } from '@renderer/core/editor/too-large-renderer';
import { rpc } from '@renderer/core/ipc';
import { codeEditorPool } from '@renderer/core/monaco/monaco-code-pool';
import { addMonacoKeyboardShortcuts } from '@renderer/core/monaco/monaco-config';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import type { ManagedFile } from '@renderer/hooks/useFileManager';
import { buildMonacoModelPath } from '@renderer/lib/monacoModelPath';
import { useEditorContext } from './editor-provider';
import { useEditorViewContext } from './editor-view-provider';
import { PooledCodeEditor } from './pooled-code-editor';

const DIFF_CONSTANTS = {
  INITIAL_DELAY_MS: 100,
  REFRESH_INTERVAL_MS: 2000,
  DEBOUNCE_DELAY_MS: 500,
  CACHE_TTL_MS: 5000,
} as const;

interface DiffLine {
  lineNumber: number;
  type: 'add' | 'modify' | 'delete';
}

interface DiffCacheEntry {
  diff: DiffLine[];
  timestamp: number;
}

function useTaskEditorDiffDecorations({
  editorRef,
  filePath,
  projectId,
  taskId,
}: {
  editorRef: RefObject<any>;
  filePath: string;
  projectId: string;
  taskId: string;
}) {
  const decorationIdsRef = useRef<string[]>([]);
  const lastDiffRef = useRef<DiffLine[]>([]);
  const diffCacheRef = useRef<Map<string, DiffCacheEntry>>(new Map());

  const computeDiff = useCallback(async (): Promise<DiffLine[]> => {
    if (!filePath || !projectId || !taskId) return [];

    const cacheKey = `${projectId}:${taskId}:${filePath}`;
    const cached = diffCacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < DIFF_CONSTANTS.CACHE_TTL_MS) {
      return cached.diff;
    }

    try {
      const result = await rpc.git.getFileDiff(projectId, taskId, filePath);
      if (!result.success || !result.data?.diff?.lines) return [];

      const lines = result.data.diff.lines;
      const allAdded = lines.every((line) => line.type === 'add');
      const allContext = lines.every((line) => line.type === 'context');
      if (allAdded || allContext) return [];

      const diffLines: DiffLine[] = [];
      let currentLineNumber = 1;
      let pendingDelete = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const nextLine = lines[i + 1];

        if (line.type === 'add') {
          if (pendingDelete) {
            diffLines.push({ lineNumber: currentLineNumber, type: 'modify' });
            pendingDelete = false;
          } else {
            diffLines.push({ lineNumber: currentLineNumber, type: 'add' });
          }
          currentLineNumber++;
        } else if (line.type === 'del') {
          if (nextLine?.type === 'add') {
            pendingDelete = true;
          } else {
            pendingDelete = false;
          }
        } else if (line.type === 'context') {
          currentLineNumber++;
          pendingDelete = false;
        }
      }

      const uniqueDiffLines = Array.from(
        new Map(diffLines.map((item) => [`${item.lineNumber}-${item.type}`, item])).values()
      ).sort((a, b) => a.lineNumber - b.lineNumber);

      diffCacheRef.current.set(cacheKey, { diff: uniqueDiffLines, timestamp: Date.now() });
      return uniqueDiffLines;
    } catch {
      return [];
    }
  }, [filePath, projectId, taskId]);

  const applyDecorations = useCallback(
    (diffLines: DiffLine[]) => {
      const ed = editorRef.current;
      if (!ed?.getModel()) return;

      const newDecorations: any[] = diffLines.map((diff) => {
        const className =
          diff.type === 'add'
            ? 'diff-line-added'
            : diff.type === 'modify'
              ? 'diff-line-modified'
              : 'diff-line-deleted';
        const glyphMarginClassName =
          diff.type === 'add'
            ? 'diff-glyph-added'
            : diff.type === 'modify'
              ? 'diff-glyph-modified'
              : 'diff-glyph-deleted';
        return {
          range: {
            startLineNumber: diff.lineNumber,
            startColumn: 1,
            endLineNumber: diff.lineNumber,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            className,
            glyphMarginClassName,
          },
        };
      });

      try {
        decorationIdsRef.current = ed.deltaDecorations(decorationIdsRef.current, newDecorations);
      } catch {
        // ignore
      }
    },
    [editorRef]
  );

  const areDiffsEqual = (a: DiffLine[], b: DiffLine[]): boolean => {
    if (a.length !== b.length) return false;
    return a.every((item, i) => item.lineNumber === b[i].lineNumber && item.type === b[i].type);
  };

  const refreshDecorations = useCallback(
    async (invalidateCache = false) => {
      if (invalidateCache && filePath) {
        const cacheKey = `${projectId}:${taskId}:${filePath}`;
        diffCacheRef.current.delete(cacheKey);
      }
      const diffLines = await computeDiff();
      lastDiffRef.current = diffLines;
      applyDecorations(diffLines);
    },
    [filePath, projectId, taskId, computeDiff, applyDecorations]
  );

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !filePath) return;

    const updateDecorations = async () => {
      const diffLines = await computeDiff();
      if (!areDiffsEqual(diffLines, lastDiffRef.current)) {
        lastDiffRef.current = diffLines;
        applyDecorations(diffLines);
      }
    };

    const initialTimer = setTimeout(updateDecorations, DIFF_CONSTANTS.INITIAL_DELAY_MS);
    const interval = setInterval(updateDecorations, DIFF_CONSTANTS.REFRESH_INTERVAL_MS);

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const disposable = ed.onDidChangeModelContent?.(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updateDecorations, DIFF_CONSTANTS.DEBOUNCE_DELAY_MS);
    });

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
      if (debounceTimer) clearTimeout(debounceTimer);
      disposable?.dispose();
      if (ed && !ed.isDisposed?.()) {
        try {
          ed.deltaDecorations(decorationIdsRef.current, []);
        } catch {
          // ignore
        }
      }
      decorationIdsRef.current = [];
    };
  }, [editorRef, filePath, computeDiff, applyDecorations]);

  // Periodic cache cleanup
  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const cache = diffCacheRef.current;
      for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > DIFF_CONSTANTS.CACHE_TTL_MS) {
          cache.delete(key);
        }
      }
    }, DIFF_CONSTANTS.CACHE_TTL_MS * 2);
    return () => clearInterval(cleanupInterval);
  }, []);

  return { refreshDecorations };
}

export function EditorMainPanel() {
  const {
    projectId,
    taskId,
    modelRootPath,
    openFiles,
    activeFilePath,
    activeFile,
    isSaving,
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
  const prevIsSaving = useRef(false);

  const { refreshDecorations } = useTaskEditorDiffDecorations({
    editorRef,
    filePath: activeFilePath ?? '',
    projectId,
    taskId,
  });

  // Re-apply decorations after active file changes
  useEffect(() => {
    if (editorReady && editorRef.current && activeFilePath && refreshDecorations) {
      const timer = setTimeout(() => {
        void refreshDecorations();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [activeFilePath, editorReady, refreshDecorations, activeFile?.isDirty]);

  // Re-apply decorations after save completes
  useEffect(() => {
    if (prevIsSaving.current && !isSaving && editorReady && refreshDecorations) {
      if (editorRef.current) {
        void refreshDecorations(true);
      }
      const timer = setTimeout(() => {
        void refreshDecorations(true);
      }, 800);
      prevIsSaving.current = false;
      return () => clearTimeout(timer);
    }
    prevIsSaving.current = isSaving;
  }, [isSaving, editorReady, refreshDecorations]);

  // Stable refs so the Monaco keyboard command (registered once at lease time)
  // always calls the latest version of each function without a stale closure.
  const saveFileRef = useRef(saveFile);
  const saveAllFilesRef = useRef(saveAllFiles);
  const refreshDecorationsRef = useRef(refreshDecorations);
  useEffect(() => {
    saveFileRef.current = saveFile;
    saveAllFilesRef.current = saveAllFiles;
    refreshDecorationsRef.current = refreshDecorations;
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
        onSave: async () => {
          await saveFileRef.current();
          setTimeout(() => void refreshDecorationsRef.current?.(true), 700);
        },
        onSaveAll: () => void saveAllFilesRef.current(),
      });

      setEditorReady(true);
      setTimeout(() => void refreshDecorationsRef.current?.(), 100);
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
      (isMarkdownFile(activeFilePath) || activeFile?.kind === 'svg'))
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
        projectId={projectId}
        taskId={taskId}
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
  projectId: string;
  taskId: string;
  handleEditorChange: (value: string) => void;
  handleEditorMount: (editor: any, monaco: any) => void;
}

function ActiveFileRenderer({
  file,
  isPreviewActive,
  previewContent,
  modelRootPath,
  projectId,
  taskId,
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
          projectId={projectId}
          taskId={taskId}
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
  projectId: string;
  taskId: string;
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
  projectId,
  taskId,
}: CodeEditorSectionProps) {
  if (isPreviewActive) {
    if (file.kind === 'svg') {
      // Pass the live model content as `content` so SvgRenderer always shows
      // the latest edits (previewContent comes from the Monaco buffer model).
      return <SvgRenderer file={{ ...file, content: previewContent }} />;
    }
    if (isMarkdownFile(file.path)) {
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

  return (
    <PooledCodeEditor
      activeFile={file}
      modelRootPath={modelRootPath}
      projectId={projectId}
      taskId={taskId}
      glyphMargin={true}
      onEditorChange={onEditorChange}
      onMount={onMount}
    />
  );
}
