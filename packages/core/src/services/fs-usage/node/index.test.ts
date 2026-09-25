import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { measureAbsolutePathUsage } from './index';

describe('measureAbsolutePathUsage', () => {
  let root: string;

  afterEach(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  it('excludes a nested workspace without excluding sibling files', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-usage-'));
    const nested = path.join(root, 'worktrees', 'nested');
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(root, 'root.bin'), Buffer.alloc(4_096));
    await fs.writeFile(path.join(nested, 'nested.bin'), Buffer.alloc(8_192));

    const full = await measureAbsolutePathUsage(root, '');
    const withoutNested = await measureAbsolutePathUsage(root, '', { excludePaths: [nested] });
    const nestedUsage = await measureAbsolutePathUsage(nested, '');

    expect(full.apparentBytes - withoutNested.apparentBytes).toBe(nestedUsage.apparentBytes);
    expect(withoutNested.apparentBytes).toBeGreaterThan(4_096);
    expect(withoutNested.errors).toEqual([]);
  });

  it('stops before scanning when the request is cancelled', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-usage-'));
    const controller = new AbortController();
    controller.abort();

    await expect(
      measureAbsolutePathUsage(root, '', { signal: controller.signal })
    ).rejects.toThrow();
  });

  it('stops while scanning when the request is cancelled', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-usage-'));
    await fs.writeFile(path.join(root, 'entry.bin'), Buffer.alloc(4_096));
    const controller = new AbortController();
    const originalCheck = controller.signal.throwIfAborted.bind(controller.signal);
    let checks = 0;
    vi.spyOn(controller.signal, 'throwIfAborted').mockImplementation(() => {
      checks += 1;
      if (checks === 6) controller.abort();
      originalCheck();
    });

    await expect(
      measureAbsolutePathUsage(root, '', { signal: controller.signal })
    ).rejects.toThrow();
    expect(checks).toBeGreaterThanOrEqual(6);
  });

  it('keeps cross-workspace hard links exclusive to neither workspace', async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-usage-'));
    const nested = path.join(root, 'nested');
    await fs.mkdir(nested);
    const firstLink = path.join(root, 'shared.bin');
    await fs.writeFile(firstLink, Buffer.alloc(4_096));
    await fs.link(firstLink, path.join(nested, 'shared.bin'));

    const full = await measureAbsolutePathUsage(root, '');
    const parent = await measureAbsolutePathUsage(root, '', { excludePaths: [nested] });
    const child = await measureAbsolutePathUsage(nested, '');
    const stats = await fs.lstat(firstLink);
    const sharedDiskBytes = stats.blocks > 0 ? stats.blocks * 512 : stats.size;

    // Removing either workspace alone leaves the shared file allocated.
    expect(full.exclusiveDiskBytes - parent.exclusiveDiskBytes - child.exclusiveDiskBytes).toBe(
      sharedDiskBytes
    );
  });
});
