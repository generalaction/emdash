import { EventEmitter } from 'node:events';
import type { ClientChannel } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import type { FileWatchEvent } from '@shared/core/fs/fs';
import { LegacySshFilesRuntime } from './ssh-files';

type SnapshotRecord = {
  kind: 'file' | 'directory';
  path: string;
  size?: string;
  mtime?: string;
};

class FakeExecChannel extends EventEmitter {
  readonly stderr = new EventEmitter();
}

describe('LegacySshFilesRuntime', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps scoped watches on the existing SSH polling watcher', async () => {
    let emitLegacyEvents: ((events: FileWatchEvent[]) => void) | undefined;
    const update = vi.fn();
    const close = vi.fn();
    vi.spyOn(SshFileSystem.prototype, 'watch').mockImplementation((cb) => {
      emitLegacyEvents = cb;
      return { update, close };
    });

    const runtime = new LegacySshFilesRuntime({} as never);
    const updates: unknown[] = [];
    const subscription = runtime.watchChanges('/repo', (update) => updates.push(update), {
      paths: ['src'],
    });
    expect(subscription.success).toBe(true);
    expect(update).toHaveBeenCalledWith(['src']);

    emitLegacyEvents?.([
      { type: 'modify', entryType: 'file', path: 'src/notes.md' },
      { type: 'modify', entryType: 'file', path: 'src/node_modules/pkg/index.js' },
    ]);

    expect(updates).toEqual([
      {
        kind: 'changes',
        changes: [{ kind: 'update', entryType: 'file', path: 'src/notes.md' }],
      },
    ]);

    if (subscription.success) subscription.data.unsubscribe();
    expect(close).toHaveBeenCalledTimes(1);

    await runtime.dispose();
  });

  it('uses recursive snapshot polling for root watches', async () => {
    vi.useFakeTimers();
    const watchSpy = vi.spyOn(SshFileSystem.prototype, 'watch');
    const { proxy, exec } = makeSnapshotProxy([
      snapshot([
        { kind: 'file', path: 'README.md', size: '1', mtime: '1' },
        { kind: 'file', path: 'src/a.ts', size: '1', mtime: '1' },
      ]),
      snapshot([
        { kind: 'file', path: 'src/a.ts', size: '2', mtime: '2' },
        { kind: 'file', path: 'src/b.ts', size: '1', mtime: '1' },
        { kind: 'file', path: 'node_modules/pkg/index.js', size: '1', mtime: '1' },
      ]),
    ]);

    const runtime = new LegacySshFilesRuntime(proxy);
    const updates: unknown[] = [];
    const subscription = runtime.watchChanges('/repo', (update) => updates.push(update), {
      paths: [''],
      debounceMs: 100,
    });

    expect(subscription.success).toBe(true);
    if (!subscription.success) return;

    await expect(subscription.data.ready()).resolves.toEqual({ success: true, data: undefined });
    expect(updates).toEqual([]);
    expect(watchSpy).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);

    expect(exec).toHaveBeenCalledTimes(2);
    expect(updates).toEqual([
      {
        kind: 'changes',
        changes: [
          { kind: 'update', path: 'src/a.ts', entryType: 'file' },
          { kind: 'create', path: 'src/b.ts', entryType: 'file' },
          { kind: 'delete', path: 'README.md', entryType: 'file' },
        ],
      },
    ]);

    subscription.data.unsubscribe();
    await runtime.dispose();
  });

  it('enumerates remote files with one streamed command', async () => {
    const { proxy, exec } = makeSnapshotProxy([
      enumeration(['README.md', 'src/a.ts', 'node_modules/pkg/index.js']),
    ]);
    const runtime = new LegacySshFilesRuntime(proxy);

    const result = runtime.enumerate('/repo');
    expect(result.success).toBe(true);
    if (!result.success) return;

    await expect(collect(result.data)).resolves.toEqual(['README.md', 'src/a.ts']);
    expect(exec).toHaveBeenCalledTimes(1);

    await runtime.dispose();
  });

  it('returns a disposed error when watched after disposal', async () => {
    const runtime = new LegacySshFilesRuntime({} as never);
    await runtime.dispose();

    const subscription = runtime.watchChanges('/repo', () => {});

    expect(subscription.success).toBe(false);
    if (!subscription.success) {
      expect(subscription.error).toMatchObject({
        type: 'fs-error',
        message: 'LegacySshFilesRuntime disposed',
      });
    }
  });
});

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const paths: string[] = [];
  for await (const relPath of iterable) paths.push(relPath);
  return paths;
}

function snapshot(records: SnapshotRecord[]): Buffer {
  const fields = records.flatMap((record) => [
    record.kind,
    record.size ?? '1',
    record.mtime ?? '1',
    record.path,
  ]);
  return Buffer.from(`${fields.join('\0')}\0`);
}

function enumeration(paths: string[]): Buffer {
  return Buffer.from(`${paths.join('\0')}\0`);
}

function makeSnapshotProxy(snapshots: Buffer[]): {
  proxy: SshClientProxy;
  exec: ReturnType<typeof vi.fn>;
} {
  const exec = vi.fn(
    (command: string, cb: (err: Error | undefined, stream: ClientChannel) => void) => {
      const stream = new FakeExecChannel();
      const stdout = snapshots.shift() ?? Buffer.alloc(0);
      cb(undefined, stream as unknown as ClientChannel);
      queueMicrotask(() => {
        stream.emit('data', stdout);
        stream.emit('close', 0);
      });
    }
  );

  return {
    proxy: {
      getRemoteShellProfile: vi.fn().mockResolvedValue({ shell: '/bin/sh', env: {} }),
      exec,
    } as unknown as SshClientProxy,
    exec,
  };
}
