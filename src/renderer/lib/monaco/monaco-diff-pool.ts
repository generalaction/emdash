import type * as monaco from 'monaco-editor';
import { DIFF_EDITOR_BASE_OPTIONS } from '@renderer/lib/monaco/editorConfig';
import { log } from '@renderer/utils/logger';
import { defineMonacoDiffThemes, getDiffThemeName, registerDiffThemes } from './monaco-diff-themes';
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
      log.debug('[monaco-diff-pool] model disposal error (suppressed):', err);
    }
  },
  onInit: async (m) => {
    modelRegistry.notifyMonacoReady(m);
    await registerDiffThemes();
  },
});

export const diffEditorPool = {
  init(reserveTarget?: number): Promise<void> {
    return diffPool.init(reserveTarget);
  },

  /** Resolves with the Monaco namespace once init has completed. */
  async whenReady(): Promise<typeof monaco> {
    return diffPool.init(0).then(() => diffPool.getMonaco()!);
  },

  lease(): Promise<DiffPoolEntry> {
    return diffPool.lease();
  },

  release(entry: DiffPoolEntry): void {
    diffPool.release(entry);
  },

  setTheme(effectiveTheme: string): void {
    const m = diffPool.getMonaco();
    if (m) defineMonacoDiffThemes(m);
    diffPool.setTheme(getDiffThemeName(effectiveTheme));
  },

  /**
   * Apply typed-URI models to a diff editor.
   *
   * @param originalUri — URI for the left (original/before) side — typically git://
   * @param modifiedUri — URI for the right (modified/after) side — disk://, git://, etc.
   * @param language — Monaco language identifier (used only as a fallback safety net)
   */
  applyContent(
    entry: DiffPoolEntry,
    originalUri: string,
    modifiedUri: string,
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

    // Original side: use the registered model, fall back to empty inmemory.
    const originalModel =
      modelRegistry.getModelByUri(originalUri) ?? m.editor.createModel('', language);

    // Modified side: disk://, git://, or any other registered URI scheme.
    const modifiedModel =
      modelRegistry.getModelByUri(modifiedUri) ?? m.editor.createModel('', language);

    entry.editor.setModel({ original: originalModel, modified: modifiedModel });
  },
};
