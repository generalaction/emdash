import { encodeResourceUri, resourceKeyFromFileRef } from '@emdash/core/primitives/path/api';
import { observable, runInAction } from 'mobx';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { encodeFacetUri } from '@core/features/editor/api/browser/facet-binder/facet-uri';
import { MonacoFacetBinder } from '@core/features/editor/api/browser/facet-binder/monaco-facet-binder';
import type { OpenFileEntry } from '@core/features/editor/api/browser/open-file-store/open-file-store';
import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import { StickyDiffEditor, type DiffSideModel } from './sticky-diff-editor';

const runtime = vi.hoisted(() => ({ binder: null as MonacoFacetBinder | null }));
vi.mock('@core/features/editor/browser/monaco/install-monaco-facet-binder', () => ({
  installMonacoFacetBinder: () => runtime.binder,
}));
vi.mock('@core/features/editor/browser/monaco/monaco-bootstrap', () => ({
  monacoBootstrap: { getMonaco: () => monaco, setTheme: vi.fn() },
}));
vi.mock('@core/features/editor/api/browser/open-file-store/open-file-store', () => ({
  openFileStore: { save: vi.fn() },
}));
vi.mock('@core/manifests/browser/modal-api', () => ({ openModal: vi.fn() }));
vi.mock('@core/primitives/theme/browser', () => ({
  useTheme: () => ({ effectiveTheme: 'dark' }),
}));

self.MonacoEnvironment = { getWorker: () => new editorWorker() };
const cleanups: Array<() => void | Promise<void>> = [];
beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  runtime.binder = null;
});

it.each([true, false])(
  'observes filesystem permissions with initial read-only state %s',
  async (initialReadOnly) => {
    const binder = new MonacoFacetBinder(async () => monaco);
    runtime.binder = binder;
    const ref = hostFileRefFromNativePath('/repo/permissions.txt');
    const facet = { kind: 'buffer' } as const;
    const handle = await binder.createHandle({
      uri: encodeResourceUri(ref),
      facet,
      initialText: 'text',
      readonly: initialReadOnly,
    });
    cleanups.push(() => handle.dispose());
    const permissions = observable.object({ readOnly: initialReadOnly });
    const entry: OpenFileEntry = {
      key: resourceKeyFromFileRef(ref),
      uri: encodeResourceUri(ref),
      status: { kind: 'ready' },
      dirty: false,
      conflicted: false,
      saving: false,
      get readOnly() {
        return permissions.readOnly;
      },
      handleFor: () => handle,
      gitStatus: () => undefined,
    };
    const modified: DiffSideModel = {
      kind: 'facet',
      entry,
      facet,
      uri: encodeFacetUri(ref, facet),
    };
    const host = document.createElement('div');
    host.style.cssText = 'width: 800px; height: 400px';
    document.body.append(host);
    cleanups.push(() => host.remove());
    const root = createRoot(host);
    cleanups.push(async () => {
      await act(async () => {
        root.unmount();
      });
    });
    let editor: monaco.editor.IStandaloneDiffEditor | null = null;
    await act(async () => {
      root.render(
        <StickyDiffEditor
          original={{ kind: 'empty' }}
          modified={modified}
          filePath="permissions.txt"
          diffStyle="split"
          onEditorChange={(value) => {
            editor = value;
          }}
        />
      );
    });
    const diff = editor as monaco.editor.IStandaloneDiffEditor | null;
    if (!diff) throw new Error('diff editor missing');
    const right = diff.getModifiedEditor();
    const model = right.getModel();
    expect(right.getOption(monaco.editor.EditorOption.readOnly)).toBe(initialReadOnly);
    const setReadOnly = async (readOnly: boolean) => {
      await act(async () => {
        runInAction(() => {
          permissions.readOnly = readOnly;
        });
      });
      expect(right.getOption(monaco.editor.EditorOption.readOnly)).toBe(readOnly);
      expect(right.getModel()).toBe(model);
      expect(diff.getOriginalEditor().getOption(monaco.editor.EditorOption.readOnly)).toBe(true);
    };
    await setReadOnly(false);
    const diffUpdated = new Promise<void>((resolve) => {
      const subscription = diff.onDidUpdateDiff(() => {
        subscription.dispose();
        resolve();
      });
      cleanups.push(() => subscription.dispose());
    });
    right.setPosition({ lineNumber: 1, column: 5 });
    right.trigger('keyboard', 'type', { text: '!' });
    expect(handle.getText()).toBe('text!');
    await setReadOnly(true);
    await setReadOnly(false);
    expect(handle.getText()).toBe('text!');
    // Finish the worker diff before unmounting its editor and models.
    await diffUpdated;
  }
);
