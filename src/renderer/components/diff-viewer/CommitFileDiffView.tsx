import React, { useEffect, useRef, useState } from 'react';
import { DiffEditor, loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import type { DiffWarning } from '@shared/diff/types';
import { convertDiffLinesToMonacoFormat, getMonacoLanguageId } from '../../lib/diffUtils';
import { configureDiffEditorDiagnostics, resetDiagnosticOptions } from '../../lib/monacoDiffConfig';
import { registerDiffThemes, getDiffThemeName } from '../../lib/monacoDiffThemes';
import { DIFF_EDITOR_BASE_OPTIONS } from './editorConfig';
import { useTheme } from '../../hooks/useTheme';
import { DiffWarnings } from './DiffWarnings';

function modeToMessage(mode: 'binary' | 'largeText' | 'unrenderable'): string {
  if (mode === 'binary') return 'Binary file - diff preview is not available';
  if (mode === 'largeText') return 'Diff is too large to render';
  return 'Diff could not be rendered';
}

interface CommitFileDiffViewProps {
  taskPath?: string;
  commitHash: string;
  filePath: string;
  diffStyle: 'unified' | 'split';
}

export const CommitFileDiffView: React.FC<CommitFileDiffViewProps> = ({
  taskPath,
  commitHash,
  filePath,
  diffStyle,
}) => {
  const { effectiveTheme } = useTheme();

  const [data, setData] = useState<{
    original: string;
    modified: string;
    language: string;
    mode?: 'text' | 'binary' | 'largeText' | 'unrenderable';
    loading: boolean;
    error: string | null;
    warnings?: DiffWarning[];
  } | null>(null);
  const [forceLargeLoad, setForceLargeLoad] = useState(false);

  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  useEffect(() => {
    setForceLargeLoad(false);
  }, [taskPath, commitHash, filePath]);

  // Load commit file diff
  useEffect(() => {
    if (!taskPath || !commitHash || !filePath) {
      setData(null);
      return;
    }

    let cancelled = false;
    const language = getMonacoLanguageId(filePath);

    setData({ original: '', modified: '', language, loading: true, error: null });

    const load = async () => {
      try {
        const res = await window.electronAPI.gitGetCommitFileDiff({
          taskPath,
          commitHash,
          filePath,
          forceLarge: forceLargeLoad,
        });
        if (!res?.success || !res.diff) {
          throw new Error(res?.error || 'Failed to load commit diff');
        }

        const mode = res.diff.mode ?? (res.diff.isBinary ? 'binary' : 'text');
        if (mode !== 'text') {
          if (!cancelled) {
            setData({
              original: '',
              modified: '',
              language,
              mode,
              loading: false,
              error: modeToMessage(mode),
              warnings: res.diff.warnings,
            });
          }
          return;
        }

        const converted = convertDiffLinesToMonacoFormat(res.diff.lines);
        const original = res.diff.originalContent ?? converted.original;
        const modified = res.diff.modifiedContent ?? converted.modified;

        if (!cancelled) {
          setData({
            original,
            modified,
            language,
            mode: 'text',
            loading: false,
            error: null,
            warnings: res.diff.warnings,
          });
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setData({
            original: '',
            modified: '',
            language,
            mode: undefined,
            loading: false,
            error: (error as Error)?.message ?? String(error),
            warnings: undefined,
          });
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [taskPath, commitHash, filePath, forceLargeLoad]);

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

  // Editor mount handler
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

  // Cleanup
  useEffect(() => {
    return () => {
      try {
        editorRef.current?.dispose();
      } catch {
        // ignore
      }
      editorRef.current = null;

      loader
        .init()
        .then((m) => resetDiagnosticOptions(m))
        .catch(() => {});
    };
  }, []);

  const monacoTheme = getDiffThemeName(effectiveTheme);

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
      <div className="flex h-full min-h-0 flex-col">
        <DiffWarnings warnings={data.warnings} />
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          <span>{data.error}</span>
          {data.mode === 'largeText' && !forceLargeLoad && (
            <button
              type="button"
              className="rounded-md border border-border px-3 py-1 text-xs font-medium text-foreground hover:bg-muted"
              onClick={() => setForceLargeLoad(true)}
            >
              Load anyway
            </button>
          )}
        </div>
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
    <div className="flex h-full min-h-0 flex-col">
      <DiffWarnings warnings={data.warnings} />
      <div className="min-h-0 flex-1">
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
    </div>
  );
};
