import { DiffEditor, loader } from '@monaco-editor/react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type * as monaco from 'monaco-editor';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitChange } from '@shared/git';
import { DiffToolbar } from '@renderer/components/diff-viewer/DiffToolbar';
import { DIFF_EDITOR_BASE_OPTIONS } from '@renderer/components/diff-viewer/editorConfig';
import { Checkbox } from '@renderer/components/ui/checkbox';
import { rpc } from '@renderer/core/ipc';
import { useDiffEditorComments } from '@renderer/hooks/useDiffEditorComments';
import { useTheme } from '@renderer/hooks/useTheme';
import { registerActiveCodeEditor } from '@renderer/lib/activeCodeEditor';
import {
  convertDiffLinesToMonacoFormat,
  getMonacoLanguageId,
  isBinaryFile,
} from '@renderer/lib/diffUtils';
import { dispatchFileChangeEvent } from '@renderer/lib/fileChangeEvents';
import {
  configureDiffEditorDiagnostics,
  resetDiagnosticOptions,
} from '@renderer/lib/monacoDiffConfig';
import { getDiffThemeName, registerDiffThemes } from '@renderer/lib/monacoDiffThemes';
import { useDiffViewContext } from './diff-view-provider';

function extractErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return 'Unknown error';
}

// ---------------------------------------------------------------------------
// DiffEditorStyles — injects Monaco diff panel CSS once
// ---------------------------------------------------------------------------

function DiffEditorStyles({ isDark }: { isDark: boolean }) {
  useEffect(() => {
    const styleId = 'diff-panel-styles';
    let style = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }
    style.textContent = `
      .monaco-diff-editor .diffViewport { padding-left: 0 !important; }
      .monaco-diff-editor .line-numbers { text-align: right !important; padding-right: 12px !important; padding-left: 4px !important; min-width: 40px !important; }
      .monaco-diff-editor .monaco-editor .margin { padding-right: 8px !important; }
      .monaco-diff-editor .original .line-numbers { display: none !important; }
      .monaco-diff-editor .original .margin { display: none !important; }
      .monaco-diff-editor .monaco-editor .overview-ruler { width: 3px !important; }
      .monaco-diff-editor .margin-view-overlays .line-insert,
      .monaco-diff-editor .margin-view-overlays .line-delete,
      .monaco-diff-editor .margin-view-overlays .codicon-add,
      .monaco-diff-editor .margin-view-overlays .codicon-remove,
      .monaco-diff-editor .margin-view-overlays .codicon-diff-added,
      .monaco-diff-editor .margin-view-overlays .codicon-diff-removed { display: none !important; visibility: hidden !important; opacity: 0 !important; }
      .monaco-diff-editor .modified .margin-view-overlays { border-right: 1px solid ${isDark ? 'rgba(156,163,175,0.2)' : 'rgba(107,114,128,0.2)'} !important; }
      .monaco-diff-editor .monaco-editor .margin { border-right: 1px solid ${isDark ? 'rgba(156,163,175,0.2)' : 'rgba(107,114,128,0.2)'} !important; }
      .monaco-diff-editor .diffViewport { display: none !important; }
      .monaco-diff-editor .monaco-scrollable-element { box-shadow: none !important; }
      .monaco-diff-editor .overflow-guard { box-shadow: none !important; }
      .comment-hover-icon { display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; margin: 1px auto; border-radius: 6px; border: 1px solid transparent; background: transparent; cursor: pointer; pointer-events: auto; transition: background-color 0.15s ease, border-color 0.15s ease; }
      .comment-hover-icon::before { content: ''; display: block; width: 12px; height: 12px; background-color: hsl(var(--muted-foreground)); mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cline x1='12' y1='5' x2='12' y2='19'%3E%3C/line%3E%3Cline x1='5' y1='12' x2='19' y2='12'%3E%3C/line%3E%3C/svg%3E"); mask-size: contain; mask-repeat: no-repeat; mask-position: center; }
      .comment-hover-icon:hover, .comment-hover-icon.comment-hover-icon-pinned { background-color: hsl(var(--foreground) / 0.08); border-color: hsl(var(--border)); }
      .comment-hover-icon:hover::before, .comment-hover-icon.comment-hover-icon-pinned::before { background-color: hsl(var(--foreground)); }
      .monaco-editor .glyph-margin > div { border: none !important; outline: none !important; box-shadow: none !important; }
      .monaco-diff-editor .margin-view-overlays .cgmr,
      .monaco-diff-editor .margin-view-overlays .codicon,
      .monaco-diff-editor .glyph-margin-widgets .codicon,
      .monaco-diff-editor .line-decorations .codicon,
      .monaco-diff-editor .margin-view-overlays [class*="codicon-"] { border: none !important; outline: none !important; box-shadow: none !important; }
      .monaco-diff-editor .dirty-diff-deleted-indicator,
      .monaco-diff-editor .dirty-diff-modified-indicator,
      .monaco-diff-editor .dirty-diff-added-indicator { border: none !important; box-shadow: none !important; }
      .monaco-diff-editor .glyph-margin .codicon-arrow-left,
      .monaco-diff-editor .glyph-margin .codicon-discard { display: none !important; }
      .monaco-editor .view-zones { pointer-events: auto !important; }
      .monaco-editor .view-zone { pointer-events: auto !important; }
    `;
  }, [isDark]);

  return null;
}

// ---------------------------------------------------------------------------
// useMonacoTheme — registers diff themes and applies the current one
// ---------------------------------------------------------------------------

function useMonacoTheme() {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';

  useEffect(() => {
    let cancelled = false;
    registerDiffThemes()
      .then(async () => {
        if (!cancelled) {
          const monacoInstance = await loader.init();
          monacoInstance.editor.setTheme(getDiffThemeName(effectiveTheme));
        }
      })
      .catch((err: unknown) => console.warn('Failed to register diff themes:', err));
    return () => {
      cancelled = true;
    };
  }, [effectiveTheme]);

  return { isDark, monacoTheme: getDiffThemeName(effectiveTheme) };
}

// ---------------------------------------------------------------------------
// FileDiffEditor — Monaco diff for a working-tree file
// ---------------------------------------------------------------------------

interface FileDiffEditorProps {
  projectId: string;
  taskId: string;
  filePath: string;
  diffStyle: 'unified' | 'split';
  onRefreshChanges?: () => void;
  onContentHeightChange?: (height: number) => void;
}

function FileDiffEditor({
  projectId,
  taskId,
  filePath,
  diffStyle,
  onRefreshChanges,
  onContentHeightChange,
}: FileDiffEditorProps) {
  const { monacoTheme } = useMonacoTheme();

  const [fileData, setFileData] = useState<{
    original: string;
    modified: string;
    initialModified: string;
    language: string;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [modifiedDraft, setModifiedDraft] = useState('');

  const [editorInstance, setEditorInstance] = useState<monaco.editor.IStandaloneDiffEditor | null>(
    null
  );
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const changeDisposableRef = useRef<monaco.IDisposable | null>(null);
  const contentSizeDisposableRef = useRef<monaco.IDisposable | null>(null);
  const activeEditorCleanupRef = useRef<(() => void) | null>(null);
  const handleSaveRef = useRef<() => void>(() => {});
  const onContentHeightChangeRef = useRef(onContentHeightChange);
  onContentHeightChangeRef.current = onContentHeightChange;

  useDiffEditorComments({ editor: editorInstance, taskId, filePath });

  // Load file data
  useEffect(() => {
    if (!filePath) {
      setFileData(null);
      setModifiedDraft('');
      return;
    }

    if (isBinaryFile(filePath)) {
      setFileData({
        original: '',
        modified: '',
        initialModified: '',
        language: 'plaintext',
        loading: false,
        error: 'Binary file — diff not available',
      });
      setModifiedDraft('');
      return;
    }

    let cancelled = false;
    const language = getMonacoLanguageId(filePath);

    setFileData({
      original: '',
      modified: '',
      initialModified: '',
      language,
      loading: true,
      error: null,
    });
    setModifiedDraft('');

    const load = async () => {
      try {
        const diffRes = await rpc.git.getFileDiff(projectId, taskId, filePath);
        if (!diffRes.success) {
          throw new Error(extractErrorMessage(diffRes.error));
        }
        if (!diffRes.data?.diff) {
          throw new Error('Failed to load diff');
        }

        const diffLines = diffRes.data.diff.lines;
        const converted = convertDiffLinesToMonacoFormat(diffLines);
        const originalContent = diffRes.data.diff.originalContent ?? converted.original;
        let modifiedContent = diffRes.data.diff.modifiedContent ?? converted.modified;

        // Re-read from disk to get the most up-to-date content
        try {
          const readRes = await rpc.fs.readFile(projectId, taskId, filePath, 2 * 1024 * 1024);
          if (
            readRes?.success &&
            readRes.data?.content !== undefined &&
            readRes.data?.content !== null
          ) {
            modifiedContent = (readRes.data.content as string).replace(/\n$/, '');
          }
        } catch {
          // fallback to diff-based content
        }

        if (!cancelled) {
          setFileData({
            original: originalContent,
            modified: modifiedContent,
            initialModified: modifiedContent,
            language,
            loading: false,
            error: null,
          });
          setModifiedDraft(modifiedContent);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setFileData({
            original: '',
            modified: '',
            initialModified: '',
            language,
            loading: false,
            error: (error as Error)?.message ?? String(error),
          });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId, filePath]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!filePath || !fileData) return;
    try {
      const content = modifiedDraft.endsWith('\n') ? modifiedDraft : modifiedDraft + '\n';
      const res = await rpc.fs.writeFile(projectId, taskId, filePath, content);
      if (!res.success) {
        throw new Error(extractErrorMessage(res.error));
      }
      setFileData((prev) =>
        prev ? { ...prev, modified: modifiedDraft, initialModified: modifiedDraft } : prev
      );
      // Dispatch a file change event so other parts of the UI can react
      // We don't have taskPath here, so we use projectId/taskId as the key
      dispatchFileChangeEvent(projectId, filePath);
      onRefreshChanges?.();
    } catch (error: unknown) {
      console.error('Save failed:', error instanceof Error ? error.message : String(error));
    }
  }, [projectId, taskId, filePath, fileData, modifiedDraft, onRefreshChanges]);

  useEffect(() => {
    handleSaveRef.current = handleSave;
  });

  // Editor mount handler
  const handleEditorDidMount = async (editor: monaco.editor.IStandaloneDiffEditor) => {
    editorRef.current = editor;
    setEditorInstance(editor);

    try {
      activeEditorCleanupRef.current?.();
    } catch {
      // ignore
    }
    activeEditorCleanupRef.current = registerActiveCodeEditor(editor.getModifiedEditor());

    try {
      const monacoInstance = await loader.init();
      editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
        handleSaveRef.current();
      });
      configureDiffEditorDiagnostics(editor, monacoInstance, {
        disableAllValidation: true,
        suppressSpecificErrors: false,
      });
    } catch (error) {
      console.warn('Failed to configure editor:', error);
    }

    try {
      const modifiedEditor = editor.getModifiedEditor();
      changeDisposableRef.current?.dispose();
      changeDisposableRef.current = modifiedEditor.onDidChangeModelContent(() => {
        const value = modifiedEditor.getValue() ?? '';
        setModifiedDraft(value);
      });
    } catch {
      // best effort
    }

    try {
      const modifiedEditor = editor.getModifiedEditor();
      const reportHeight = () => {
        const h = modifiedEditor.getContentHeight();
        onContentHeightChangeRef.current?.(h);
      };
      reportHeight();
      contentSizeDisposableRef.current?.dispose();
      contentSizeDisposableRef.current = modifiedEditor.onDidContentSizeChange(() => {
        reportHeight();
      });
    } catch {
      // best effort
    }
  };

  // Cleanup
  useEffect(() => {
    return () => {
      try {
        editorRef.current?.dispose();
      } catch {
        /* ignore */
      }
      editorRef.current = null;
      try {
        changeDisposableRef.current?.dispose();
      } catch {
        /* ignore */
      }
      changeDisposableRef.current = null;
      try {
        contentSizeDisposableRef.current?.dispose();
      } catch {
        /* ignore */
      }
      contentSizeDisposableRef.current = null;
      try {
        activeEditorCleanupRef.current?.();
      } catch {
        /* ignore */
      }
      activeEditorCleanupRef.current = null;
      loader
        .init()
        .then((m) => resetDiagnosticOptions(m))
        .catch(() => {});
    };
  }, []);

  if (!fileData) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No file selected
      </div>
    );
  }

  if (fileData.loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-gray-600 dark:border-border dark:border-t-gray-400" />
          <span className="text-sm">Loading diff...</span>
        </div>
      </div>
    );
  }

  if (fileData.error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {fileData.error}
      </div>
    );
  }

  return (
    <div className="h-full">
      <DiffEditor
        height="100%"
        language={fileData.language}
        original={fileData.original}
        modified={modifiedDraft}
        theme={monacoTheme}
        options={{
          ...DIFF_EDITOR_BASE_OPTIONS,
          readOnly: false,
          renderSideBySide: diffStyle === 'split',
          glyphMargin: true,
          lineDecorationsWidth: 16,
        }}
        onMount={handleEditorDidMount}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommitFileDiffEditor — Monaco diff for a historical commit file
// ---------------------------------------------------------------------------

interface CommitFileDiffEditorProps {
  projectId: string;
  taskId: string;
  commitHash: string;
  filePath: string;
  diffStyle: 'unified' | 'split';
}

function CommitFileDiffEditor({
  projectId,
  taskId,
  commitHash,
  filePath,
  diffStyle,
}: CommitFileDiffEditorProps) {
  const { monacoTheme } = useMonacoTheme();
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  const [data, setData] = useState<{
    original: string;
    modified: string;
    language: string;
    loading: boolean;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!commitHash || !filePath) {
      setData(null);
      return;
    }

    let cancelled = false;
    const language = getMonacoLanguageId(filePath);
    setData({ original: '', modified: '', language, loading: true, error: null });

    const load = async () => {
      try {
        const res = await rpc.git.getCommitFileDiff(projectId, taskId, commitHash, filePath);
        if (!res.success) {
          throw new Error(extractErrorMessage(res.error));
        }
        if (!res.data?.diff) {
          throw new Error('Failed to load commit diff');
        }
        const converted = convertDiffLinesToMonacoFormat(res.data.diff.lines);
        const original = res.data.diff.originalContent ?? converted.original;
        const modified = res.data.diff.modifiedContent ?? converted.modified;
        if (!cancelled) {
          setData({ original, modified, language, loading: false, error: null });
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setData({
            original: '',
            modified: '',
            language,
            loading: false,
            error: (error as Error)?.message ?? String(error),
          });
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId, commitHash, filePath]);

  const handleEditorDidMount = async (editor: monaco.editor.IStandaloneDiffEditor) => {
    editorRef.current = editor;
    try {
      const monacoInstance = await loader.init();
      configureDiffEditorDiagnostics(editor, monacoInstance, {
        disableAllValidation: true,
        suppressSpecificErrors: false,
      });
    } catch (error) {
      console.warn('Failed to configure editor:', error);
    }
  };

  useEffect(() => {
    return () => {
      try {
        editorRef.current?.dispose();
      } catch {
        /* ignore */
      }
      editorRef.current = null;
      loader
        .init()
        .then((m) => resetDiagnosticOptions(m))
        .catch(() => {});
    };
  }, []);

  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No file selected
      </div>
    );
  }

  if (data.loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-gray-600 dark:border-border dark:border-t-gray-400" />
          <span className="text-sm">Loading diff...</span>
        </div>
      </div>
    );
  }

  if (data.error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {data.error}
      </div>
    );
  }

  if (!data.original && !data.modified) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        File is empty
      </div>
    );
  }

  return (
    <div className="h-full">
      <DiffEditor
        height="100%"
        language={data.language}
        original={data.original}
        modified={data.modified}
        theme={monacoTheme}
        options={{
          ...DIFF_EDITOR_BASE_OPTIONS,
          readOnly: true,
          renderSideBySide: diffStyle === 'split',
          glyphMargin: false,
        }}
        onMount={handleEditorDidMount}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// StackedFileSection — one collapsed/expanded file in stacked view
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// StackedDiffPanel — all files stacked
// ---------------------------------------------------------------------------

function StackedDiffPanel() {
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

// ---------------------------------------------------------------------------
// ChangesMainPanel — diff for current working-tree changes
// ---------------------------------------------------------------------------

function splitPath(filePath: string) {
  const parts = filePath.split('/');
  const filename = parts.pop() || filePath;
  const directory = parts.length > 0 ? parts.join('/') + '/' : '';
  return { filename, directory };
}

function ChangesMainPanel() {
  const {
    projectId,
    taskId,
    viewMode,
    setViewMode,
    diffStyle,
    setDiffStyle,
    selectedFile,
    fileChanges,
    refreshChanges,
  } = useDiffViewContext();

  const prevSelectedFileRef = useRef(selectedFile);
  useEffect(() => {
    if (selectedFile && selectedFile !== prevSelectedFileRef.current && viewMode === 'stacked') {
      setViewMode('file');
    }
    prevSelectedFileRef.current = selectedFile;
  }, [selectedFile, viewMode, setViewMode]);

  const fileChange = fileChanges.find((f) => f.path === selectedFile);

  return (
    <div className="flex h-full flex-col">
      <DiffToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
      />
      {viewMode === 'file' &&
        selectedFile &&
        (() => {
          const { filename, directory } = splitPath(selectedFile);
          return (
            <div className="flex h-9 items-center gap-2 border-b border-border bg-muted/30 px-3 text-xs">
              <span className="truncate font-medium">{filename}</span>
              {directory && <span className="truncate text-muted-foreground">{directory}</span>}
              {fileChange && (
                <span className="ml-auto shrink-0">
                  <span className="text-green-500">+{fileChange.additions}</span>{' '}
                  <span className="text-red-500">-{fileChange.deletions}</span>
                </span>
              )}
            </div>
          );
        })()}
      <div className="min-h-0 flex-1 overflow-hidden">
        {viewMode === 'stacked' ? (
          <StackedDiffPanel />
        ) : selectedFile ? (
          <FileDiffEditor
            projectId={projectId}
            taskId={taskId}
            filePath={selectedFile}
            diffStyle={diffStyle}
            onRefreshChanges={refreshChanges}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a file to view changes
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HistoryMainPanel — diff for a selected commit file
// ---------------------------------------------------------------------------

function HistoryMainPanel() {
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

// ---------------------------------------------------------------------------
// DiffViewMainPanel — main export
// ---------------------------------------------------------------------------

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
