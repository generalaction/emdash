import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSystem } from './file-system';

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const items: string[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'emdash-core-fs-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FileSystem', () => {
  it('reads text and bytes with truncation metadata', async () => {
    const root = await makeRoot();
    const filePath = path.join(root, 'file.txt');
    await writeFile(filePath, 'hello world', 'utf8');
    const fs = new FileSystem();

    const text = await fs.readText(filePath, { maxBytes: 5 });
    expect(text.success).toBe(true);
    if (!text.success) return;
    expect(text.data).toEqual({ content: 'hello', truncated: true, totalSize: 11 });

    const bytes = await fs.readBytes(filePath, { maxBytes: 20 });
    expect(bytes.success).toBe(true);
    if (!bytes.success) return;
    expect(Buffer.from(bytes.data.bytes).toString('utf8')).toBe('hello world');
    expect(bytes.data.truncated).toBe(false);
  });

  it('writes files inside the root and creates parent directories', async () => {
    const root = await makeRoot();
    const fs = new FileSystem();
    const filePath = path.join(root, 'src/index.ts');

    const written = await fs.writeText(filePath, 'export {};');
    expect(written.success).toBe(true);
    if (!written.success) return;
    expect(written.data.bytesWritten).toBe(Buffer.byteLength('export {};'));
    await expect(readFile(path.join(root, 'src/index.ts'), 'utf8')).resolves.toBe('export {};');
  });

  it('rejects relative paths', async () => {
    const fs = new FileSystem();

    await expect(fs.writeText('../file.txt', 'x')).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
  });

  it('stats, checks existence, copies, and removes files', async () => {
    const root = await makeRoot();
    const srcPath = path.join(root, 'src/a.txt');
    const destPath = path.join(root, 'dest/b.txt');
    await mkdir(path.dirname(srcPath));
    await writeFile(srcPath, 'a', 'utf8');
    const fs = new FileSystem();

    const stat = await fs.stat(srcPath);
    expect(stat.success).toBe(true);
    if (!stat.success) return;
    expect(stat.data).toMatchObject({ path: srcPath, type: 'file', size: 1 });

    await expect(fs.exists(srcPath)).resolves.toEqual({ success: true, data: true });
    await expect(fs.copyFile(srcPath, destPath)).resolves.toEqual({
      success: true,
      data: undefined,
    });
    await expect(readFile(destPath, 'utf8')).resolves.toBe('a');
    await expect(fs.remove(srcPath)).resolves.toEqual({ success: true, data: undefined });
    await expect(fs.exists(srcPath)).resolves.toEqual({ success: true, data: false });
  });

  it('rejects empty paths', async () => {
    const fs = new FileSystem();

    await expect(fs.remove('')).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
    await expect(fs.exists('')).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
  });

  it('streams ignore-free glob matches including dotfiles', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, '.cursor', 'rules'), { recursive: true });
    await mkdir(path.join(root, '.claude'), { recursive: true });
    await writeFile(path.join(root, '.cursor', 'rules', 'style.md'), 'rules', 'utf8');
    await writeFile(path.join(root, '.claude.json'), '{}', 'utf8');
    await writeFile(path.join(root, '.claude', 'settings.json'), '{}', 'utf8');
    const fs = new FileSystem();

    const matched = fs.glob(['.cursor/**', '.claude.json', '.claude/**'], { cwd: root, dot: true });
    expect(matched.success).toBe(true);
    if (!matched.success) return;

    const paths: string[] = [];
    for await (const absPath of matched.data) paths.push(path.relative(root, absPath));
    expect(paths.sort()).toEqual([
      '.claude',
      '.claude.json',
      '.claude/settings.json',
      '.cursor',
      '.cursor/rules',
      '.cursor/rules/style.md',
    ]);
  });

  it('enumerates files recursively', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/index.ts'), 'content', 'utf8');
    await writeFile(path.join(root, '.env'), 'env', 'utf8');
    const fs = new FileSystem();

    const enumeration = fs.enumerate(root);
    expect(enumeration.success).toBe(true);
    if (!enumeration.success) return;

    const canonicalRoot = await realpath(root);
    await expect(collect(enumeration.data)).resolves.toEqual([
      path.join(canonicalRoot, '.env'),
      path.join(canonicalRoot, 'src/index.ts'),
    ]);
  });

  it('rejects relative roots for enumerate', () => {
    const fs = new FileSystem();

    expect(fs.enumerate('relative-root')).toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
  });
});
