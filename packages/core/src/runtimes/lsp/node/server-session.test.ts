import { deferred } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { LanguageServerSession, type LanguageServerTransport } from './server-session';

class TestServer implements LanguageServerTransport {
  readonly messages: Array<{ method: string; params: unknown }> = [];
  readonly notifications = new Set<(method: string, params: unknown) => void>();
  readonly closes = new Set<() => void>();
  capabilities = { textDocumentSync: 2, hoverProvider: true, definitionProvider: true };
  request = vi.fn(
    async (method: string, params: unknown, signal?: AbortSignal): Promise<unknown> => {
      signal?.throwIfAborted();
      this.messages.push({ method, params });
      return method === 'initialize' ? { capabilities: this.capabilities } : null;
    }
  );
  async notify(method: string, params: unknown): Promise<void> {
    this.messages.push({ method, params });
  }
  onNotification(listener: (method: string, params: unknown) => void): () => void {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }
  onClose(listener: () => void): () => void {
    this.closes.add(listener);
    return () => this.closes.delete(listener);
  }
  dispose = vi.fn(async () => {});
  emit(method: string, params: unknown): void {
    for (const listener of this.notifications) listener(method, params);
  }
  crash(): void {
    for (const listener of this.closes) listener();
  }
}

const document = {
  uri: 'file:///workspace/src/a.ts',
  languageId: 'typescript',
  version: 1,
  text: 'export const value = 1;\n',
};

function fixture() {
  const servers: TestServer[] = [];
  const connect = vi.fn(async () => {
    const server = new TestServer();
    servers.push(server);
    return server;
  });
  const session = new LanguageServerSession({ rootUri: 'file:///workspace', connect });
  return { session, servers, connect };
}

describe('language server session', () => {
  it('rolls back a delta when transport delivery fails', async () => {
    const { session, servers } = fixture();
    try {
      await session.syncDocument({ ...document, text: 'old' });
      const change = {
        uri: document.uri,
        baseVersion: 1,
        version: 2,
        edit: { start: 0, deleteCount: 3, text: 'new' },
      };
      vi.spyOn(servers[0], 'notify').mockRejectedValueOnce(new Error('delivery failed'));
      await expect(session.changeDocument(change)).rejects.toThrow('delivery failed');
      await session.changeDocument(change);
      await session.restart();
      expect(servers[1].messages.at(-1)?.params).toMatchObject({
        textDocument: { version: 2, text: 'new' },
      });
    } finally {
      await session.dispose();
    }
  });
  it('applies versioned edits and replays the resulting text on restart', async () => {
    const { session, servers } = fixture();
    try {
      await session.syncDocument({ ...document, text: 'a\r\n😀old' });
      await session.changeDocument({
        uri: document.uri,
        baseVersion: 1,
        version: 2,
        edit: { start: 5, deleteCount: 3, text: 'new' },
      });
      expect(servers[0].messages.at(-1)?.params).toEqual({
        textDocument: { uri: document.uri, version: 2 },
        contentChanges: [
          {
            range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } },
            text: 'new',
          },
        ],
      });
      await session.restart();
      expect(servers[1].messages.at(-1)?.params).toMatchObject({
        textDocument: { text: 'a\r\n😀new', version: 2 },
      });
    } finally {
      await session.dispose();
    }
  });
  it('rejects missing or mismatched edit bases without corrupting the document', async () => {
    const { session, servers } = fixture();
    const change = {
      uri: document.uri,
      baseVersion: 1,
      version: 2,
      edit: { start: 0, deleteCount: 0, text: 'prefix' },
    };
    try {
      await expect(session.changeDocument(change)).rejects.toThrow(/synchroniz/i);
      await session.syncDocument({ ...document, version: 3 });
      await expect(session.changeDocument(change)).rejects.toThrow(/synchroniz/i);
      await session.restart();
      expect(servers[1].messages.at(-1)?.params).toMatchObject({
        textDocument: { text: document.text, version: 3 },
      });
    } finally {
      await session.dispose();
    }
  });
  it('expands patches for servers that require full-document synchronization', async () => {
    const { session, servers } = fixture();
    try {
      await session.syncDocument({ ...document, text: 'old' });
      servers[0].capabilities.textDocumentSync = 1;
      await session.changeDocument({
        uri: document.uri,
        baseVersion: 1,
        version: 2,
        edit: { start: 0, deleteCount: 3, text: 'new' },
      });
      expect(servers[0].messages.at(-1)?.params).toMatchObject({
        contentChanges: [{ text: 'new' }],
      });
    } finally {
      await session.dispose();
    }
  });
  it('initializes once before opening documents, including concurrent opens', async () => {
    const { session, servers, connect } = fixture();
    try {
      await Promise.all([
        session.syncDocument(document),
        session.syncDocument({ ...document, uri: 'file:///workspace/b.ts' }),
      ]);
      expect(connect).toHaveBeenCalledTimes(1);
      expect(servers[0].messages.map((m) => m.method)).toEqual([
        'initialize',
        'initialized',
        'textDocument/didOpen',
        'textDocument/didOpen',
      ]);
      expect(servers[0].messages[0].params).toMatchObject({
        rootUri: 'file:///workspace',
        capabilities: {
          general: { positionEncodings: ['utf-16'] },
          workspace: { applyEdit: false },
        },
      });
    } finally {
      await session.dispose();
    }
  });

  it('treats repeated versions as idempotent and rejects a version with different text', async () => {
    const { session, servers } = fixture();
    try {
      await session.syncDocument(document);
      await session.syncDocument(document);
      await expect(session.syncDocument({ ...document, text: 'different' })).rejects.toThrow(
        /version/i
      );
      expect(servers[0].messages.filter((m) => m.method === 'textDocument/didOpen')).toHaveLength(
        1
      );
    } finally {
      await session.dispose();
    }
  });

  it('rejects old changes without corrupting the current document', async () => {
    const { session, servers } = fixture();
    try {
      await session.syncDocument({ ...document, version: 3 });
      await expect(session.syncDocument(document)).rejects.toThrow(/version/i);
      expect(servers[0].messages.some((m) => m.method === 'textDocument/didChange')).toBe(false);
    } finally {
      await session.dispose();
    }
  });

  it('sends valid incremental replacements using the previous UTF-16 document range', async () => {
    const { session, servers } = fixture();
    try {
      await session.syncDocument({ ...document, text: 'a\r\n😀x' });
      await session.syncDocument({ ...document, version: 2, text: 'replacement' });
      expect(servers[0].messages.at(-1)).toEqual({
        method: 'textDocument/didChange',
        params: {
          textDocument: { uri: document.uri, version: 2 },
          contentChanges: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 1, character: 3 } },
              text: 'replacement',
            },
          ],
        },
      });
    } finally {
      await session.dispose();
    }
  });

  it('honors full synchronization and save options', async () => {
    const server = new TestServer();
    server.capabilities = { ...server.capabilities, textDocumentSync: 1 };
    const session = new LanguageServerSession({
      rootUri: 'file:///workspace',
      connect: async () => server,
    });
    try {
      await session.syncDocument(document);
      await session.syncDocument({ ...document, version: 2, text: 'new' });
      expect(server.messages.at(-1)).toMatchObject({
        params: { contentChanges: [{ text: 'new' }] },
      });
      await session.saved(document.uri);
      expect(server.messages.some((m) => m.method === 'textDocument/didSave')).toBe(false);
    } finally {
      await session.dispose();
    }
  });

  it('queries the synchronized version and forwards cancellation', async () => {
    const { session, servers } = fixture();
    try {
      const sync = session.syncDocument(document);
      const abort = new AbortController();
      await session.query(
        'textDocument/hover',
        document.uri,
        1,
        { line: 0, character: 13 },
        abort.signal
      );
      await sync;
      expect(servers[0].messages.at(-2)?.method).toBe('textDocument/didOpen');
      expect(servers[0].request).toHaveBeenLastCalledWith(
        'textDocument/hover',
        {
          textDocument: { uri: document.uri },
          position: { line: 0, character: 13 },
        },
        abort.signal
      );
      await expect(
        session.query('textDocument/hover', document.uri, 2, { line: 0, character: 0 })
      ).rejects.toThrow(/version/i);
    } finally {
      await session.dispose();
    }
  });

  it('clears diagnostics when documents close and ignores diagnostics for older versions', async () => {
    const { session, servers } = fixture();
    try {
      await session.syncDocument({ ...document, version: 2 });
      const diagnostic = {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        message: 'error',
      };
      servers[0].emit('textDocument/publishDiagnostics', {
        uri: document.uri,
        version: 2,
        diagnostics: [diagnostic],
      });
      expect(session.current.diagnostics).toHaveLength(1);
      servers[0].emit('textDocument/publishDiagnostics', {
        uri: document.uri,
        version: 1,
        diagnostics: [],
      });
      expect(session.current.diagnostics[0].diagnostics).toHaveLength(1);
      await session.closeDocument(document.uri);
      expect(session.current.diagnostics).toEqual([]);
      expect(servers[0].messages.at(-1)?.method).toBe('textDocument/didClose');
    } finally {
      await session.dispose();
    }
  });

  it('reopens unsaved documents in a fresh generation after a crash', async () => {
    const { session, servers } = fixture();
    try {
      await session.syncDocument(document);
      const generation = session.current.generation;
      servers[0].crash();
      expect(session.current.phase).toBe('failed');
      await session.restart();
      expect(session.current.generation).not.toBe(generation);
      expect(servers[1].messages.at(-1)).toEqual({
        method: 'textDocument/didOpen',
        params: { textDocument: document },
      });
      servers[0].emit('textDocument/publishDiagnostics', {
        uri: document.uri,
        diagnostics: [{ message: 'late' }],
      });
      expect(session.current.diagnostics).toEqual([]);
    } finally {
      await session.dispose();
    }
  });

  it('does not leak a process whose connection completes after disposal', async () => {
    let resolve!: (server: TestServer) => void;
    const server = new TestServer();
    const session = new LanguageServerSession({
      rootUri: 'file:///workspace',
      connect: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    const start = session.start();
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
    const disposed = session.dispose();
    resolve(server);
    await expect(start).rejects.toThrow(/disposed/i);
    await disposed;
    expect(server.dispose).toHaveBeenCalled();
  });

  it('shuts down once and cannot be reopened after disposal', async () => {
    const { session, servers } = fixture();
    await session.syncDocument(document);
    await session.dispose();
    await session.dispose();
    expect(servers[0].messages.slice(-2).map((m) => m.method)).toEqual(['shutdown', 'exit']);
    expect(servers[0].dispose).toHaveBeenCalledTimes(1);
    await expect(session.syncDocument(document)).rejects.toThrow(/disposed/i);
  });
});

describe('language session races', () => {
  it('retains diagnostics published while didOpen is being delivered', async () => {
    const server = new TestServer();
    const notify = server.notify.bind(server);
    server.notify = async (method, params) => {
      await notify(method, params);
      if (method === 'textDocument/didOpen')
        server.emit('textDocument/publishDiagnostics', {
          uri: document.uri,
          version: 1,
          diagnostics: [
            {
              message: 'Immediate diagnostic',
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            },
          ],
        });
    };
    const session = new LanguageServerSession({
      rootUri: 'file:///workspace',
      connect: async () => server,
    });
    try {
      await session.syncDocument(document);
      expect(session.current.diagnostics[0]?.diagnostics[0].message).toBe('Immediate diagnostic');
    } finally {
      await session.dispose();
    }
  });

  it('rejects late query responses after the process exits, before another generation starts', async () => {
    const { session, servers } = fixture();
    try {
      await session.syncDocument(document);
      const response = deferred<unknown>();
      servers[0].request.mockImplementationOnce(() => response.promise);
      const query = session.query('textDocument/hover', document.uri, 1, { line: 0, character: 0 });
      await vi.waitFor(() => expect(servers[0].request).toHaveBeenCalledTimes(2));
      servers[0].crash();
      response.resolve({ contents: 'stale' });
      await expect(query).rejects.toThrow(/generation|disconnect/i);
    } finally {
      await session.dispose();
    }
  });

  it('rejects late query responses after a newer document version arrives', async () => {
    const { session, servers } = fixture();
    try {
      await session.syncDocument(document);
      const response = deferred<unknown>();
      servers[0].request.mockImplementationOnce(() => response.promise);
      const query = session.query('textDocument/hover', document.uri, 1, { line: 0, character: 0 });
      await vi.waitFor(() => expect(servers[0].request).toHaveBeenCalledTimes(2));
      await session.syncDocument({ ...document, version: 2, text: 'new text' });
      response.resolve({ contents: 'stale' });
      await expect(query).rejects.toThrow(/version/i);
    } finally {
      await session.dispose();
    }
  });

  it('retries initialization after a failed launch without retaining the failed transport', async () => {
    const server = new TestServer();
    const connect = vi
      .fn()
      .mockRejectedValueOnce(new Error('missing executable'))
      .mockResolvedValue(server);
    const session = new LanguageServerSession({ rootUri: 'file:///workspace', connect });
    try {
      await expect(session.start()).rejects.toThrow('missing executable');
      expect(session.current.phase).toBe('failed');
      await session.restart();
      expect(session.current.phase).toBe('ready');
      expect(connect).toHaveBeenCalledTimes(2);
    } finally {
      await session.dispose();
    }
  });
});
