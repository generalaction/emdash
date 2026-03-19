import type * as monaco from 'monaco-editor';
import { DIFF_EDITOR_BASE_OPTIONS } from '@renderer/_deprecated/diff-viewer/editorConfig';
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
      // Registry-owned models (file://, disk://, base://) are managed by the registry.
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

  applyContent(
    entry: DiffPoolEntry,
    original: string,
    modified: string,
    language: string,
    registryUri?: string
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

    // Use live registry models when the file is open, otherwise create inmemory models.
    const originalModel =
      (registryUri ? modelRegistry.getGitBaseModel(registryUri) : undefined) ??
      m.editor.createModel(original, language);
    const modifiedModel =
      (registryUri ? modelRegistry.getDiskModel(registryUri) : undefined) ??
      m.editor.createModel(modified, language);

    entry.editor.setModel({ original: originalModel, modified: modifiedModel });
  },
};
