import type * as monaco from 'monaco-editor';
import { DIFF_EDITOR_BASE_OPTIONS } from '@renderer/_deprecated/diff-viewer/editorConfig';
import { MonacoPool, type PoolEntry as GenericPoolEntry } from './monaco-pool';
import { getDiffThemeName, registerDiffThemes } from './monacoDiffThemes';

// Re-export as a concrete type so pooled-diff-editor.tsx imports are unchanged.
export type PoolEntry = GenericPoolEntry<monaco.editor.IStandaloneDiffEditor>;

const diffPool = new MonacoPool<monaco.editor.IStandaloneDiffEditor>({
  poolId: 'monaco-diff-pool',
  reserveTarget: 3,
  createEditor: (m, container) =>
    m.editor.createDiffEditor(container, {
      ...DIFF_EDITOR_BASE_OPTIONS,
      renderSideBySide: true,
    }),
  cleanupOnRelease: (editor) => {
    try {
      const model = editor.getModel();
      editor.setModel(null);
      model?.original.dispose();
      model?.modified.dispose();
    } catch (err) {
      console.warn('[monaco-diff-pool] model disposal error (suppressed):', err);
    }
  },
  onInit: async () => {
    await registerDiffThemes();
  },
});

export const diffEditorPool = {
  init(reserveTarget?: number): Promise<void> {
    return diffPool.init(reserveTarget);
  },

  lease(): Promise<PoolEntry> {
    return diffPool.lease();
  },

  release(entry: PoolEntry): void {
    diffPool.release(entry);
  },

  /**
   * Update Monaco's global theme for all diff editor instances.
   * Accepts the app's effectiveTheme string ('dark', 'dark-black', 'light').
   */
  setTheme(effectiveTheme: string): void {
    diffPool.setTheme(getDiffThemeName(effectiveTheme));
  },

  /**
   * Create fresh text models and attach them to the leased editor.
   * Must be called after lease() and before the editor is displayed.
   */
  applyContent(entry: PoolEntry, original: string, modified: string, language: string): void {
    const m = diffPool.getMonaco();
    if (!m) return;

    const prev = entry.editor.getModel();
    if (prev) {
      entry.editor.setModel(null);
      prev.original.dispose();
      prev.modified.dispose();
    }

    const originalModel = m.editor.createModel(original, language);
    const modifiedModel = m.editor.createModel(modified, language);
    entry.editor.setModel({ original: originalModel, modified: modifiedModel });
  },
};
