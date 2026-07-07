import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPluginFs } from './plugin-fs';

describe('createPluginFs', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-fs-test-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('returns null when reading a missing file', async () => {
    const pluginFs = createPluginFs(root);
    await expect(pluginFs.read('missing.json')).resolves.toBeNull();
  });

  it('throws on non-not-found read errors instead of masking them as null', async () => {
    const pluginFs = createPluginFs(root);
    await fs.mkdir(path.join(root, 'a-directory'));

    await expect(pluginFs.read('a-directory')).rejects.toThrow();
  });

  it('writes atomically without leaving tmp files behind', async () => {
    const pluginFs = createPluginFs(root);

    await pluginFs.write('nested/config.json', '{"ok":true}');

    await expect(pluginFs.read('nested/config.json')).resolves.toBe('{"ok":true}');
    const entries = await fs.readdir(path.join(root, 'nested'));
    expect(entries).toEqual(['config.json']);
  });

  it('rejects path escapes', async () => {
    const pluginFs = createPluginFs(root);
    await expect(pluginFs.write('../escape.txt', 'nope')).rejects.toThrow(/path escape/);
  });
});
