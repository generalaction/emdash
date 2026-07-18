import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ClientChannel } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import type { FileWatchEvent } from '@shared/core/fs/fs';
import { buildRecursiveSnapshotCommand, LegacySshFilesRuntime } from './ssh-files';
import { SshFileSystem } from './ssh-legacy-fs';

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

  it('uses GNU find metadata without per-entry stat processes when supported', () => {
    const command = buildRecursiveSnapshotCommand("/repo/it's here");
    const [gnuBranch, portableBranch] = command.split('\nelse\n');

    expect(gnuBranch).toContain("cd '/repo/it'\\''s here' || exit 1");
    expect(gnuBranch).toContain(
      "if find . -maxdepth 0 -printf '%s\\0%T@\\0%P\\0' >/dev/null 2>&1; then"
    );
    expect(gnuBranch).toContain("-type f -printf 'file\\0%s\\0%T@\\0%P\\0'");
    expect(gnuBranch).toContain("-type d -printf 'directory\\0%s\\0%T@\\0%P\\0'");
    expect(gnuBranch).toContain("-name 'node_modules'");
    expect(gnuBranch).not.toContain('stat ');
    expect(portableBranch).toBeDefined();
  });

  it('keeps the NUL-safe stat fallback for non-GNU find implementations', () => {
    const command = buildRecursiveSnapshotCommand('/repo');
    const portableBranch = command.split('\nelse\n')[1];

    expect(portableBranch).toContain("stat -c '%s %Y'");
    expect(portableBranch).toContain("stat -f '%z %m'");
    expect(portableBranch).toContain('-exec sh -c');
    expect(portableBranch).toContain('%s\\0%s\\0%s\\0%s\\0');
    expect(portableBranch).toContain('sh "$stat_style" {} +');
  });

  it.skipIf(process.platform === 'win32')(
    'emits recursive snapshot records with the available POSIX find implementation',
    async () => {
      const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'emdash-ssh-snapshot-'));
      const rootPath = path.join(tempRoot, "repo with ' quote");
      const bulkFileCount = 128;

      try {
        await mkdir(path.join(rootPath, 'src'), { recursive: true });
        await mkdir(path.join(rootPath, 'bulk'), { recursive: true });
        await mkdir(path.join(rootPath, 'node_modules', 'ignored'), { recursive: true });
        await writeFile(path.join(rootPath, 'README.md'), 'readme');
        await writeFile(path.join(rootPath, 'src', "line\nbreak's.ts"), 'source');
        await writeFile(path.join(rootPath, 'node_modules', 'ignored', 'index.js'), 'ignored');
        await Promise.all(
          Array.from({ length: bulkFileCount }, (_, index) =>
            writeFile(path.join(rootPath, 'bulk', `${index}.txt`), String(index))
          )
        );

        const stdout = await execLocalShell(buildRecursiveSnapshotCommand(rootPath));
        const records = parseSnapshotRecords(stdout);

        expect(records).toHaveLength(bulkFileCount + 4);
        expect(records.map((record) => record.path)).toEqual(
          expect.arrayContaining(['README.md', 'bulk', 'src', "src/line\nbreak's.ts"])
        );
        expect(records.filter((record) => record.path.startsWith('bulk/'))).toHaveLength(
          bulkFileCount
        );
        expect(records.some((record) => record.path.includes('node_modules'))).toBe(false);
        expect(records.find((record) => record.path === 'README.md')).toMatchObject({
          kind: 'file',
          size: '6',
        });
        expect(records.find((record) => record.path === 'src')).toMatchObject({
          kind: 'directory',
        });
        expect(records.every((record) => /^\d+(?:\.\d+)?$/.test(record.mtime ?? ''))).toBe(true);
      } finally {
        await rm(tempRoot, { recursive: true, force: true });
      }
    }
  );

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
      paths: ['/repo/src'],
    });
    expect(subscription.success).toBe(true);
    expect(update).toHaveBeenCalledWith(['/repo/src']);

    emitLegacyEvents?.([
      { type: 'modify', entryType: 'file', path: '/repo/src/notes.md' },
      { type: 'modify', entryType: 'file', path: '/repo/src/node_modules/pkg/index.js' },
    ]);

    expect(updates).toEqual([
      {
        kind: 'changes',
        changes: [{ kind: 'update', entryType: 'file', path: '/repo/src/notes.md' }],
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
        { kind: 'file', path: 'src/stable.ts', size: '1', mtime: '3' },
      ]),
      snapshot([
        { kind: 'file', path: 'src/a.ts', size: '2', mtime: '2.5000000000' },
        { kind: 'file', path: 'src/b.ts', size: '1', mtime: '1' },
        { kind: 'file', path: "src/line\nbreak's.ts", size: '1', mtime: '1' },
        { kind: 'file', path: 'src/stable.ts', size: '1', mtime: '3.7500000000' },
        { kind: 'file', path: 'node_modules/pkg/index.js', size: '1', mtime: '1' },
      ]),
    ]);

    const runtime = new LegacySshFilesRuntime(proxy);
    const updates: unknown[] = [];
    const subscription = runtime.watchChanges('/repo', (update) => updates.push(update), {
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
          { kind: 'update', path: '/repo/src/a.ts', entryType: 'file' },
          { kind: 'create', path: '/repo/src/b.ts', entryType: 'file' },
          { kind: 'create', path: "/repo/src/line\nbreak's.ts", entryType: 'file' },
          { kind: 'delete', path: '/repo/README.md', entryType: 'file' },
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

    const fileSystem = runtime.fileSystem();
    expect(fileSystem.success).toBe(true);
    if (!fileSystem.success) return;

    const result = fileSystem.data.enumerate('/repo');
    expect(result.success).toBe(true);
    if (!result.success) return;

    await expect(collect(result.data)).resolves.toEqual(['/repo/README.md', '/repo/src/a.ts']);
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

function execLocalShell(command: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile('/bin/sh', ['-c', command], { encoding: 'buffer' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.toString('utf8') || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

function parseSnapshotRecords(stdout: Buffer): SnapshotRecord[] {
  const fields = stdout.toString('utf8').split('\0');
  const records: SnapshotRecord[] = [];

  for (let index = 0; index + 3 < fields.length; index += 4) {
    const kind = fields[index];
    if (kind !== 'file' && kind !== 'directory') continue;
    records.push({
      kind,
      size: fields[index + 1],
      mtime: fields[index + 2],
      path: fields[index + 3],
    });
  }

  return records;
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
