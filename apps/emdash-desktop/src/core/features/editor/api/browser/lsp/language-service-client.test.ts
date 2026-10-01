import { LOCAL_HOST_REF, hostRef, type HostRef } from '@emdash/core/primitives/host/api';
import { hostFileRef, parseNativeAbsolute } from '@emdash/core/primitives/path/api';
import {
  languageServers,
  type LspState,
  type LspHover,
  type LspError,
} from '@emdash/core/runtimes/lsp/api';
import { ok, err, type Result } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import { cell, expose } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorLspContract } from '../../lsp-contract';
import { LanguageServiceClient } from './language-service-client';

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function file(path: string, host: HostRef = LOCAL_HOST_REF) {
  const parsed = parseNativeAbsolute(path);
  if (!parsed.success) throw new Error('Invalid test path');
  return hostFileRef(host, parsed.data);
}
function fixture() {
  const scope = createScope();
  cleanups.push(() => scope.dispose());
  const ready: LspState = {
    phase: 'ready',
    generation: 'one',
    diagnostics: [],
    capabilities: { hover: true, definition: true, typeDefinition: true, references: true },
  };
  const state = cell(ready);
  const resolveProjectRoot = vi.fn(
    async (input: { workspaceRoot: ReturnType<typeof file>['path'] }) => ok(input.workspaceRoot)
  );
  const setDocumentSnapshot = vi.fn(async (_input: unknown) => ok(undefined));
  const applyDocumentEdit = vi.fn(async (_input: unknown) => ok(undefined));
  const closeDocument = vi.fn(async (_input: unknown) => ok(undefined));
  const restartServer = vi.fn(async (_input: unknown) => ok(undefined));
  const hover = vi.fn(
    async (_input: unknown): Promise<Result<LspHover, LspError>> =>
      ok({ contents: 'type information' })
  );
  const references = vi.fn(async (_input: unknown) => ok([]));
  const documentSaved = vi.fn(async (_input: unknown) => ok(undefined));
  const wire = createTestWire(
    editorLspContract,
    {
      session: expose(editorLspContract.session, { current: state }, { scope, lingerMs: 0 }),
      resolveProjectRoot,
      setDocumentSnapshot,
      applyDocumentEdit,
      closeDocument,
      restartServer,
      hover,
      references,
      documentSaved,
      definition: async () => ok([]),
      typeDefinition: async () => ok([]),
    },
    { validate: 'full' }
  );
  cleanups.push(() => wire.dispose());
  const onError = vi.fn();
  const getClient = vi.fn(async () => wire.client);
  const service = new LanguageServiceClient({
    client: getClient,
    onError,
    servers: [
      ...languageServers,
      {
        id: 'example',
        name: 'Example',
        languages: [{ languageId: 'example', extensions: ['ex'] }],
      },
    ],
  });
  cleanups.push(() => service.dispose());
  function bind(path = '/workspace/a.ts', host: HostRef = LOCAL_HOST_REF) {
    const source = {
      ref: file(path, host),
      workspaceRoot: file('/workspace', host),
      getVersion: vi.fn(() => 1),
      getText: vi.fn(() => 'unsaved text'),
      onDiagnostics: vi.fn(),
    };
    const binding = service.bindDocument(source);
    if (!binding) throw new Error('Expected a supported document');
    return { source, binding };
  }
  return {
    bind,
    service,
    state,
    ready,
    onError,
    getClient,
    resolveProjectRoot,
    setDocumentSnapshot,
    applyDocumentEdit,
    closeDocument,
    restartServer,
    hover,
    references,
    documentSaved,
  };
}
const position = { line: 0, character: 1 };

describe('language service client', () => {
  it('discovers roots and shares a session for documents in the same language project', async () => {
    const f = fixture();
    f.resolveProjectRoot.mockResolvedValue(ok(file('/workspace/nested').path));
    const a = f.bind();
    const b = f.bind('/workspace/b.ts');
    await a.binding.hover(position);
    const inputs = f.setDocumentSnapshot.mock.calls.map(([input]) => input as { session: unknown });
    expect(inputs).toHaveLength(2);
    expect(inputs[0].session).toEqual(inputs[1].session);
    expect(inputs[0].session).toMatchObject({ root: file('/workspace/nested').path });
    await a.binding.dispose();
    expect(await b.binding.hover(position)).toEqual({ contents: 'type information' });
    expect(f.setDocumentSnapshot).toHaveBeenCalledTimes(2);
  });
  it('isolates hosts and server types, including identical paths', async () => {
    const f = fixture();
    const bindings = [
      f.bind(),
      f.bind('/workspace/a.ts', hostRef('remote', 'remote')),
      f.bind('/workspace/a.ex'),
    ];
    for (const { binding } of bindings) await binding.hover(position);
    const sessions = f.setDocumentSnapshot.mock.calls.map(
      ([input]) => (input as { session: unknown }).session
    );
    expect(new Set(sessions.map((value) => JSON.stringify(value))).size).toBe(3);
    expect(bindings[2].binding.status.serverName).toBe('Example');
  });
  it('flushes pending sibling discovery and edits before a query', async () => {
    const f = fixture();
    const a = f.bind();
    await a.binding.hover(position);
    const pending = deferred<ReturnType<typeof ok<ReturnType<typeof file>['path']>>>();
    f.resolveProjectRoot.mockImplementationOnce(() => pending.promise);
    const b = f.bind('/workspace/b.ts');
    await expect.poll(() => f.resolveProjectRoot.mock.calls.length).toBe(2);
    f.hover.mockClear();
    const query = a.binding.hover(position);
    await Promise.resolve();
    expect(f.hover).not.toHaveBeenCalled();
    b.source.getText.mockReturnValue('unsaved sibling');
    pending.resolve(ok(file('/workspace').path));
    await query;
    expect(f.setDocumentSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({ document: expect.objectContaining({ text: 'unsaved sibling' }) }),
      expect.anything()
    );
  });
  it('cancels a query promptly while discovery remains pending', async () => {
    const f = fixture();
    const pending = deferred<ReturnType<typeof ok<ReturnType<typeof file>['path']>>>();
    f.resolveProjectRoot.mockImplementation(() => pending.promise);
    const { binding } = f.bind();
    const abort = new AbortController();
    const query = binding.hover(position, abort.signal);
    abort.abort();
    expect(await query).toBeNull();
    expect(f.hover).not.toHaveBeenCalled();
    pending.resolve(ok(file('/workspace').path));
  });
  it('discards a late resolution after disposal without acquiring a session', async () => {
    const f = fixture();
    const pending = deferred<ReturnType<typeof ok<ReturnType<typeof file>['path']>>>();
    f.resolveProjectRoot.mockImplementation(() => pending.promise);
    const { binding } = f.bind();
    await expect.poll(() => f.resolveProjectRoot.mock.calls.length).toBe(1);
    await binding.dispose();
    pending.resolve(ok(file('/workspace').path));
    await Promise.resolve();
    await Promise.resolve();
    expect(f.setDocumentSnapshot).not.toHaveBeenCalled();
    expect(f.hover).not.toHaveBeenCalled();
  });
  it('reports request failures without changing server health or diagnostics', async () => {
    const f = fixture();
    const { binding, source } = f.bind();
    await binding.hover(position);
    const diagnostics = [{ message: 'existing', range: { start: position, end: position } }];
    f.state.set({ ...f.ready, diagnostics: [{ path: source.ref.path, version: 1, diagnostics }] });
    await expect.poll(() => source.onDiagnostics.mock.calls.at(-1)?.[0]).toEqual(diagnostics);
    f.hover.mockResolvedValueOnce(
      err({ type: 'request-failed', message: 'single request failed' })
    );
    await expect(binding.hover(position)).rejects.toThrow('single request failed');
    expect(binding.status.connection).toMatchObject({
      kind: 'connected',
      server: { phase: 'ready' },
    });
    expect(source.onDiagnostics.mock.calls.at(-1)?.[0]).toEqual(diagnostics);
    expect(await binding.hover(position)).toEqual({ contents: 'type information' });
  });
  it.each(['stale-query', 'cancelled'] as const)(
    'discards %s results without changing server health',
    async (type) => {
      const f = fixture();
      const { binding } = f.bind();
      await binding.hover(position);
      f.hover.mockResolvedValueOnce(err({ type, message: 'obsolete result' }));
      expect(await binding.hover(position)).toBeNull();
      expect(binding.status.connection).toMatchObject({
        kind: 'connected',
        server: { phase: 'ready' },
      });
      expect(f.onError).not.toHaveBeenCalled();
    }
  );
  it('keeps server failures distinct from a disconnected host', async () => {
    const f = fixture();
    const { binding } = f.bind();
    await binding.hover(position);
    f.state.set({ ...f.ready, phase: 'failed', error: 'server exited' });
    await expect
      .poll(() => binding.status.connection)
      .toMatchObject({ kind: 'connected', server: { phase: 'failed', error: 'server exited' } });
  });
  it('retries failed discovery from the restart action', async () => {
    const f = fixture();
    f.getClient.mockRejectedValueOnce(new Error('host offline'));
    const { binding } = f.bind();
    await expect
      .poll(() => binding.status.connection)
      .toMatchObject({ kind: 'disconnected', message: 'host offline' });
    await binding.restartServer();
    expect(await binding.hover(position)).toEqual({ contents: 'type information' });
  });
  it('keeps an attached starting server distinguishable from a ready server', async () => {
    const f = fixture();
    f.state.set({ ...f.ready, phase: 'starting' });
    const { binding } = f.bind();
    await expect
      .poll(() => binding.status.connection)
      .toMatchObject({ kind: 'connected', server: { phase: 'starting' } });
    f.state.set(f.ready);
    await expect
      .poll(() => binding.status.connection)
      .toMatchObject({ kind: 'connected', server: { phase: 'ready' } });
  });
  it('replays snapshots on replacement and avoids reading unchanged buffers', async () => {
    const f = fixture();
    const { binding, source } = f.bind();
    await binding.hover(position);
    source.getText.mockClear();
    await binding.hover(position);
    expect(source.getText).not.toHaveBeenCalled();
    f.state.set({ ...f.ready, generation: 'replacement' });
    await expect.poll(() => f.setDocumentSnapshot.mock.calls.length).toBe(2);
  });
  it('forwards reference options and sends saved after synchronizing the latest text', async () => {
    const f = fixture();
    const { binding, source } = f.bind();
    await binding.references(position, { includeDeclaration: false });
    expect(f.references).toHaveBeenCalledWith(
      expect.objectContaining({ includeDeclaration: false }),
      expect.anything()
    );
    source.getVersion.mockReturnValue(2);
    source.getText.mockReturnValue('saved text');
    binding.changed();
    await binding.documentSaved();
    expect(f.applyDocumentEdit).toHaveBeenCalledTimes(1);
    expect(f.documentSaved.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.applyDocumentEdit.mock.invocationCallOrder[0]
    );
  });
  it('discards results after edits and document disposal', async () => {
    const f = fixture();
    const { binding, source } = f.bind();
    for (const dispose of [false, true]) {
      const pending = deferred<Result<LspHover, LspError>>();
      f.hover.mockImplementationOnce(() => pending.promise);
      const before = f.hover.mock.calls.length;
      const query = binding.hover(position);
      await expect.poll(() => f.hover.mock.calls.length).toBe(before + 1);
      if (dispose) await binding.dispose();
      else {
        source.getVersion.mockReturnValue(2);
        binding.changed();
      }
      pending.resolve(ok({ contents: 'obsolete' }));
      expect(await query).toBeNull();
    }
  });
});

it('coalesces concurrent retries of a failed document attachment', async () => {
  const f = fixture();
  f.getClient.mockRejectedValueOnce(new Error('host offline'));
  const { binding } = f.bind();
  await expect.poll(() => binding.status.connection.kind).toBe('disconnected');
  await Promise.all([binding.restartServer(), binding.restartServer()]);
  await binding.hover(position);
  expect(f.resolveProjectRoot).toHaveBeenCalledTimes(1);
  expect(f.setDocumentSnapshot).toHaveBeenCalledTimes(1);
  await binding.dispose();
  expect(f.closeDocument).toHaveBeenCalledTimes(1);
});

it('does not read a disposed or already cancelled document source', async () => {
  const f = fixture();
  const { binding, source } = f.bind();
  await binding.hover(position);
  const abort = new AbortController();
  abort.abort();
  source.getVersion.mockImplementation(() => {
    throw new Error('Source must not be read');
  });
  expect(await binding.hover(position, abort.signal)).toBeNull();
  await binding.dispose();
  expect(await binding.hover(position)).toBeNull();
});

it('reports background replication errors and retries without changing server health', async () => {
  const f = fixture();
  const { binding, source } = f.bind();
  await binding.hover(position);
  f.applyDocumentEdit.mockRejectedValueOnce(new Error('temporary write failure'));
  source.getVersion.mockReturnValue(2);
  source.getText.mockReturnValue('changed');
  binding.changed();
  await expect.poll(() => f.onError.mock.calls.length).toBe(1);
  expect(binding.status.connection).toMatchObject({
    kind: 'connected',
    server: { phase: 'ready' },
  });
  await binding.hover(position);
  expect(f.applyDocumentEdit).toHaveBeenCalledTimes(2);
});
