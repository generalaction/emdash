import type * as monaco from 'monaco-editor';
import { DIFF_EDITOR_BASE_OPTIONS } from '@renderer/core/monaco/editorConfig';
import { getDiffThemeName, registerDiffThemes } from './monaco-diff-themes';
import { modelRegistry } from './monaco-model-registry';
import { MonacoPool, type PoolEntry as GenericPoolEntry } from './monaco-pool';

export type DiffPoolEntry = GenericPoolEntry<monaco.editor.IStandaloneDiffEditor>;

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
      // Only dispose models this pool created (inmemory:// scheme).
      // Registry-owned models (file://, disk://, git://) are managed by the registry.
      if (model?.original.uri.scheme === 'inmemory') model.original.dispose();
      if (model?.modified.uri.scheme === 'inmemory') model.modified.dispose();
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

  lease(): Promise<DiffPoolEntry> {
    return diffPool.lease();
  },

  release(entry: DiffPoolEntry): void {
    diffPool.release(entry);
  },

  setTheme(effectiveTheme: string): void {
    diffPool.setTheme(getDiffThemeName(effectiveTheme));
  },

  /**
   * Apply typed-URI models to a diff editor.
   *
   * @param originalUri — git:// URI for the left (original / HEAD) side
   * @param modifiedDiskUri — disk:// URI for the right (modified) side — what git sees on disk.
   * @param language — Monaco language identifier (used only as a fallback safety net)
   */
  applyContent(
    entry: DiffPoolEntry,
    originalUri: string,
    modifiedDiskUri: string,
    language: string
  ): void {
    const m = diffPool.getMonaco();
    if (!m) return;

    // Clean up previous models (respecting ownership, same as cleanupOnRelease).
    const prev = entry.editor.getModel();
    if (prev) {
      entry.editor.setModel(null);
      if (prev.original.uri.scheme === 'inmemory') prev.original.dispose();
      if (prev.modified.uri.scheme === 'inmemory') prev.modified.dispose();
    }

    // Original side: use the registered git:// model, fall back to empty inmemory.
    const originalModel =
      modelRegistry.getModelByUri(originalUri) ?? m.editor.createModel('', language);

    // Modified side: always the disk snapshot (matches `git diff` / working tree).
    const modifiedModel =
      modelRegistry.getModelByUri(modifiedDiskUri) ?? m.editor.createModel('', language);

    entry.editor.setModel({ original: originalModel, modified: modifiedModel });
  },
};
