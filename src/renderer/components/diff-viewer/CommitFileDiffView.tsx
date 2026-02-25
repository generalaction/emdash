import React, { useEffect, useRef, useState } from 'react';
import { DiffEditor, loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { convertDiffLinesToMonacoFormat, getMonacoLanguageId } from '../../lib/diffUtils';
import { MONACO_DIFF_COLORS } from '../../lib/monacoDiffColors';
import { configureDiffEditorDiagnostics, resetDiagnosticOptions } from '../../lib/monacoDiffConfig';
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
      } catch (error: any) {
        if (!cancelled) {
          setData({
            original: '',
            modified: '',
            language,
            loading: false,
            error: error?.message || 'Failed to load commit diff',
          });
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [taskPath, commitHash, filePath]);

  // Define Monaco themes
  useEffect(() => {
    const defineThemes = async () => {
      try {
        const monacoInstance = await loader.init();
        monacoInstance.editor.defineTheme('custom-diff-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [],
          colors: {
            'editor.background': MONACO_DIFF_COLORS.dark.editorBackground,
            'editorGutter.background': MONACO_DIFF_COLORS.dark.editorBackground,
            'diffEditor.insertedTextBackground': MONACO_DIFF_COLORS.dark.insertedTextBackground,
            'diffEditor.insertedLineBackground': MONACO_DIFF_COLORS.dark.insertedLineBackground,
            'diffEditor.removedTextBackground': MONACO_DIFF_COLORS.dark.removedTextBackground,
            'diffEditor.removedLineBackground': MONACO_DIFF_COLORS.dark.removedLineBackground,
            'diffEditor.unchangedRegionBackground': '#1a2332',
          },
        });
        monacoInstance.editor.defineTheme('custom-diff-black', {
          base: 'vs-dark',
          inherit: true,
          rules: [],
          colors: {
            'editor.background': MONACO_DIFF_COLORS['dark-black'].editorBackground,
            'editorGutter.background': MONACO_DIFF_COLORS['dark-black'].editorBackground,
            'diffEditor.insertedTextBackground':
              MONACO_DIFF_COLORS['dark-black'].insertedTextBackground,
            'diffEditor.insertedLineBackground':
              MONACO_DIFF_COLORS['dark-black'].insertedLineBackground,
            'diffEditor.removedTextBackground':
              MONACO_DIFF_COLORS['dark-black'].removedTextBackground,
            'diffEditor.removedLineBackground':
              MONACO_DIFF_COLORS['dark-black'].removedLineBackground,
            'diffEditor.unchangedRegionBackground': '#0a0a0a',
          },
        });
        monacoInstance.editor.defineTheme('custom-diff-light', {
          base: 'vs',
          inherit: true,
          rules: [],
          colors: {
            'diffEditor.insertedTextBackground': MONACO_DIFF_COLORS.light.insertedTextBackground,
            'diffEditor.insertedLineBackground': MONACO_DIFF_COLORS.light.insertedLineBackground,
            'diffEditor.removedTextBackground': MONACO_DIFF_COLORS.light.removedTextBackground,
            'diffEditor.removedLineBackground': MONACO_DIFF_COLORS.light.removedLineBackground,
            'diffEditor.unchangedRegionBackground': '#e2e8f0',
          },
        });

        const currentTheme =
          effectiveTheme === 'dark-black'
            ? 'custom-diff-black'
            : effectiveTheme === 'dark'
              ? 'custom-diff-dark'
              : 'custom-diff-light';
        monacoInstance.editor.setTheme(currentTheme);
      } catch (error) {
        console.warn('Failed to define Monaco themes:', error);
      }
    };

    defineThemes();
  }, [isDark, effectiveTheme]);

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
