import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
});
