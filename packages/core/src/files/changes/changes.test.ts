import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  IWatchService,
  WatchEvent,
  WatchHandle,
  WatchOptions,
} from '../../services/fs-watch/api';
import { FileChanges } from './changes';
import type { FileChangeUpdate } from './types';

class ManualWatchService implements IWatchService {
  private consumers: Array<{
    onEvents: (events: WatchEvent[]) => void;
    options: WatchOptions;
  }> = [];

  get watchCount(): number {
    return this.consumers.length;
  }

  watch(
    _root: string,
    onEvents: (events: WatchEvent[]) => void,
    options: WatchOptions = {}
  ): WatchHandle {
    this.consumers.push({ onEvents, options });
    return {
      ready: async () => {},
      release: async () => {},
    };
  }

  emit(events: WatchEvent[]): void {
    for (const consumer of this.consumers) consumer.onEvents(events);
  }

  resync(): void {
    for (const consumer of this.consumers) consumer.options.onResync?.();
  }

  async dispose(): Promise<void> {}
}

describe('FileChanges feed', () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  async function createFiles() {
    root = await mkdtemp(path.join(tmpdir(), 'emdash-files-'));
    const watcher = new ManualWatchService();
    const files = new FileChanges({ rootPath: root, watcher });
    return { files, watcher };
  }

  it('maps raw watch events to neutral file changes', async () => {
    const { files, watcher } = await createFiles();
    await mkdir(path.join(root!, 'src'));
    await writeFile(path.join(root!, 'src/index.ts'), 'content');
    await writeFile(path.join(root!, '..valid-name'), 'content');
    const updates: FileChangeUpdate[] = [];

    const subscription = files.watch((update) => updates.push(update));
    expect(subscription.success).toBe(true);

    watcher.emit([
      { kind: 'update', path: path.join(root!, 'src/index.ts') },
      { kind: 'create', path: path.join(root!, 'src') },
      { kind: 'update', path: path.join(root!, '..valid-name') },
      { kind: 'delete', path: path.join(root!, 'missing.ts') },
    ]);

    expect(updates).toEqual([
      {
        kind: 'changes',
        changes: [
          { kind: 'update', path: path.join(root!, 'src/index.ts'), entryType: 'file' },
          { kind: 'create', path: path.join(root!, 'src'), entryType: 'directory' },
          { kind: 'update', path: path.join(root!, '..valid-name'), entryType: 'file' },
          { kind: 'delete', path: path.join(root!, 'missing.ts'), entryType: 'unknown' },
        ],
      },
    ]);
  });

  it('filters optional watched paths', async () => {
    const { files, watcher } = await createFiles();
    await mkdir(path.join(root!, 'src'));
    await mkdir(path.join(root!, 'other'));
    await writeFile(path.join(root!, 'src/index.ts'), 'content');
    await writeFile(path.join(root!, 'other/index.ts'), 'content');
    const updates: FileChangeUpdate[] = [];

    const subscription = files.watch((update) => updates.push(update), {
      paths: [path.join(root!, 'src')],
    });
    expect(subscription.success).toBe(true);

    watcher.emit([
      { kind: 'update', path: path.join(root!, 'src/index.ts') },
      { kind: 'update', path: path.join(root!, 'other/index.ts') },
    ]);

    expect(updates).toEqual([
      {
        kind: 'changes',
        changes: [{ kind: 'update', path: path.join(root!, 'src/index.ts'), entryType: 'file' }],
      },
    ]);
  });

  it('includes previously ignored paths by default and supports caller exclusions', async () => {
    const { files, watcher } = await createFiles();
    await mkdir(path.join(root!, 'node_modules'), { recursive: true });
    await writeFile(path.join(root!, 'node_modules/pkg.js'), 'content');
    await writeFile(path.join(root!, '.DS_Store'), 'content');
    const updates: FileChangeUpdate[] = [];

    const subscription = files.watch((update) => updates.push(update), {
      exclude: (absPath) => absPath.endsWith('.DS_Store'),
    });
    expect(subscription.success).toBe(true);

    watcher.emit([
      { kind: 'update', path: path.join(root!, 'node_modules/pkg.js') },
      { kind: 'update', path: path.join(root!, '.DS_Store') },
    ]);

    expect(updates).toEqual([
      {
        kind: 'changes',
        changes: [
          { kind: 'update', path: path.join(root!, 'node_modules/pkg.js'), entryType: 'file' },
        ],
      },
    ]);
  });

  it('classifies symlink watch events explicitly', async () => {
    const { files, watcher } = await createFiles();
    await writeFile(path.join(root!, 'target.txt'), 'content');
    try {
      await symlink('target.txt', path.join(root!, 'link.txt'), 'file');
    } catch {
      // Some environments disallow symlink creation.
      return;
    }
    const updates: FileChangeUpdate[] = [];

    const subscription = files.watch((update) => updates.push(update));
    expect(subscription.success).toBe(true);

    watcher.emit([{ kind: 'create', path: path.join(root!, 'link.txt') }]);

    expect(updates).toEqual([
      {
        kind: 'changes',
        changes: [{ kind: 'create', path: path.join(root!, 'link.txt'), entryType: 'symlink' }],
      },
    ]);
  });

  it('emits resync updates when the native watcher recovers from a gap', async () => {
    const { files, watcher } = await createFiles();
    const updates: FileChangeUpdate[] = [];

    const subscription = files.watch((update) => updates.push(update));
    expect(subscription.success).toBe(true);
    watcher.resync();

    expect(updates).toEqual([{ kind: 'resync' }]);
  });

  it('rejects invalid watched paths', async () => {
    const { files } = await createFiles();

    const subscription = files.watch(() => {}, { paths: ['src'] });

    expect(subscription.success).toBe(false);
    if (!subscription.success) expect(subscription.error.type).toBe('invalid-path');
  });

  it('returns a disposed error when watched after disposal', async () => {
    const { files } = await createFiles();
    files.dispose();

    const subscription = files.watch(() => {});

    expect(subscription.success).toBe(false);
    if (!subscription.success) {
      expect(subscription.error).toMatchObject({
        type: 'fs-error',
        message: 'FileChanges disposed',
      });
    }
  });
});
