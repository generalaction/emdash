import { LOCAL_HOST_REF, hostRef, type HostRef } from '@emdash/core/primitives/host/api';
import { hostFileRef, parseNativeAbsolute } from '@emdash/core/primitives/path/api';
import {
  languageServers,
  type LanguageServerDefinition,
  type LspState,
} from '@emdash/core/runtimes/lsp/api';
import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import type { CallMeta } from '@emdash/wire/rpc';
import { cell, expose } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeFacetUri } from '../../api/browser/facet-binder/facet-uri';
import { editorLspContract } from '../../api/lsp-contract';
import { configureMonacoTypeScript } from '../monaco/monaco-config';
import { MonacoLanguageServices } from './monaco-language-services';

// Monaco cancels its own worker requests when a test disposes an editor.
addEventListener('unhandledrejection', (event) => {
  if (event.reason instanceof Error && event.reason.name === 'Canceled') event.preventDefault();
});
configureMonacoTypeScript(monaco);
self.MonacoEnvironment = {
  getWorker: (_id, label) =>
    label === 'typescript' || label === 'javascript' ? new tsWorker() : new editorWorker(),
};
const token: monaco.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};
const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
function file(path: string, host: HostRef = LOCAL_HOST_REF) {
  const parsed = parseNativeAbsolute(path);
  if (!parsed.success) throw new Error('invalid test path');
  return hostFileRef(host, parsed.data);
}
function fixture(
  clientFailure = false,
  host: HostRef = LOCAL_HOST_REF,
  servers?: readonly LanguageServerDefinition[]
) {
  const scope = createScope();
  cleanup.push(() => scope.dispose());
  const state = cell<LspState>({
    phase: 'ready',
    generation: 'one',
    capabilities: { hover: true, definition: true, typeDefinition: true, references: true },
    diagnostics: [],
  });
  const syncDocument = vi.fn(async (_input: unknown) => ok(undefined));
  const resolveProject = vi.fn(async (input: { workspaceRoot: ReturnType<typeof file>['path'] }) =>
    ok(input.workspaceRoot)
  );
  const changeDocument = vi.fn(async () => ok(undefined));
  const restart = vi.fn(async () => ok(undefined));
  const closeDocument = vi.fn(async () => ok(undefined));
  const hover = vi.fn(async (_input: unknown, _meta: CallMeta) => ok({ contents: '**string**' }));
  const target = file('/outside/dependency.d.ts', host);
  const wire = createTestWire(
    editorLspContract,
    {
      session: expose(editorLspContract.session, { current: state }, { scope }),
      syncDocument,
      resolveProject,
      changeDocument,
      closeDocument,
      saved: async () => ok(undefined),
      restart,
      hover,
      locations: async () =>
        ok([
          {
            path: target.path,
            range: { start: { line: 5, character: 2 }, end: { line: 5, character: 8 } },
          },
        ]),
    },
    { validate: 'full' }
  );
  cleanup.push(() => wire.dispose());
  const open = vi.fn(() => true);
  const getClient = vi.fn(async () => wire.client);
  if (clientFailure) getClient.mockRejectedValueOnce(new Error('host offline'));
  const services = new MonacoLanguageServices(monaco, {
    client: getClient,
    openLocation: open,
    servers,
  });
  cleanup.push(() => services.dispose());
  const ref = file('/workspace/a.ts', host);
  cleanup.push(
    services.registerContext(ref, file('/workspace', host), {
      projectId: 'project',
      taskId: 'task',
    })
  );
  const model = monaco.editor.createModel(
    'const value = 1;',
    'typescript',
    monaco.Uri.parse(encodeFacetUri(ref, { kind: 'buffer' }))
  );
  cleanup.push(() => model.dispose());
  return {
    services,
    model,
    state,
    ref,
    target,
    syncDocument,
    closeDocument,
    hover,
    open,
    resolveProject,
    changeDocument,
    restart,
  };
}

describe('Monaco language services', () => {
  it('synchronizes unsaved text before hover and converts one-based positions', async () => {
    const f = fixture();
    f.model.setValue('const value = "unsaved";');
    const result = await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
    expect(result?.contents).toEqual([{ value: '**string**', isTrusted: false }]);
    expect(f.syncDocument).toHaveBeenLastCalledWith(
      expect.objectContaining({
        document: expect.objectContaining({ text: 'const value = "unsaved";' }),
      }),
      expect.anything()
    );
    expect(f.hover.mock.calls[0][0]).toMatchObject({ position: { line: 0, character: 7 } });
  });
  it('ignores disk and Git snapshot models and shares the buffer across two editors', async () => {
    const f = fixture();
    const disk = monaco.editor.createModel(
      'disk text',
      'typescript',
      monaco.Uri.parse(encodeFacetUri(f.ref, { kind: 'disk' }))
    );
    cleanup.push(() => disk.dispose());
    const containers = [document.createElement('div'), document.createElement('div')];
    const editors = containers.map((container) =>
      monaco.editor.create(container, { model: f.model })
    );
    cleanup.push(() => editors.forEach((editor) => editor.dispose()));
    await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
    expect(f.syncDocument).toHaveBeenCalledTimes(1);
    expect(await f.services.hover(disk, { lineNumber: 1, column: 1 }, token)).toBeNull();
    editors[0].dispose();
    expect(f.closeDocument).not.toHaveBeenCalled();
  });
  it('maps definitions outside the workspace back to the source host', async () => {
    const f = fixture();
    const locations = await f.services.locations(
      'definition',
      f.model,
      { lineNumber: 1, column: 8 },
      token
    );
    expect(locations?.[0]).toMatchObject({
      range: { startLineNumber: 6, startColumn: 3, endLineNumber: 6, endColumn: 9 },
    });
    expect(locations?.[0].uri.toString()).toBe(encodeFacetUri(f.target, { kind: 'buffer' }));
  });
  it('publishes diagnostics only on the buffer and clears them on edits and disconnection', async () => {
    const f = fixture();
    await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
    const ready = {
      phase: 'ready' as const,
      generation: 'one',
      capabilities: { hover: true, definition: true, typeDefinition: true, references: true },
    };
    f.state.set({
      ...ready,
      diagnostics: [
        {
          path: f.ref.path,
          version: f.model.getVersionId(),
          diagnostics: [
            {
              message: 'Type mismatch',
              severity: 1,
              range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
            },
          ],
        },
      ],
    });
    await expect
      .poll(() =>
        monaco.editor.getModelMarkers({ resource: f.model.uri }).map((marker) => marker.message)
      )
      .toEqual(['Type mismatch']);
    f.model.setValue('const value = 2;');
    expect(monaco.editor.getModelMarkers({ resource: f.model.uri })).toEqual([]);
    f.state.set({ ...ready, phase: 'failed', error: 'disconnected', diagnostics: [] });
    await expect.poll(() => f.services.status(f.ref)?.phase).toBe('failed');
  });
});

describe('Monaco language-service lifetimes', () => {
  it('discards hover results when the buffer changes during the request', async () => {
    const f = fixture();
    const pending = deferred<ReturnType<typeof ok<{ contents: string }>>>();
    f.hover.mockImplementationOnce(() => pending.promise);
    const request = f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
    await expect.poll(() => f.hover.mock.calls.length).toBe(1);
    f.model.setValue('new contents');
    pending.resolve(ok({ contents: 'obsolete' }));
    expect(await request).toBeNull();
  });
  it('replays every open buffer after a new server generation arrives', async () => {
    const f = fixture();
    await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
    const before = f.syncDocument.mock.calls.length;
    f.state.set({
      phase: 'ready',
      generation: 'two',
      capabilities: { hover: true, definition: true, typeDefinition: true, references: true },
      diagnostics: [],
    });
    await expect.poll(() => f.syncDocument.mock.calls.length).toBeGreaterThan(before);
  });
  it('ignores older version diagnostics after an edit', async () => {
    const f = fixture();
    await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
    const version = f.model.getVersionId();
    f.model.setValue('const edited = true;');
    f.state.set({
      phase: 'ready',
      generation: 'one',
      capabilities: { hover: true, definition: true, typeDefinition: true, references: true },
      diagnostics: [
        {
          path: f.ref.path,
          version,
          diagnostics: [
            {
              message: 'stale',
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            },
          ],
        },
      ],
    });
    await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
    expect(monaco.editor.getModelMarkers({ resource: f.model.uri })).toEqual([]);
  });
  it('closes a document when its shared model is disposed', async () => {
    const f = fixture();
    await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
    f.model.dispose();
    await expect.poll(() => f.closeDocument.mock.calls.length).toBe(1);
  });
  it('uses the originating task when Monaco executes go to definition', async () => {
    const f = fixture();
    const container = document.createElement('div');
    container.style.cssText = 'width:600px;height:400px';
    document.body.appendChild(container);
    cleanup.push(() => container.remove());
    const editor = monaco.editor.create(container, { model: f.model });
    cleanup.push(() => editor.dispose());
    await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
    editor.setPosition({ lineNumber: 1, column: 8 });
    editor.focus();
    cleanup.push(f.services.bindEditor(editor, { projectId: 'project', taskId: 'second-task' }));
    editor.trigger('keyboard', 'editor.action.revealDefinition', {});
    await expect.poll(() => f.open.mock.calls.length).toBe(1);
    expect(f.open).toHaveBeenCalledWith(
      { projectId: 'project', taskId: 'second-task' },
      f.target,
      expect.objectContaining({ startLineNumber: 6, startColumn: 3 })
    );
  });
});

it('retries an initially unavailable connection from the restart action', async () => {
  const f = fixture(true);
  await expect.poll(() => f.services.status(f.ref)?.phase).toBe('failed');
  await f.services.restart(f.ref);
  const result = await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
  expect(result?.contents[0].value).toBe('**string**');
});

it('replays documents when a replacement worker transitions through starting', async () => {
  const f = fixture();
  await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
  const before = f.syncDocument.mock.calls.length;
  const capabilities = { hover: true, definition: true, typeDefinition: true, references: true };
  f.state.set({ phase: 'starting', generation: 'new-worker', capabilities, diagnostics: [] });
  await expect.poll(() => f.services.status(f.ref)?.phase).toBe('starting');
  f.state.set({ phase: 'ready', generation: 'new-worker', capabilities, diagnostics: [] });
  await expect.poll(() => f.syncDocument.mock.calls.length).toBeGreaterThan(before);
});

it('keeps definitions on the remote host even when an identical local path is open', async () => {
  const local = fixture();
  const remote = fixture(false, hostRef('remote', 'server'));
  const result = await remote.services.locations(
    'definition',
    remote.model,
    { lineNumber: 1, column: 8 },
    token
  );
  expect(result?.[0].uri.toString()).toBe(encodeFacetUri(remote.target, { kind: 'buffer' }));
  expect(result?.[0].uri.toString()).not.toBe(encodeFacetUri(local.target, { kind: 'buffer' }));
});

it('forwards Monaco cancellation and ignores a late response without failing the session', async () => {
  const f = fixture();
  const pending = deferred<ReturnType<typeof ok<{ contents: string }>>>();
  const cancellation = new Set<() => void>();
  f.hover.mockImplementationOnce(() => pending.promise);
  const request = f.services.hover(
    f.model,
    { lineNumber: 1, column: 8 },
    {
      isCancellationRequested: false,
      onCancellationRequested(listener) {
        const cancel = () => listener(undefined);
        cancellation.add(cancel);
        return {
          dispose() {
            cancellation.delete(cancel);
          },
        };
      },
    }
  );
  await expect.poll(() => f.hover.mock.calls.length).toBe(1);
  for (const listener of cancellation) listener();
  expect(await request).toBeNull();
  await expect.poll(() => f.hover.mock.calls[0][1].signal?.aborted).toBe(true);
  pending.resolve(ok({ contents: 'late' }));
  expect(f.services.status(f.ref)?.phase).toBe('ready');
  expect(cancellation.size).toBe(0);
});

it('isolates two language servers in one workspace and derives their labels from the catalog', async () => {
  const f = fixture(false, LOCAL_HOST_REF, [
    ...languageServers,
    {
      id: 'example',
      name: 'Example language',
      languages: [{ languageId: 'example', monacoLanguageId: 'plaintext', extensions: ['ex'] }],
    },
  ]);
  const ref = file('/workspace/other.ex');
  cleanup.push(
    f.services.registerContext(ref, file('/workspace'), { projectId: 'project', taskId: 'task' })
  );
  const model = monaco.editor.createModel(
    'example',
    'plaintext',
    monaco.Uri.parse(encodeFacetUri(ref, { kind: 'buffer' }))
  );
  cleanup.push(() => model.dispose());
  await f.services.hover(f.model, { lineNumber: 1, column: 1 }, token);
  await f.services.hover(model, { lineNumber: 1, column: 1 }, token);
  expect(
    f.syncDocument.mock.calls
      .map(([input]) => (input as { session: { serverId: string } }).session.serverId)
      .sort()
  ).toEqual(['example', 'typescript']);
  expect(f.services.status(ref)?.serverName).toBe('Example language');
  await f.services.restart(ref);
  expect(f.restart).toHaveBeenCalledWith(
    expect.objectContaining({ serverId: 'example' }),
    expect.anything()
  );
});

it('uses the project root discovered by the file host', async () => {
  const f = fixture();
  const project = file('/workspace/nested');
  f.resolveProject.mockResolvedValue(ok(project.path));
  await f.services.hover(f.model, { lineNumber: 1, column: 1 }, token);
  expect(f.resolveProject).toHaveBeenCalledWith(
    expect.objectContaining({
      host: LOCAL_HOST_REF,
      path: f.ref.path,
      workspaceRoot: file('/workspace').path,
      serverId: 'typescript',
    }),
    expect.anything()
  );
  expect(f.syncDocument).toHaveBeenCalledWith(
    expect.objectContaining({ session: expect.objectContaining({ root: project.path }) }),
    expect.anything()
  );
});

it('does not start a session after its document closes during root discovery', async () => {
  const f = fixture();
  const resolution = deferred<ReturnType<typeof ok<ReturnType<typeof file>['path']>>>();
  f.resolveProject.mockImplementation(() => resolution.promise);
  await expect.poll(() => f.resolveProject.mock.calls.length).toBe(1);
  f.model.dispose();
  resolution.resolve(ok(file('/workspace').path));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(f.syncDocument).not.toHaveBeenCalled();
  expect(f.services.status(f.ref)).toBeUndefined();
});

it('flushes a sibling whose project discovery is still pending before answering a query', async () => {
  const f = fixture();
  await f.services.hover(f.model, { lineNumber: 1, column: 1 }, token);
  const resolution = deferred<ReturnType<typeof ok<ReturnType<typeof file>['path']>>>();
  f.resolveProject.mockImplementationOnce(() => resolution.promise);
  const ref = file('/workspace/sibling.ts');
  cleanup.push(
    f.services.registerContext(ref, file('/workspace'), { projectId: 'project', taskId: 'task' })
  );
  const model = monaco.editor.createModel(
    'unsaved sibling',
    'typescript',
    monaco.Uri.parse(encodeFacetUri(ref, { kind: 'buffer' }))
  );
  cleanup.push(() => model.dispose());
  await expect.poll(() => f.resolveProject.mock.calls.length).toBe(2);
  f.hover.mockClear();
  const query = f.services.hover(f.model, { lineNumber: 1, column: 1 }, token);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(f.hover).not.toHaveBeenCalled();
  resolution.resolve(ok(file('/workspace').path));
  await query;
  expect(f.syncDocument).toHaveBeenLastCalledWith(
    expect.objectContaining({
      document: expect.objectContaining({ path: ref.path, text: 'unsaved sibling' }),
    }),
    expect.anything()
  );
  expect(f.hover).toHaveBeenCalledTimes(1);
});

it('does not read an unchanged Monaco buffer when issuing another query', async () => {
  const f = fixture();
  await f.services.hover(f.model, { lineNumber: 1, column: 1 }, token);
  const read = vi.spyOn(f.model, 'getValue');
  await f.services.hover(f.model, { lineNumber: 1, column: 1 }, token);
  expect(read).not.toHaveBeenCalled();
  read.mockRestore();
});
