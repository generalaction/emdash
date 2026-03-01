import React, { useEffect, useRef, useState } from 'react';
import { DiffEditor, loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import type { DiffLine } from '../../hooks/useFileDiff';
import {
  convertDiffLinesToMonacoFormat,
  getMonacoLanguageId,
  isBinaryFile,
} from '../../lib/diffUtils';
import { configureDiffEditorDiagnostics, resetDiagnosticOptions } from '../../lib/monacoDiffConfig';
import { registerDiffThemes, getDiffThemeName } from '../../lib/monacoDiffThemes';
import { DIFF_EDITOR_BASE_OPTIONS } from './editorConfig';
import { dispatchFileChangeEvent } from '../../lib/fileChangeEvents';
import { useDiffEditorComments } from '../../hooks/useDiffEditorComments';
import { useTheme } from '../../hooks/useTheme';
import { registerActiveCodeEditor } from '../../lib/activeCodeEditor';

interface FileDiffViewProps {
  taskPath?: string;
  taskId?: string;
  filePath: string;
  diffStyle: 'unified' | 'split';
  onRefreshChanges?: () => Promise<void> | void;
  onContentHeightChange?: (height: number) => void;
}

export const FileDiffView: React.FC<FileDiffViewProps> = ({
  taskPath,
  taskId,
  filePath,
  diffStyle,
  onRefreshChanges,
  onContentHeightChange,
}) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';

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

  // Comment integration
  useDiffEditorComments({
    editor: editorInstance,
    taskId: taskId ?? '',
    filePath,
  });

  // Load file data
  useEffect(() => {
    if (!taskPath || !filePath) {
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
        const diffRes = await window.electronAPI.getFileDiff({
          taskPath,
          filePath,
        });
        if (!diffRes?.success || !diffRes.diff) {
          throw new Error(diffRes?.error || 'Failed to load diff');
        }

        const diffLines: DiffLine[] = diffRes.diff.lines;
        const converted = convertDiffLinesToMonacoFormat(diffLines);
        let originalContent = converted.original;
        let modifiedContent = converted.modified;

        // For non-deleted files, try reading actual current content
        try {
          const readRes = await window.electronAPI.fsRead(taskPath, filePath, 2 * 1024 * 1024);
          if (readRes?.success && readRes.content) {
            modifiedContent = readRes.content.replace(/\n$/, '');
          }
        } catch {
          // fallback to diff-based content
        }

        // For deleted files, modified should be empty
        if (diffLines.every((l) => l.type === 'del' || l.type === 'context')) {
          const hasAdds = diffLines.some((l) => l.type === 'add');
          if (!hasAdds) {
            modifiedContent = '';
          }
        }

        // For added files, original should be empty
        // Only treat as new file if there are no context lines and no deletions
        const hasDels = diffLines.some((l) => l.type === 'del');
        const hasContext = diffLines.some((l) => l.type === 'context');
        if (!hasDels && !hasContext && diffLines.some((l) => l.type === 'add')) {
          originalContent = '';
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

    load();
    return () => {
      cancelled = true;
    };
  }, [taskPath, filePath]);

  // Inject diff panel styles (always update content so theme-dependent colors refresh)
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

  // Register and apply Monaco diff themes
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

  // Save handler
  const handleSave = async () => {
    if (!taskPath || !filePath || !fileData) return;
    try {
      // Ensure trailing newline (Monaco strips it, but POSIX files should end with one)
      const content = modifiedDraft.endsWith('\n') ? modifiedDraft : modifiedDraft + '\n';
      const res = await window.electronAPI.fsWriteFile(taskPath, filePath, content, true);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to save file');
      }
      setFileData((prev) =>
        prev ? { ...prev, modified: modifiedDraft, initialModified: modifiedDraft } : prev
      );
      dispatchFileChangeEvent(taskPath, filePath);
      if (onRefreshChanges) {
        await onRefreshChanges();
      }
    } catch (error: unknown) {
      console.error('Save failed:', error instanceof Error ? error.message : String(error));
    }
  };

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

    // Report content height changes for stacked view dynamic sizing
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
        // ignore
      }
      editorRef.current = null;
      try {
        changeDisposableRef.current?.dispose();
      } catch {
        // ignore
      }
      changeDisposableRef.current = null;
      try {
        contentSizeDisposableRef.current?.dispose();
      } catch {
        // ignore
      }
      contentSizeDisposableRef.current = null;
      try {
        activeEditorCleanupRef.current?.();
      } catch {
        // ignore
      }
      activeEditorCleanupRef.current = null;

      loader
        .init()
        .then((m) => resetDiagnosticOptions(m))
        .catch(() => {});
    };
  }, []);

  const monacoTheme = getDiffThemeName(effectiveTheme);

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
};
