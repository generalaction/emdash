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

async function createDiffSides(binder: MonacoFacetBinder, name: string, modifiedText: string) {
  const ref = hostFileRefFromNativePath(`/repo/${name}.txt`);
  const originalFacet = { kind: 'git', ref: { kind: 'head' } } as const;
  const modifiedFacet = { kind: 'buffer' } as const;
  const originalHandle = await binder.createHandle({
    uri: encodeResourceUri(ref),
    facet: originalFacet,
    initialText: longFile,
    readonly: true,
  });
  const modifiedHandle = await binder.createHandle({
    uri: encodeResourceUri(ref),
    facet: modifiedFacet,
    initialText: modifiedText,
    readonly: false,
  });
  cleanups.push(
    () => originalHandle.dispose(),
    () => modifiedHandle.dispose()
  );
  const entry: OpenFileEntry = {
    key: resourceKeyFromFileRef(ref),
    uri: encodeResourceUri(ref),
    status: { kind: 'ready' },
    dirty: false,
    conflicted: false,
    saving: false,
    readOnly: false,
    handleFor: (facet) => (facet.kind === 'git' ? originalHandle : modifiedHandle),
    gitStatus: () => ({ kind: 'ready' }),
  };
  return {
    original: {
      kind: 'facet',
      entry,
      facet: originalFacet,
      uri: encodeFacetUri(ref, originalFacet),
    } satisfies DiffSideModel,
    modified: {
      kind: 'facet',
      entry,
      facet: modifiedFacet,
      uri: encodeFacetUri(ref, modifiedFacet),
    } satisfies DiffSideModel,
  };
}

const longFile = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n');

function mountDiff(diffStyle: 'split' | 'unified', revealFirstChange = true) {
  const host = document.createElement('div');
  host.style.cssText = 'width: 800px; height: 400px';
  document.body.append(host);
  cleanups.push(() => host.remove());
  const root = createRoot(host);
  cleanups.push(async () => {
    await act(async () => root.unmount());
  });
  let editor: monaco.editor.IStandaloneDiffEditor | null = null;
  return async (sides: { original: DiffSideModel; modified: DiffSideModel }) => {
    await act(async () => {
      root.render(
        <StickyDiffEditor
          {...sides}
          filePath="scroll.txt"
          diffStyle={diffStyle}
          revealFirstChange={revealFirstChange}
          onEditorChange={(value) => {
            editor = value;
          }}
        />
      );
    });
    const diff = editor as monaco.editor.IStandaloneDiffEditor | null;
    if (!diff) throw new Error('diff editor missing');
    diff.getContainerDomNode().style.height = '400px';
    diff.layout({ width: 800, height: 400 });
    await expect.poll(() => diff.getLineChanges(), { timeout: 3000 }).not.toBeNull();
    return diff;
  };
}

it.each(['split', 'unified'] as const)(
  'opens %s diffs at a late change and preserves the viewport across updates and file switches',
  async (diffStyle) => {
    const binder = new MonacoFacetBinder(async () => monaco);
    runtime.binder = binder;
    const first = await createDiffSides(
      binder,
      'first',
      longFile.replace('line 900', 'changed 900')
    );
    const second = await createDiffSides(
      binder,
      'second',
      longFile.replace('line 700', 'changed 700')
    );
    const render = mountDiff(diffStyle);
    const diff = await render(first);
    const right = diff.getModifiedEditor();
    await expect.poll(() => right.getVisibleRanges()[0]?.startLineNumber).toBeGreaterThan(880);
    expect(right.getVisibleRanges()[0]?.startLineNumber).toBeLessThan(900);
    expect(right.getVisibleRanges().at(-1)?.endLineNumber).toBeGreaterThanOrEqual(900);

    right.revealLineNearTop(300, monaco.editor.ScrollType.Immediate);
    const scrollTop = right.getScrollTop();
    right.getModel()?.applyEdits([
      {
        range: new monaco.Range(950, 1, 950, 1),
        text: 'another change ',
      },
    ]);
    await expect.poll(() => diff.getLineChanges()?.length).toBe(2);
    expect(right.getScrollTop()).toBe(scrollTop);

    await render(second);
    await expect.poll(() => right.getVisibleRanges()[0]?.startLineNumber).toBeGreaterThan(680);
    expect(right.getVisibleRanges()[0]?.startLineNumber).toBeLessThan(700);
    await render(first);
    expect(right.getScrollTop()).toBe(scrollTop);

    // The top of the file is also a deliberate saved position.
    right.setScrollTop(0, monaco.editor.ScrollType.Immediate);
    await render(second);
    await render(first);
    expect(right.getScrollTop()).toBe(0);
  }
);

it.each(['split', 'unified'] as const)('reveals a deletion in a %s diff', async (diffStyle) => {
  const binder = new MonacoFacetBinder(async () => monaco);
  runtime.binder = binder;
  const sides = await createDiffSides(binder, 'deleted-line', longFile.replace('line 900\n', ''));
  const diff = await mountDiff(diffStyle)(sides);
  const right = diff.getModifiedEditor();
  await expect.poll(() => right.getVisibleRanges()[0]?.startLineNumber).toBeGreaterThan(880);
  expect(right.getVisibleRanges()[0]?.startLineNumber).toBeLessThan(900);
  expect(right.getVisibleRanges().at(-1)?.endLineNumber).toBeGreaterThanOrEqual(900);
});

it('keeps stacked diffs at the top', async () => {
  const binder = new MonacoFacetBinder(async () => monaco);
  runtime.binder = binder;
  const sides = await createDiffSides(
    binder,
    'stacked',
    longFile.replace('line 900', 'changed 900')
  );
  const diff = await mountDiff('split', false)(sides);
  expect(diff.getModifiedEditor().getScrollTop()).toBe(0);
});

it('does not jump when an initially unchanged file gains a change', async () => {
  const binder = new MonacoFacetBinder(async () => monaco);
  runtime.binder = binder;
  const sides = await createDiffSides(binder, 'unchanged', longFile);
  const diff = await mountDiff('split')(sides);
  const right = diff.getModifiedEditor();
  right.revealLineNearTop(300, monaco.editor.ScrollType.Immediate);
  const scrollTop = right.getScrollTop();
  right.getModel()?.applyEdits([{ range: new monaco.Range(900, 1, 900, 1), text: 'changed ' }]);
  await expect.poll(() => diff.getLineChanges()?.length).toBe(1);
  expect(right.getScrollTop()).toBe(scrollTop);
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
