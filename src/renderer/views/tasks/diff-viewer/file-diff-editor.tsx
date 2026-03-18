import { loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useCallback, useEffect, useRef, useState } from 'react';
import { rpc } from '@renderer/core/ipc';
import { useDiffEditorComments } from '@renderer/hooks/useDiffEditorComments';
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
import { MonacoDiffView } from './monaco-diff-view';
import { extractErrorMessage } from './utils';

interface FileDiffEditorProps {
  projectId: string;
  taskId: string;
  filePath: string;
  diffStyle: 'unified' | 'split';
  onRefreshChanges?: () => void;
  onContentHeightChange?: (height: number) => void;
}

export function FileDiffEditor({
  projectId,
  taskId,
  filePath,
  diffStyle,
  onRefreshChanges,
  onContentHeightChange,
}: FileDiffEditorProps) {
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

  // Editor mount handler — receives both the editor and the initialized Monaco instance
  const handleEditorDidMount = async (
    editor: monaco.editor.IStandaloneDiffEditor,
    monacoInstance: typeof monaco
  ) => {
    editorRef.current = editor;
    setEditorInstance(editor);

    try {
      activeEditorCleanupRef.current?.();
    } catch {
      // ignore
    }
    activeEditorCleanupRef.current = registerActiveCodeEditor(editor.getModifiedEditor());

    try {
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
    <MonacoDiffView
      original={fileData.original}
      modified={modifiedDraft}
      language={fileData.language}
      diffStyle={diffStyle}
      readOnly={false}
      glyphMargin={true}
      lineDecorationsWidth={16}
      onMount={handleEditorDidMount}
    />
  );
}
