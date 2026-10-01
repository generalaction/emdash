import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatAbsolute, parseNativeAbsolute } from '#primitives/path/api';
import { resolveLanguageProject } from './project-resolution';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'emdash-lsp-project-'));
  directories.push(root);
  await mkdir(path.join(root, 'workspace', 'packages', 'app', 'src'), { recursive: true });
  const absolute = (p: string) => {
    const parsed = parseNativeAbsolute(path.join(root, p));
    if (!parsed.success) throw new Error('invalid fixture path');
    return parsed.data;
  };
  const resolve = (file = 'workspace/packages/app/src/a.ts', serverId = 'typescript') =>
    resolveLanguageProject({
      workspaceRoot: absolute('workspace'),
      path: absolute(file),
      serverId,
    });
  return { root, absolute, resolve };
}
describe('host language project resolution', () => {
  it('chooses the nearest project boundary inside the workspace', async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, 'workspace', 'package.json'), '{}');
    await writeFile(path.join(f.root, 'workspace/packages/app/tsconfig.json'), '{}');
    expect(await f.resolve()).toEqual(f.absolute('workspace/packages/app'));
  });
  it('falls back to the workspace and never searches its parent', async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, 'tsconfig.json'), '{}');
    expect(await f.resolve()).toEqual(f.absolute('workspace'));
  });
  it('keeps external definition targets attached to their originating workspace', async () => {
    const f = await fixture();
    expect(await f.resolve('dependency.d.ts')).toEqual(f.absolute('workspace'));
  });
  it('treats a sibling with the same path prefix as outside the workspace', async () => {
    const f = await fixture();
    await mkdir(path.join(f.root, 'workspace-other'), { recursive: true });
    await writeFile(path.join(f.root, 'workspace-other/tsconfig.json'), '{}');
    expect(await f.resolve('workspace-other/a.ts')).toEqual(f.absolute('workspace'));
  });
  it('rejects an unknown server before any process resolution', async () => {
    const f = await fixture();
    await expect(f.resolve(undefined, 'unknown')).rejects.toThrow(/unsupported/i);
  });
  it('accepts JavaScript package roots without a tsconfig', async () => {
    const f = await fixture();
    await writeFile(path.join(f.root, 'workspace/packages/app/package.json'), '{}');
    expect(formatAbsolute(await f.resolve())).toBe(path.join(f.root, 'workspace/packages/app'));
  });
});
