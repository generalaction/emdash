import type { LspDocument } from '@emdash/core/runtimes/lsp/api';
import { describe, expect, it, vi } from 'vitest';
import { DocumentSynchronizer } from './document-synchronizer';

function fixture() {
  const path = { root: { kind: 'posix' as const }, segments: ['a.ts'] } as LspDocument['path'];
  let document: LspDocument = { path, languageId: 'typescript', version: 1, text: 'one' };
  const sent: LspDocument[] = [];
  const close = vi.fn(async () => {});
  const saved = vi.fn(async () => {});
  const synchronizer = new DocumentSynchronizer({
    sync: async (value) => {
      sent.push(value);
    },
    close,
    saved,
    onError: () => {},
    delayMs: 60_000,
  });
  return {
    synchronizer,
    sent,
    close,
    saved,
    read: () => document,
    update: (text: string) => {
      document = { ...document, text, version: document.version + 1 };
    },
  };
}

describe('editor document synchronization', () => {
  it('shares one document across consumers and closes it after the last release', async () => {
    const f = fixture();
    const first = f.synchronizer.track('a', f.read);
    const second = f.synchronizer.track('a', f.read);
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
    f.synchronizer.track('a', f.read);
    await f.synchronizer.flush();
    f.update('two');
    f.synchronizer.changed();
    f.update('three');
    f.synchronizer.changed();
    await f.synchronizer.flush();
    expect(f.sent.map((d) => d.text)).toEqual(['one', 'three']);
    await f.synchronizer.flush();
    expect(f.sent).toHaveLength(2);
    await f.synchronizer.dispose();
  });
  it('replays unchanged documents when a new server generation appears', async () => {
    const f = fixture();
    f.synchronizer.track('a', f.read);
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
      close: f.close,
      saved: f.saved,
      onError: () => {},
      delayMs: 60_000,
    });
    synchronizer.track('a', f.read);
    await expect(synchronizer.flush()).rejects.toThrow('disconnected');
    await synchronizer.flush();
    expect(sync).toHaveBeenCalledTimes(2);
    await synchronizer.dispose();
    await f.synchronizer.dispose();
  });
  it('orders close and reopen of the same path and sends saved only after synchronization', async () => {
    const f = fixture();
    const release = f.synchronizer.track('a', f.read);
    await f.synchronizer.flush();
    const closing = release();
    f.synchronizer.track('a', f.read);
    await f.synchronizer.saved('a');
    await closing;
    expect(f.sent).toHaveLength(2);
    expect(f.close.mock.invocationCallOrder[0]).toBeLessThan(f.saved.mock.invocationCallOrder[0]);
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
      close: f.close,
      saved: f.saved,
      onError: () => {},
      delayMs: 60_000,
    });
    synchronizer.track('a', f.read);
    const first = synchronizer.flush();
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    f.update('new');
    synchronizer.changed();
    complete();
    await first;
    await synchronizer.flush();
    expect(sync.mock.calls.map(([document]) => document.text)).toEqual(['one', 'new']);
    await synchronizer.dispose();
    await f.synchronizer.dispose();
  });
});
