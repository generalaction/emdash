import { loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { DIFF_EDITOR_BASE_OPTIONS } from '@renderer/components/diff-viewer/editorConfig';
import { useTheme } from '@renderer/hooks/useTheme';
import { getDiffThemeName, registerDiffThemes } from '@renderer/lib/monacoDiffThemes';

export interface MonacoDiffProps {
  original: string;
  modified: string;
  language: string;
  diffStyle: 'unified' | 'split';
  /** Called whenever the modified editor's content height changes — for dynamic virtualization. */
  onHeightChange?: (height: number) => void;
}

/**
 * Self-contained Monaco diff editor that uses `monaco.editor.createDiffEditor()`
 * directly — bypassing @monaco-editor/react's wrapper so that `updateOptions +
 * layout()` reliably toggles `renderSideBySide` without interference.
 */
export function MonacoDiff({
  original,
  modified,
  language,
  diffStyle,
  onHeightChange,
}: MonacoDiffProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const { effectiveTheme } = useTheme();

  // Stable refs so async/effect closures always read the current prop values
  // without needing them as effect dependencies.
  const diffStyleRef = useRef(diffStyle);
  diffStyleRef.current = diffStyle;
  const originalRef = useRef(original);
  originalRef.current = original;
  const modifiedRef = useRef(modified);
  modifiedRef.current = modified;
  const languageRef = useRef(language);
  languageRef.current = language;
  const onHeightChangeRef = useRef(onHeightChange);
  onHeightChangeRef.current = onHeightChange;
  const effectiveThemeRef = useRef(effectiveTheme);
  effectiveThemeRef.current = effectiveTheme;

  // Apply theme globally whenever it changes
  useEffect(() => {
    let cancelled = false;
    registerDiffThemes()
      .then(async () => {
        if (!cancelled) {
          const m = await loader.init();
          m.editor.setTheme(getDiffThemeName(effectiveTheme));
        }
      })
      .catch((err: unknown) => console.warn('Failed to apply diff theme:', err));
    return () => {
      cancelled = true;
    };
  }, [effectiveTheme]);

  // Create editor on mount; dispose on unmount.
  // All prop values are read via refs so this intentionally has [] deps.
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let cancelled = false;

    void loader.init().then(async (m) => {
      if (cancelled || !container) return;

      await registerDiffThemes();

      // Check again after the async theme registration — the component may have
      // unmounted while we were yielded, which would have set cancelled=true.
      if (cancelled) return;

      m.editor.setTheme(getDiffThemeName(effectiveThemeRef.current));

      const editor = m.editor.createDiffEditor(container, {
        ...DIFF_EDITOR_BASE_OPTIONS,
        renderSideBySide: diffStyleRef.current === 'split',
      });

      const originalModel = m.editor.createModel(originalRef.current, languageRef.current);
      const modifiedModel = m.editor.createModel(modifiedRef.current, languageRef.current);
      editor.setModel({ original: originalModel, modified: modifiedModel });

      editorRef.current = editor;

      const modifiedEditor = editor.getModifiedEditor();
      onHeightChangeRef.current?.(modifiedEditor.getContentHeight());
      modifiedEditor.onDidContentSizeChange((e: monaco.editor.IContentSizeChangedEvent) => {
        if (e.contentHeightChanged) {
          onHeightChangeRef.current?.(e.contentHeight);
        }
      });
    });

    return () => {
      cancelled = true;
      const editor = editorRef.current;
      editorRef.current = null;
      if (editor) {
        try {
          const model = editor.getModel();
          // Detach models before disposal so Monaco stops firing model events
          // while the editor is being torn down, preventing "disposing of store" errors.
          editor.setModel(null);
          editor.dispose();
          model?.original.dispose();
          model?.modified.dispose();
        } catch (err) {
          console.warn('Monaco diff editor disposal error (suppressed):', err);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggle renderSideBySide — direct Monaco API with no @monaco-editor/react interference
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({ renderSideBySide: diffStyle === 'split' });
    editor.layout();
  }, [diffStyle]);

  // Update model content when diff data changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    if (model.original.getValue() !== original) model.original.setValue(original);
    if (model.modified.getValue() !== modified) model.modified.setValue(modified);
  }, [original, modified]);

  return <div ref={containerRef} className="h-full" />;
}
