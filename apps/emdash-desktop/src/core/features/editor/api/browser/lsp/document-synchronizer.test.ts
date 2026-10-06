import type { LspDocument } from '@emdash/core/runtimes/lsp/api';
import { describe, expect, it, vi } from 'vitest';
import { DocumentSynchronizer } from './document-synchronizer';

function fixture() {
  const path = { root: { kind: 'posix' as const }, segments: ['a.ts'] } as LspDocument['path'];
  let document: LspDocument = { path, languageId: 'typescript', version: 1, text: 'one' };
  const sent: LspDocument[] = [];
  const close = vi.fn(async () => {});
  const documentSaved = vi.fn(async () => {});
  const change = vi.fn(async () => true);
  const getText = vi.fn(() => document.text);
  const source = { path, languageId: 'typescript', getVersion: () => document.version, getText };
  const synchronizer = new DocumentSynchronizer({
    sync: async (value) => {
      sent.push(value);
    },
    change,
    close,
    documentSaved,
    onError: () => {},
    delayMs: 60_000,
  });
  return {
    synchronizer,
    sent,
    close,
    documentSaved,
    source,
    change,
    getText,
    update: (text: string) => {
      document = { ...document, text, version: document.version + 1 };
    },
  };
}

describe('editor document synchronization', () => {
  it('shares one document across consumers and closes it after the last release', async () => {
    const f = fixture();
    const first = f.synchronizer.track('a', f.source);
    const second = f.synchronizer.track('a', f.source);
    await f.synchronizer.flush();
    expect(f.sent).toHaveLength(1);
    await first();
    expect(f.close).not.toHaveBeenCalled();
    await second();
    expect(f.close).toHaveBeenCalledTimes(1);
    await f.synchronizer.dispose();
  });
  it('coalesces typing and flushes all changed buffers before a query', async () => {
    const f = fixture();
    f.synchronizer.track('a', f.source);
    await f.synchronizer.flush();
    f.update('two');
    f.synchronizer.changed();
    f.update('three');
    f.synchronizer.changed();
    await f.synchronizer.flush();
    expect(f.sent.map((d) => d.text)).toEqual(['one']);
    expect(f.change).toHaveBeenCalledWith(expect.objectContaining({ baseVersion: 1, version: 3 }));
    await f.synchronizer.flush();
    expect(f.sent).toHaveLength(1);
    await f.synchronizer.dispose();
  });
  it('replays unchanged documents when a new server generation appears', async () => {
    const f = fixture();
    f.synchronizer.track('a', f.source);
    await f.synchronizer.flush();
    f.synchronizer.invalidate();
    await f.synchronizer.flush();
    expect(f.sent.map((d) => d.version)).toEqual([1, 1]);
    await f.synchronizer.dispose();
  });
  it('does not acknowledge a failed update and retries it on the next flush', async () => {
    const f = fixture();
    const sync = vi
      .fn()
      .mockRejectedValueOnce(new Error('disconnected'))
      .mockResolvedValue(undefined);
    const synchronizer = new DocumentSynchronizer({
      sync,
      change: f.change,
      close: f.close,
      documentSaved: f.documentSaved,
      onError: () => {},
      delayMs: 60_000,
    });
    synchronizer.track('a', f.source);
    await expect(synchronizer.flush()).rejects.toThrow('disconnected');
    await synchronizer.flush();
    expect(sync).toHaveBeenCalledTimes(2);
    await synchronizer.dispose();
    await f.synchronizer.dispose();
  });
  it('orders close and reopen of the same path and sends saved only after synchronization', async () => {
    const f = fixture();
    const release = f.synchronizer.track('a', f.source);
    await f.synchronizer.flush();
    const closing = release();
    f.synchronizer.track('a', f.source);
    await f.synchronizer.documentSaved(f.source.path, 'one');
    await closing;
    expect(f.sent).toHaveLength(2);
    expect(f.close.mock.invocationCallOrder[0]).toBeLessThan(
      f.documentSaved.mock.invocationCallOrder[0]
    );
    await f.synchronizer.dispose();
  });
  it('does not lose edits made while an earlier update is in flight', async () => {
    const f = fixture();
    let complete!: () => void;
    const sync = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            complete = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const synchronizer = new DocumentSynchronizer({
      sync,
      change: f.change,
      close: f.close,
      documentSaved: f.documentSaved,
      onError: () => {},
      delayMs: 60_000,
    });
    synchronizer.track('a', f.source);
    const first = synchronizer.flush();
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    f.update('new');
    synchronizer.changed();
    complete();
    await first;
    await synchronizer.flush();
    expect(sync.mock.calls.map(([document]) => document.text)).toEqual(['one']);
    expect(f.change).toHaveBeenCalledWith(
      expect.objectContaining({
        baseVersion: 1,
        version: 2,
        edit: { start: 0, deleteCount: 3, text: 'new' },
      })
    );
    await synchronizer.dispose();
    await f.synchronizer.dispose();
  });
});

it('never reads text for unchanged versions, including close and save lookup', async () => {
  const f = fixture();
  const release = f.synchronizer.track('a', f.source);
  try {
    await f.synchronizer.flush();
    f.getText.mockClear();
    await f.synchronizer.flush();
    await f.synchronizer.documentSaved(f.source.path, 'one');
    await release();
    expect(f.getText).not.toHaveBeenCalled();
  } finally {
    await f.synchronizer.dispose();
  }
});

it('falls back to a full snapshot only when the host rejects the edit base', async () => {
  const f = fixture();
  f.synchronizer.track('a', f.source);
  try {
    await f.synchronizer.flush();
    f.change.mockResolvedValueOnce(false);
    f.update('two');
    await f.synchronizer.flush();
    expect(f.sent.map((d) => d.text)).toEqual(['one', 'two']);
    f.update('three');
    await f.synchronizer.flush();
    expect(f.change).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseVersion: 2, version: 3 })
    );
  } finally {
    await f.synchronizer.dispose();
  }
});

it('retries a failed delta from the last acknowledged version', async () => {
  const f = fixture();
  f.synchronizer.track('a', f.source);
  try {
    await f.synchronizer.flush();
    f.change.mockRejectedValueOnce(new Error('offline'));
    f.update('two');
    await expect(f.synchronizer.flush()).rejects.toThrow('offline');
    f.update('three');
    await f.synchronizer.flush();
    expect(f.change).toHaveBeenLastCalledWith(
      expect.objectContaining({ baseVersion: 1, version: 3 })
    );
  } finally {
    await f.synchronizer.dispose();
  }
});

it('transfers a tiny edit for a large file', async () => {
  const f = fixture();
  f.update('x'.repeat(100_000) + 'value=1;');
  f.synchronizer.track('a', f.source);
  try {
    await f.synchronizer.flush();
    f.update('x'.repeat(100_000) + 'value=2;');
    await f.synchronizer.flush();
    expect(f.change).toHaveBeenCalledWith(
      expect.objectContaining({ edit: { start: 100_006, deleteCount: 1, text: '2' } })
    );
    expect(f.sent).toHaveLength(1);
  } finally {
    await f.synchronizer.dispose();
  }
});
