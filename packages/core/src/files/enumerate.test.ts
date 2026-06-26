import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { enumerate } from './enumerate';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'emdash-files-enumerate-'));
  roots.push(root);
  return root;
}

async function collect(iterable: AsyncIterable<string>): Promise<string[]> {
  const paths: string[] = [];
  for await (const filePath of iterable) paths.push(filePath);
  return paths;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('enumerate', () => {
  it('streams regular files recursively with the canonical ignore set', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
    await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(path.join(root, '.git'), { recursive: true });
    await writeFile(path.join(root, 'README.md'), 'readme');
    await writeFile(path.join(root, '.env'), 'env');
    await writeFile(path.join(root, 'src', 'index.ts'), 'src');
    await writeFile(path.join(root, 'src', 'nested', 'deep.ts'), 'deep');
    await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), 'ignored');
    await writeFile(path.join(root, '.git', 'HEAD'), 'ignored');

    await expect(collect(enumerate(root))).resolves.toEqual([
      path.join(root, '.env'),
      path.join(root, 'README.md'),
      path.join(root, 'src/index.ts'),
      path.join(root, 'src/nested/deep.ts'),
    ]);
  });

  it('does not filter children when the root path contains an ignored ancestor segment', async () => {
    // Regression: a checkout under `.../worktrees/...` must still enumerate its
    // files even though `worktrees` is an ignored directory name.
    const base = await makeRoot();
    const root = path.join(base, 'worktrees', 'feature');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'README.md'), 'readme');
    await writeFile(path.join(root, 'src', 'index.ts'), 'src');

    await expect(collect(enumerate(root))).resolves.toEqual([
      path.join(root, 'README.md'),
      path.join(root, 'src/index.ts'),
    ]);
  });

  it('skips symlinks and other non-regular entries', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'target.txt'), 'target');
    try {
      await symlink('target.txt', path.join(root, 'link.txt'), 'file');
    } catch {
      // Some environments disallow symlink creation.
    }

    await expect(collect(enumerate(root))).resolves.toEqual([path.join(root, 'target.txt')]);
  });
});
