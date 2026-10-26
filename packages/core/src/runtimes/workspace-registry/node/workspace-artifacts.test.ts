import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitExecFactory } from '#services/exec/node/git-exec';
import { listWorkspaceArtifacts, removeWorkspaceArtifacts } from './workspace-artifacts';

/** Serves a fixed `git clean -ndX` listing, standing in for git output that should never occur. */
function gitListing(...lines: string[]): GitExecFactory {
  return () =>
    ({
      exec: async () => ({ stdout: `${lines.join('\n')}\n`, stderr: '' }),
    }) as never;
}

async function write(filePath: string, contents = 'x'): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
}

async function exists(filePath: string): Promise<boolean> {
  return fs.lstat(filePath).then(
    () => true,
    () => false
  );
}

describe('workspace artifacts', () => {
  let root: string;
  let workspace: string;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ws-artifacts-')));
    workspace = path.join(root, 'workspace');
    await fs.mkdir(workspace);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('skips and reports an artifact whose directory resolves outside the workspace', async () => {
    await write(path.join(root, 'outside', 'secret.txt'));
    await fs.symlink(path.join(root, 'outside'), path.join(workspace, 'linked'));
    await write(path.join(workspace, 'dist', 'bundle.js'));

    const removed = await removeWorkspaceArtifacts({
      workspacePath: workspace,
      preservePatterns: [],
      nestedWorkspacePaths: [],
      createGitExec: gitListing('Would remove linked/secret.txt', 'Would remove dist/'),
    });

    expect(removed).toEqual({
      success: false,
      error: {
        type: 'unsafe-artifact-path',
        message:
          'Skipped 1 artifacts that resolve outside the workspace (first: linked/secret.txt).',
      },
    });
    expect(await exists(path.join(root, 'outside', 'secret.txt'))).toBe(true);
    expect(await exists(path.join(workspace, 'dist'))).toBe(false);
  });

  it('refuses a listing that escapes the workspace and removes nothing', async () => {
    await write(path.join(root, 'sibling', 'keep.txt'));
    await write(path.join(workspace, 'dist', 'bundle.js'));

    const removed = await removeWorkspaceArtifacts({
      workspacePath: workspace,
      preservePatterns: [],
      nestedWorkspacePaths: [],
      createGitExec: gitListing('Would remove dist/', 'Would remove ../sibling/'),
    });

    expect(removed).toMatchObject({ success: false, error: { type: 'unsafe-artifact-path' } });
    expect(await exists(path.join(root, 'sibling', 'keep.txt'))).toBe(true);
    expect(await exists(path.join(workspace, 'dist', 'bundle.js'))).toBe(true);
  });

  it('never treats the workspace itself as an artifact', async () => {
    await write(path.join(workspace, 'tracked.txt'));

    const removed = await removeWorkspaceArtifacts({
      workspacePath: workspace,
      preservePatterns: [],
      nestedWorkspacePaths: [],
      createGitExec: gitListing('Would remove ./', 'Would remove .', 'Would remove sub/..'),
    });

    expect(removed).toMatchObject({ success: false, error: { type: 'unsafe-artifact-path' } });
    expect(await exists(path.join(workspace, 'tracked.txt'))).toBe(true);
  });

  it('keeps every root that holds, or lies inside, another registered workspace', async () => {
    const listed = await listWorkspaceArtifacts({
      workspacePath: workspace,
      preservePatterns: [],
      nestedWorkspacePaths: [
        path.join(workspace, 'config', 'local'),
        path.join(workspace, 'packages', 'tool'),
        path.join(root, 'elsewhere'),
      ],
      createGitExec: gitListing(
        'Would remove config/',
        'Would remove packages/tool/node_modules/',
        'Would remove packages/app/node_modules/',
        'Would remove dist/'
      ),
    });

    expect(listed).toEqual({ success: true, data: ['packages/app/node_modules', 'dist'] });
  });

  it('decodes C-quoted names exactly and leaves undecodable ones alone', async () => {
    const listed = await listWorkspaceArtifacts({
      workspacePath: workspace,
      preservePatterns: [],
      nestedWorkspacePaths: [],
      createGitExec: gitListing(
        'Would remove plain name.log',
        'Would remove "caf\\303\\251 \\"q\\" back\\\\slash\\ttab.log"',
        'Would remove "dir \\342\\234\\223/"',
        // Not UTF-8, an unknown escape, and an unterminated quote.
        'Would remove "\\377.log"',
        'Would remove "bad\\qescape.log"',
        'Would remove "open.log',
        'Would skip repository nested'
      ),
    });

    expect(listed).toEqual({
      success: true,
      data: ['plain name.log', 'café "q" back\\slash\ttab.log', 'dir ✓'],
    });
  });
});
