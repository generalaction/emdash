import { loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useEffect, useRef, useState } from 'react';
import { rpc } from '@renderer/core/ipc';
import { convertDiffLinesToMonacoFormat, getMonacoLanguageId } from '@renderer/lib/diffUtils';
import {
  configureDiffEditorDiagnostics,
  resetDiagnosticOptions,
} from '@renderer/lib/monacoDiffConfig';
import { MonacoDiffView } from './monaco-diff-view';
import { extractErrorMessage } from './utils';

interface CommitFileDiffEditorProps {
  projectId: string;
  taskId: string;
  commitHash: string;
  filePath: string;
  diffStyle: 'unified' | 'split';
}

export function CommitFileDiffEditor({
  projectId,
  taskId,
  commitHash,
  filePath,
  diffStyle,
}: CommitFileDiffEditorProps) {
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

  const handleEditorDidMount = async (
    editor: monaco.editor.IStandaloneDiffEditor,
    monacoInstance: typeof monaco
  ) => {
    editorRef.current = editor;
    try {
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
    <MonacoDiffView
      original={data.original}
      modified={data.modified}
      language={data.language}
      diffStyle={diffStyle}
      readOnly={true}
      glyphMargin={false}
      onMount={handleEditorDidMount}
    />
  );
}
