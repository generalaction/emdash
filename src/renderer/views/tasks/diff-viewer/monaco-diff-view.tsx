import { DiffEditor, loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { useEffect } from 'react';
import { DIFF_EDITOR_BASE_OPTIONS } from '@renderer/components/diff-viewer/editorConfig';
import { useTheme } from '@renderer/hooks/useTheme';
import { getDiffThemeName, registerDiffThemes } from '@renderer/lib/monacoDiffThemes';

export function DiffEditorStyles({ isDark }: { isDark: boolean }) {
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
// useMonacoDiffTheme — registers diff themes and applies the current one
// ---------------------------------------------------------------------------

export function useMonacoDiffTheme() {
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
// MonacoDiffView — themed Monaco DiffEditor wrapper
// ---------------------------------------------------------------------------

export interface MonacoDiffViewProps {
  original: string;
  modified: string;
  language: string;
  diffStyle: 'unified' | 'split';
  readOnly?: boolean;
  glyphMargin?: boolean;
  lineDecorationsWidth?: number;
  onMount?: (
    editor: monaco.editor.IStandaloneDiffEditor,
    monacoInstance: typeof monaco
  ) => Promise<void> | void;
}

export function MonacoDiffView({
  original,
  modified,
  language,
  diffStyle,
  readOnly = false,
  glyphMargin = false,
  lineDecorationsWidth,
  onMount,
}: MonacoDiffViewProps) {
  const { monacoTheme } = useMonacoDiffTheme();

  const handleMount = async (editor: monaco.editor.IStandaloneDiffEditor) => {
    if (onMount) {
      const monacoInstance = await loader.init();
      await onMount(editor, monacoInstance);
    }
  };

  return (
    <div className="h-full">
      <DiffEditor
        height="100%"
        language={language}
        original={original}
        modified={modified}
        theme={monacoTheme}
        options={{
          ...DIFF_EDITOR_BASE_OPTIONS,
          readOnly,
          renderSideBySide: diffStyle === 'split',
          glyphMargin,
          ...(lineDecorationsWidth !== undefined ? { lineDecorationsWidth } : {}),
        }}
        onMount={handleMount}
      />
    </div>
  );
}
