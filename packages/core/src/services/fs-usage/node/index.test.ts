import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { measureAbsolutePathUsage } from './index';

async function writeBytes(filePath: string, size: number): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.alloc(size, 1));
}

async function diskBytesOf(filePath: string): Promise<number> {
  const stats = await fs.lstat(filePath);
  return stats.blocks > 0 ? stats.blocks * 512 : stats.size;
}

describe('measureAbsolutePathUsage', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fs-usage-')));
  });

  afterEach(async () => {
    await fs.chmod(path.join(root, 'locked'), 0o755).catch(() => undefined);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('attributes artifact roots at any depth and nothing outside them', async () => {
    await writeBytes(path.join(root, 'src', 'index.ts'), 1_000);
    await writeBytes(path.join(root, 'node_modules', 'pkg', 'lib', 'index.js'), 8_000);
    await writeBytes(path.join(root, 'packages', 'app', 'node_modules', 'dep.js'), 16_000);
    await writeBytes(path.join(root, 'packages', 'app', 'node_modules-notes.md'), 2_000);
    await writeBytes(path.join(root, 'debug.log'), 4_000);

    const usage = await measureAbsolutePathUsage(root, '', {
      artifactRoots: ['node_modules', 'packages/app/node_modules/', 'debug.log'],
    });

    const artifactFiles = [
      'node_modules/pkg/lib/index.js',
      'packages/app/node_modules/dep.js',
      'debug.log',
    ];
    const artifactDirectories = [
      'node_modules',
      'node_modules/pkg',
      'node_modules/pkg/lib',
      'packages/app/node_modules',
    ];
    let expectedArtifactBytes = 0;
    for (const entry of [...artifactFiles, ...artifactDirectories]) {
      expectedArtifactBytes += await diskBytesOf(path.join(root, entry));
    }
    expect(usage).toMatchObject({ type: 'directory', errors: [] });
    expect(usage.artifactBytes).toBe(expectedArtifactBytes);
    expect(usage.exclusiveDiskBytes).toBe(usage.diskBytes);
    expect(usage.diskBytes).toBeGreaterThan(expectedArtifactBytes);
    expect(usage.apparentBytes).toBeGreaterThanOrEqual(31_000);
  });

  it('skips excluded nested paths but keeps siblings that share their prefix', async () => {
    const nested = path.join(root, 'worktrees', 'nested');
    await writeBytes(path.join(root, 'root.bin'), 4_000);
    await writeBytes(path.join(nested, 'nested.bin'), 64_000);
    await writeBytes(path.join(root, 'worktrees', 'nested-sibling', 'sibling.bin'), 8_000);

    const full = await measureAbsolutePathUsage(root, '');
    const withoutNested = await measureAbsolutePathUsage(root, '', { excludePaths: [nested] });
    const nestedOnly = await measureAbsolutePathUsage(nested, '');

    expect(withoutNested.errors).toEqual([]);
    expect(withoutNested.diskBytes + nestedOnly.diskBytes).toBe(full.diskBytes);
    expect(withoutNested.apparentBytes + nestedOnly.apparentBytes).toBe(full.apparentBytes);
    expect(withoutNested.apparentBytes).toBeGreaterThan(12_000);
  });

  it.skipIf(process.platform === 'win32')(
    'matches artifact roots verbatim, spaces and backslashes included',
    async () => {
      await writeBytes(path.join(root, ' spaced '), 4_000);
      await writeBytes(path.join(root, 'back\\slash', 'out.js'), 8_000);
      await writeBytes(path.join(root, 'back', 'slash'), 16_000);

      const usage = await measureAbsolutePathUsage(root, '', {
        artifactRoots: [' spaced ', 'back\\slash/'],
      });

      expect(usage.artifactBytes).toBe(
        (await diskBytesOf(path.join(root, ' spaced '))) +
          (await diskBytesOf(path.join(root, 'back\\slash'))) +
          (await diskBytesOf(path.join(root, 'back\\slash', 'out.js')))
      );
    }
  );

  it('counts a hard-linked file once, and as exclusive only when every link is inside', async () => {
    await writeBytes(path.join(root, 'a', 'shared.bin'), 32_000);
    await fs.mkdir(path.join(root, 'b'));
    await fs.link(path.join(root, 'a', 'shared.bin'), path.join(root, 'b', 'shared.bin'));
    const sharedBytes = await diskBytesOf(path.join(root, 'a', 'shared.bin'));

    const whole = await measureAbsolutePathUsage(root, '', { artifactRoots: ['a', 'b'] });
    const half = await measureAbsolutePathUsage(path.join(root, 'a'), '');
    const halfWithoutB = await measureAbsolutePathUsage(root, '', {
      excludePaths: [path.join(root, 'b')],
    });

    const directories =
      (await diskBytesOf(root)) +
      (await diskBytesOf(path.join(root, 'a'))) +
      (await diskBytesOf(path.join(root, 'b')));
    expect(whole.diskBytes).toBe(directories + sharedBytes);
    expect(whole.exclusiveDiskBytes).toBe(whole.diskBytes);
    expect(whole.artifactBytes).toBe(whole.diskBytes - (await diskBytesOf(root)));
    // Deleting only one side would not free the file.
    expect(half.exclusiveDiskBytes).toBe(half.diskBytes - sharedBytes);
    expect(halfWithoutB.exclusiveDiskBytes).toBe(halfWithoutB.diskBytes - sharedBytes);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'reports unreadable directories by display path and keeps measuring',
    async () => {
      await writeBytes(path.join(root, 'locked', 'secret.bin'), 4_000);
      await writeBytes(path.join(root, 'open', 'visible.bin'), 4_000);
      await fs.chmod(path.join(root, 'locked'), 0o000);

      const usage = await measureAbsolutePathUsage(root, 'repo');

      expect(usage.errors).toEqual([{ path: 'repo/locked', message: expect.any(String) }]);
      expect(usage.apparentBytes).toBeGreaterThanOrEqual(4_000);
    }
  );

  it('measures a file root on its own', async () => {
    await writeBytes(path.join(root, 'single.bin'), 4_000);

    const usage = await measureAbsolutePathUsage(path.join(root, 'single.bin'), 'single.bin');

    expect(usage).toMatchObject({ type: 'file', apparentBytes: 4_000, artifactBytes: 0 });
    expect(usage.exclusiveDiskBytes).toBe(await diskBytesOf(path.join(root, 'single.bin')));
  });

  it('yields to the event loop between slices instead of blocking until done', async () => {
    for (let index = 0; index < 20; index += 1) {
      await writeBytes(path.join(root, `dir${index % 4}`, `file${index}.bin`), 100);
    }
    const order: string[] = [];

    const measured = measureAbsolutePathUsage(root, '', { sliceBudgetMs: 0 }).then(() =>
      order.push('measured')
    );
    setImmediate(() => order.push('event loop'));
    await measured;

    expect(order).toEqual(['event loop', 'measured']);
  });

  it('stops walking once the signal aborts mid-walk', async () => {
    for (let index = 0; index < 20; index += 1) {
      await writeBytes(path.join(root, `dir${index % 4}`, `file${index}.bin`), 100);
    }
    const controller = new AbortController();

    const measured = measureAbsolutePathUsage(root, '', {
      signal: controller.signal,
      sliceBudgetMs: 0,
    });
    setImmediate(() => controller.abort(new Error('view closed')));

    await expect(measured).rejects.toThrow('view closed');
  });
});
