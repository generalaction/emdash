import type * as monaco from 'monaco-editor';
import { DEFAULT_EDITOR_OPTIONS } from '@renderer/core/editor/utils';
import { configureMonacoTypeScript } from '@renderer/core/monaco/monaco-config';
import { MonacoPool, type PoolEntry as GenericPoolEntry } from '@renderer/core/monaco/monaco-pool';
import { defineMonacoThemes } from '@renderer/core/monaco/monaco-themes';

export type CodePoolEntry = GenericPoolEntry<monaco.editor.IStandaloneCodeEditor>;

export const codeEditorPool = new MonacoPool<monaco.editor.IStandaloneCodeEditor>({
  poolId: 'monaco-code-pool',
  reserveTarget: 1,
  createEditor: (m, container) => m.editor.create(container, { ...DEFAULT_EDITOR_OPTIONS }),
  cleanupOnRelease: (editor) => {
    editor.updateOptions({ readOnly: false, glyphMargin: false });
    editor.setModel(null);
  },
  onInit: async (m) => {
    defineMonacoThemes(m as Parameters<typeof defineMonacoThemes>[0]);
    configureMonacoTypeScript(m);
  },
});
