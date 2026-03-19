import type * as monaco from 'monaco-editor';
import { DIFF_EDITOR_BASE_OPTIONS } from '@renderer/_deprecated/diff-viewer/editorConfig';
import { modelRegistry } from './monaco-model-registry';
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
      // Only dispose models that this pool created (inmemory:// scheme).
      // Registry-owned models have a file:// URI — leave them alive.
      if (model?.original.uri.scheme === 'inmemory') {
        model.original.dispose();
      }
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
   * Attach text models to the leased diff editor.
   *
   * If `originalUri` is provided and the model is in the MonacoModelRegistry
   * (i.e. the file is open in the code editor), it is reused directly — the
   * original side of the diff will reflect any unsaved edits. Otherwise, a
   * fresh inmemory model is created from `original`.
   *
   * Modified model is always freshly created (pool-owned).
   */
  applyContent(
    entry: PoolEntry,
    original: string,
    modified: string,
    language: string,
    originalUri?: string
  ): void {
    const m = diffPool.getMonaco();
    if (!m) return;

    // Clean up previous models (respecting ownership, same as cleanupOnRelease).
    const prev = entry.editor.getModel();
    if (prev) {
      entry.editor.setModel(null);
      if (prev.original.uri.scheme === 'inmemory') {
        prev.original.dispose();
      }
      prev.modified.dispose();
    }

    // Prefer reusing the registry model so the diff reflects live unsaved edits.
    const registryModel = originalUri ? modelRegistry.getModel(originalUri) : undefined;
    const originalModel = registryModel ?? m.editor.createModel(original, language);
    const modifiedModel = m.editor.createModel(modified, language);
    entry.editor.setModel({ original: originalModel, modified: modifiedModel });
  },
};
