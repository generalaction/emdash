import { LOCAL_HOST_REF, hostRef, type HostRef } from '@emdash/core/primitives/host/api';
import { hostFileRef, parseNativeAbsolute } from '@emdash/core/primitives/path/api';
import {
  languageServers,
  type LanguageServerDefinition,
  type LspState,
  type LspHover,
  type LspError,
} from '@emdash/core/runtimes/lsp/api';
import { ok, type Result } from '@emdash/shared';
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
import { configureMonacoLanguages } from '../monaco/monaco-config';
import { MonacoLanguageServices } from './monaco-language-services';

// Monaco cancels its own worker requests when a test disposes an editor.
addEventListener('unhandledrejection', (event) => {
  if (event.reason instanceof Error && event.reason.name === 'Canceled') event.preventDefault();
});
configureMonacoLanguages(monaco);
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
  const setDocumentSnapshot = vi.fn(async (_input: unknown) => ok(undefined));
  const resolveProjectRoot = vi.fn(
    async (input: { workspaceRoot: ReturnType<typeof file>['path'] }) => ok(input.workspaceRoot)
  );
  const applyDocumentEdit = vi.fn(async () => ok(undefined));
  const restartServer = vi.fn(async () => ok(undefined));
  const closeDocument = vi.fn(async () => ok(undefined));
  const hover = vi.fn(
    async (_input: unknown, _meta: CallMeta): Promise<Result<LspHover, LspError>> =>
      ok({ contents: '**string**' })
  );
  const references = vi.fn(async (_input: unknown) => ok([]));
  const onError = vi.fn();
  const target = file('/outside/dependency.d.ts', host);
  const wire = createTestWire(
    editorLspContract,
    {
      session: expose(editorLspContract.session, { current: state }, { scope }),
      setDocumentSnapshot,
      resolveProjectRoot,
      applyDocumentEdit,
      closeDocument,
      documentSaved: async () => ok(undefined),
      restartServer,
      hover,
      definition: async () =>
        ok([
          {
            path: target.path,
            range: { start: { line: 5, character: 2 }, end: { line: 5, character: 8 } },
          },
        ]),
      typeDefinition: async () => ok([]),
      references,
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
    onError,
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
    setDocumentSnapshot,
    closeDocument,
    hover,
    open,
    resolveProjectRoot,
    applyDocumentEdit,
    restartServer,
    references,
    onError,
  };
}

describe('Monaco language services', () => {
  it('keeps completion and formatting enabled while the editor routes overlapping providers', () => {
    for (const defaults of [
      monaco.typescript.typescriptDefaults,
      monaco.typescript.javascriptDefaults,
    ]) {
      expect(defaults.modeConfiguration).toMatchObject({
        hovers: false,
        definitions: false,
        references: false,
        diagnostics: false,
        completionItems: true,
        documentRangeFormattingEdits: true,
      });
    }
    for (const defaults of [
      monaco.css.cssDefaults,
      monaco.css.scssDefaults,
      monaco.css.lessDefaults,
      monaco.html.htmlDefaults,
      monaco.json.jsonDefaults,
    ]) {
      expect(defaults.modeConfiguration).toMatchObject({
        hovers: false,
        diagnostics: false,
        completionItems: true,
        documentFormattingEdits: true,
      });
    }
    expect(monaco.css.cssDefaults.modeConfiguration).toMatchObject({
      definitions: false,
      references: false,
    });
  });
  it('registers selectors using Monaco IDs, including shell and JSONC', () => {
    const register = vi.spyOn(monaco.languages, 'registerHoverProvider');
    const f = fixture();
    const selectors = register.mock.calls.at(-1)?.[0];
    expect(selectors).toEqual(
      expect.arrayContaining([
        { language: 'shell' },
        { language: 'json' },
        { language: 'python' },
        { language: 'go' },
        { language: 'rust' },
      ])
    );
    expect(f.model.getLanguageId()).toBe('typescript');
    register.mockRestore();
  });
  it('synchronizes unsaved text before hover and converts one-based positions', async () => {
    const f = fixture();
    f.model.setValue('const value = "unsaved";');
    const result = await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
    expect(result?.contents).toEqual([{ value: '**string**', isTrusted: false }]);
    expect(f.setDocumentSnapshot).toHaveBeenLastCalledWith(
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
    expect(f.setDocumentSnapshot).toHaveBeenCalledTimes(1);
    const queries = f.hover.mock.calls.length;
    await f.services.hover(disk, { lineNumber: 1, column: 1 }, token);
    expect(f.hover).toHaveBeenCalledTimes(queries);
    editors[0].dispose();
    expect(f.closeDocument).not.toHaveBeenCalled();
  });
  it('maps definitions outside the workspace back to the source host', async () => {
    const f = fixture();
    const locations = await f.services.definition(f.model, { lineNumber: 1, column: 8 }, token);
    expect(locations?.[0]).toMatchObject({
      range: { startLineNumber: 6, startColumn: 3, endLineNumber: 6, endColumn: 9 },
    });
    expect(locations?.[0].uri.toString()).toBe(encodeFacetUri(f.target, { kind: 'buffer' }));
  });
  it('publishes host diagnostics and clears them on edits, failure and disposal', async () => {
    const f = fixture();
    await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
    const ready = {
      phase: 'ready' as const,
      generation: 'one',
      capabilities: { hover: true, definition: true, typeDefinition: true, references: true },
    };
    const publishDiagnostics = () =>
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
    publishDiagnostics();
    await expect
      .poll(() =>
        monaco.editor.getModelMarkers({ resource: f.model.uri }).map((marker) => marker.message)
      )
      .toEqual(['Type mismatch']);
    f.model.setValue('const value = 2;');
    expect(monaco.editor.getModelMarkers({ resource: f.model.uri })).toEqual([]);
    publishDiagnostics();
    await expect
      .poll(() => monaco.editor.getModelMarkers({ resource: f.model.uri }).length)
      .toBe(1);
    f.state.set({ ...ready, phase: 'failed', error: 'disconnected', diagnostics: [] });
    await expect
      .poll(() => f.services.status(f.ref)?.connection)
      .toMatchObject({ kind: 'connected', server: { phase: 'failed' } });
    expect(monaco.editor.getModelMarkers({ resource: f.model.uri })).toEqual([]);
    publishDiagnostics();
    await expect
      .poll(() => monaco.editor.getModelMarkers({ resource: f.model.uri }).length)
      .toBe(1);
    await f.services.dispose();
    expect(monaco.editor.getModelMarkers({ resource: f.model.uri })).toEqual([]);
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
    const before = f.setDocumentSnapshot.mock.calls.length;
    f.state.set({
      phase: 'ready',
      generation: 'two',
      capabilities: { hover: true, definition: true, typeDefinition: true, references: true },
      diagnostics: [],
    });
    await expect.poll(() => f.setDocumentSnapshot.mock.calls.length).toBeGreaterThan(before);
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
  await expect
    .poll(() => f.services.status(f.ref)?.connection)
    .toMatchObject({ kind: 'disconnected' });
  await f.services.restartServer(f.ref);
  const result = await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
  expect(result?.contents[0].value).toBe('**string**');
});

it('replays documents when a replacement worker transitions through starting', async () => {
  const f = fixture();
  await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
  const before = f.setDocumentSnapshot.mock.calls.length;
  const capabilities = { hover: true, definition: true, typeDefinition: true, references: true };
  f.state.set({ phase: 'starting', generation: 'new-worker', capabilities, diagnostics: [] });
  await expect
    .poll(() => f.services.status(f.ref)?.connection)
    .toMatchObject({ kind: 'connected', server: { phase: 'starting' } });
  f.state.set({ phase: 'ready', generation: 'new-worker', capabilities, diagnostics: [] });
  await expect.poll(() => f.setDocumentSnapshot.mock.calls.length).toBeGreaterThan(before);
});

it('keeps definitions on the remote host even when an identical local path is open', async () => {
  const local = fixture();
  const remote = fixture(false, hostRef('remote', 'server'));
  const result = await remote.services.definition(
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
  expect(f.services.status(f.ref)?.connection).toMatchObject({
    kind: 'connected',
    server: { phase: 'ready' },
  });
  expect(cancellation.size).toBe(0);
});

it('isolates two language servers in one workspace and derives their labels from the catalog', async () => {
  const f = fixture(false, LOCAL_HOST_REF, [
    ...languageServers,
    {
      id: 'example',
      name: 'Example language',
      languages: [{ languageId: 'example', extensions: ['ex'] }],
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
    f.setDocumentSnapshot.mock.calls
      .map(([input]) => (input as { session: { serverId: string } }).session.serverId)
      .sort()
  ).toEqual(['example', 'typescript']);
  expect(f.services.status(ref)?.serverName).toBe('Example language');
  await f.services.restartServer(ref);
  expect(f.restartServer).toHaveBeenCalledWith(
    expect.objectContaining({ serverId: 'example' }),
    expect.anything()
  );
});

it('uses the project root discovered by the file host', async () => {
  const f = fixture();
  const project = file('/workspace/nested');
  f.resolveProjectRoot.mockResolvedValue(ok(project.path));
  await f.services.hover(f.model, { lineNumber: 1, column: 1 }, token);
  expect(f.resolveProjectRoot).toHaveBeenCalledWith(
    expect.objectContaining({
      host: LOCAL_HOST_REF,
      path: f.ref.path,
      workspaceRoot: file('/workspace').path,
      serverId: 'typescript',
    }),
    expect.anything()
  );
  expect(f.setDocumentSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ session: expect.objectContaining({ root: project.path }) }),
    expect.anything()
  );
});

it('does not start a session after its document closes during root discovery', async () => {
  const f = fixture();
  const resolution = deferred<ReturnType<typeof ok<ReturnType<typeof file>['path']>>>();
  f.resolveProjectRoot.mockImplementation(() => resolution.promise);
  await expect.poll(() => f.resolveProjectRoot.mock.calls.length).toBe(1);
  f.model.dispose();
  resolution.resolve(ok(file('/workspace').path));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(f.setDocumentSnapshot).not.toHaveBeenCalled();
  expect(f.services.status(f.ref)).toBeUndefined();
});

it('flushes a sibling whose project discovery is still pending before answering a query', async () => {
  const f = fixture();
  await f.services.hover(f.model, { lineNumber: 1, column: 1 }, token);
  const resolution = deferred<ReturnType<typeof ok<ReturnType<typeof file>['path']>>>();
  f.resolveProjectRoot.mockImplementationOnce(() => resolution.promise);
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
  await expect.poll(() => f.resolveProjectRoot.mock.calls.length).toBe(2);
  f.hover.mockClear();
  const query = f.services.hover(f.model, { lineNumber: 1, column: 1 }, token);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(f.hover).not.toHaveBeenCalled();
  resolution.resolve(ok(file('/workspace').path));
  await query;
  expect(f.setDocumentSnapshot).toHaveBeenLastCalledWith(
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

it('forwards reference context without claiming a query failure is a server failure', async () => {
  const f = fixture();
  await f.services.references(
    f.model,
    { lineNumber: 1, column: 1 },
    { includeDeclaration: false },
    token
  );
  expect(f.references).toHaveBeenCalledWith(
    expect.objectContaining({ includeDeclaration: false }),
    expect.anything()
  );
  f.hover.mockRejectedValueOnce(new Error('request failed'));
  expect(await f.services.hover(f.model, { lineNumber: 1, column: 1 }, token)).toBeNull();
  expect(f.onError).toHaveBeenCalledTimes(1);
  expect(f.services.status(f.ref)?.connection).toMatchObject({
    kind: 'connected',
    server: { phase: 'ready' },
  });
});

it('falls back to local hover, definitions, references and syntax diagnostics when the host is offline', async () => {
  const f = fixture(true);
  f.model.setValue('const localValue = 42;\nlocalValue;');
  await expect.poll(() => f.services.status(f.ref)?.connection.kind).toBe('disconnected');
  const position = { lineNumber: 2, column: 3 };
  expect(JSON.stringify(await f.services.hover(f.model, position, token))).toContain('localValue');
  const definitions = await f.services.definition(f.model, position, token);
  expect(definitions?.[0]).toMatchObject({ uri: f.model.uri, range: { startLineNumber: 1 } });
  expect(
    await f.services.references(f.model, position, { includeDeclaration: true }, token)
  ).toHaveLength(2);
  f.model.setValue('const broken = ;');
  await expect
    .poll(() => monaco.editor.getModelMarkers({ resource: f.model.uri }).length)
    .toBeGreaterThan(0);
  expect(f.hover).not.toHaveBeenCalled();
});

it('keeps local and remote availability independent and switches back after recovery', async () => {
  const local = fixture();
  const remote = fixture(true, hostRef('remote', 'offline'));
  remote.model.setValue('const remoteValue = 42;\nremoteValue;');
  await expect.poll(() => remote.services.status(remote.ref)?.connection.kind).toBe('disconnected');
  const position = { lineNumber: 2, column: 3 };
  expect(JSON.stringify(await remote.services.hover(remote.model, position, token))).toContain(
    'remoteValue'
  );
  expect(
    (await local.services.hover(local.model, { lineNumber: 1, column: 8 }, token))?.contents
  ).toEqual([{ value: '**string**', isTrusted: false }]);
  await remote.services.restartServer(remote.ref);
  expect((await remote.services.hover(remote.model, position, token))?.contents).toEqual([
    { value: '**string**', isTrusted: false },
  ]);
});

it.each(['starting', 'failed'] as const)(
  'uses local services while the server is %s',
  async (phase) => {
    const f = fixture();
    f.model.setValue('const localValue = 42;\nlocalValue;');
    const ready = {
      phase: 'ready' as const,
      generation: 'one',
      capabilities: { hover: true, definition: true, typeDefinition: true, references: true },
      diagnostics: [],
    };
    f.state.set({ ...ready, phase });
    await expect
      .poll(() => f.services.status(f.ref)?.connection)
      .toMatchObject({ kind: 'connected', server: { phase } });
    expect(
      JSON.stringify(await f.services.hover(f.model, { lineNumber: 2, column: 3 }, token))
    ).toContain('localValue');
    expect(f.hover).not.toHaveBeenCalled();
  }
);

it('falls back for unsupported capabilities and preserves successful empty host answers', async () => {
  const f = fixture();
  f.model.setValue('const localValue = 42;\nlocalValue;');
  const position = { lineNumber: 2, column: 3 };
  const ready = {
    phase: 'ready' as const,
    generation: 'one',
    capabilities: { hover: true, definition: true, typeDefinition: true, references: true },
    diagnostics: [],
  };
  f.state.set({ ...ready, capabilities: { ...ready.capabilities, hover: false } });
  expect(JSON.stringify(await f.services.hover(f.model, position, token))).toContain('localValue');
  expect(f.hover).not.toHaveBeenCalled();
  expect(
    await f.services.references(f.model, position, { includeDeclaration: true }, token)
  ).toEqual([]);
  f.state.set(ready);
  await expect
    .poll(() => f.services.status(f.ref)?.connection)
    .toMatchObject({ kind: 'connected', server: { capabilities: { hover: true } } });
  f.hover.mockResolvedValueOnce(ok(null));
  expect(await f.services.hover(f.model, position, token)).toBeNull();
  expect(f.onError).not.toHaveBeenCalled();
});

it('uses local queries for snapshots without opening them on a host', async () => {
  const f = fixture();
  const model = monaco.editor.createModel(
    'const diskValue = 42;\ndiskValue;',
    'typescript',
    monaco.Uri.parse(encodeFacetUri(f.ref, { kind: 'disk' }))
  );
  cleanup.push(() => model.dispose());
  expect(
    JSON.stringify(await f.services.hover(model, { lineNumber: 2, column: 3 }, token))
  ).toContain('diskValue');
  expect(f.hover).not.toHaveBeenCalled();
});
import { MonacoLanguageFallback } from '../monaco/monaco-language-fallback';
it('cancels a pending local fallback without waiting for the worker response', async () => {
  const f = fixture(true);
  await expect.poll(() => f.services.status(f.ref)?.connection.kind).toBe('disconnected');
  const pending = deferred<monaco.languages.Hover | null>();
  const fallback = vi
    .spyOn(MonacoLanguageFallback.prototype, 'hover')
    .mockReturnValueOnce(pending.promise);
  const cancellation = new monaco.CancellationTokenSource();
  cleanup.push(
    () => fallback.mockRestore(),
    () => cancellation.dispose()
  );
  const request = f.services.hover(f.model, { lineNumber: 1, column: 8 }, cancellation.token);
  await expect.poll(() => fallback.mock.calls.length).toBe(1);
  cancellation.cancel();
  expect(await request).toBeNull();
  pending.resolve({ contents: [{ value: 'late local' }] });
  expect(f.onError).not.toHaveBeenCalled();
});

it('discards a pending fallback answer when the host recovers', async () => {
  const f = fixture(true);
  await expect.poll(() => f.services.status(f.ref)?.connection.kind).toBe('disconnected');
  const pending = deferred<monaco.languages.Hover | null>();
  const fallback = vi
    .spyOn(MonacoLanguageFallback.prototype, 'hover')
    .mockReturnValueOnce(pending.promise);
  cleanup.push(() => fallback.mockRestore());
  const request = f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
  await expect.poll(() => fallback.mock.calls.length).toBe(1);
  await f.services.restartServer(f.ref);
  await expect
    .poll(() => f.services.status(f.ref)?.connection)
    .toMatchObject({
      kind: 'connected',
      server: { phase: 'ready' },
    });
  pending.resolve({ contents: [{ value: 'obsolete fallback' }] });
  expect(await request).toBeNull();
  expect((await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token))?.contents).toEqual([
    { value: '**string**', isTrusted: false },
  ]);
});

it('keeps host diagnostic ownership after edits until the server becomes unavailable', async () => {
  const f = fixture();
  await f.services.hover(f.model, { lineNumber: 1, column: 8 }, token);
  const fallback = vi.spyOn(MonacoLanguageFallback.prototype, 'diagnostics');
  cleanup.push(() => fallback.mockRestore());
  f.model.setValue('const broken = ;');
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(fallback).not.toHaveBeenCalled();
  expect(monaco.editor.getModelMarkers({ resource: f.model.uri })).toEqual([]);
  f.state.set({
    phase: 'failed',
    generation: 'one',
    capabilities: { hover: true, definition: true, typeDefinition: true, references: true },
    error: 'server stopped',
    diagnostics: [],
  });
  await expect
    .poll(() => monaco.editor.getModelMarkers({ resource: f.model.uri }).length)
    .toBeGreaterThan(0);
});

it('does not claim fallback support for Python', async () => {
  const f = fixture(true);
  const ref = file('/workspace/script.py');
  cleanup.push(
    f.services.registerContext(ref, file('/workspace'), { projectId: 'project', taskId: 'task' })
  );
  const model = monaco.editor.createModel(
    'value = 42',
    'python',
    monaco.Uri.parse(encodeFacetUri(ref, { kind: 'buffer' }))
  );
  cleanup.push(() => model.dispose());
  expect(f.services.status(f.ref)?.fallbackAvailable).toBe(true);
  expect(f.services.status(ref)?.fallbackAvailable).toBe(false);
});

it('filters other hosts and snapshot facets out of fallback navigation', async () => {
  const f = fixture(true);
  await expect.poll(() => f.services.status(f.ref)?.connection.kind).toBe('disconnected');
  const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 };
  const fallback = vi.spyOn(MonacoLanguageFallback.prototype, 'definition').mockResolvedValueOnce([
    { uri: f.model.uri, range },
    {
      uri: monaco.Uri.parse(
        encodeFacetUri(file('/workspace/a.ts', hostRef('remote', 'other')), { kind: 'buffer' })
      ),
      range,
    },
    { uri: monaco.Uri.parse(encodeFacetUri(f.ref, { kind: 'disk' })), range },
  ]);
  cleanup.push(() => fallback.mockRestore());
  expect(await f.services.definition(f.model, { lineNumber: 1, column: 8 }, token)).toEqual([
    { uri: f.model.uri, range },
  ]);
});
