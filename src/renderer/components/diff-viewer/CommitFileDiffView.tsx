import React, { useEffect, useRef, useState } from 'react';
import { DiffEditor, loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { convertDiffLinesToMonacoFormat, getMonacoLanguageId } from '../../lib/diffUtils';
import { configureDiffEditorDiagnostics, resetDiagnosticOptions } from '../../lib/monacoDiffConfig';
import { registerDiffThemes, getDiffThemeName } from '../../lib/monacoDiffThemes';
import { useTheme } from '../../hooks/useTheme';

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
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';

  const [data, setData] = useState<{
    original: string;
    modified: string;
    language: string;
    loading: boolean;
    error: string | null;
  } | null>(null);

  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

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
        });
        if (!res?.success || !res.diff) {
          throw new Error(res?.error || 'Failed to load commit diff');
        }

        const converted = convertDiffLinesToMonacoFormat(res.diff.lines);

        if (!cancelled) {
          setData({
            original: converted.original,
            modified: converted.modified,
            language,
            loading: false,
            error: null,
          });
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

    load();
    return () => {
      cancelled = true;
    };
  }, [taskPath, commitHash, filePath]);

  // Register and apply Monaco diff themes
  useEffect(() => {
    let cancelled = false;
    registerDiffThemes()
      .then(() => {
        if (!cancelled) {
          const monacoInstance = (window as any).monaco;
          if (monacoInstance) {
            monacoInstance.editor.setTheme(getDiffThemeName(effectiveTheme));
          }
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

  const monacoTheme =
    effectiveTheme === 'dark-black'
      ? 'custom-diff-black'
      : effectiveTheme === 'dark'
        ? 'custom-diff-dark'
        : 'custom-diff-light';

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
          readOnly: true,
          originalEditable: false,
          renderSideBySide: diffStyle === 'split',
          fontSize: 13,
          lineHeight: 20,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
          lineNumbers: 'on',
          lineNumbersMinChars: 2,
          renderIndicators: false,
          overviewRulerLanes: 3,
          renderOverviewRuler: true,
          overviewRulerBorder: false,
          automaticLayout: true,
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            useShadows: false,
            verticalScrollbarSize: 4,
            horizontalScrollbarSize: 4,
            arrowSize: 0,
            verticalHasArrows: false,
            horizontalHasArrows: false,
            alwaysConsumeMouseWheel: false,
            verticalSliderSize: 4,
            horizontalSliderSize: 4,
          },
          hideUnchangedRegions: { enabled: true },
          diffWordWrap: 'on',
          enableSplitViewResizing: false,
          smoothScrolling: true,
          cursorSmoothCaretAnimation: 'on',
          padding: { top: 8, bottom: 8 },
          glyphMargin: false,
          folding: false,
        }}
        onMount={handleEditorDidMount}
      />
    </div>
  );
};
