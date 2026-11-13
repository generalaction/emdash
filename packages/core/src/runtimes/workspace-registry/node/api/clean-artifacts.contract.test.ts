import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ManualClock } from '@emdash/shared/testing';
import { createTestWire, type TestWire } from '@emdash/wire/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TempStoreHandle } from '#primitives/sqlite-store/api';
import { workspaceRegistryContract } from '#runtimes/workspace-registry/api';
import {
  workspaceRegistryStore,
  type WorkspaceRegistryDb,
} from '#runtimes/workspace-registry/node/persistence/store';
import { WorkspaceRegistryRuntime } from '#runtimes/workspace-registry/node/runtime';
import { LocalAttachmentStore } from '#services/attachments/node/local-attachment-store';
import { createWorkspaceRegistryController } from './controller';

// Contract-seam tests for cleanArtifacts, against real git repositories: artifacts go
// in place, and everything that is not an artifact (tracked and uncommitted work,
// untracked files, preserved files, nested worktrees, the branch, the record) stays.

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_TERMINAL_PROMPT: '0',
    },
  }).trim();
}

async function write(filePath: string, contents: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
}

async function exists(filePath: string): Promise<boolean> {
  return fs.lstat(filePath).then(
    () => true,
    () => false
  );
}

describe('workspace registry cleanArtifacts', () => {
  let root: string;
  let handle: TempStoreHandle<WorkspaceRegistryDb>;
  let runtime: WorkspaceRegistryRuntime;
  let wire: TestWire<typeof workspaceRegistryContract>;
  let liveSessions: Map<string, number>;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ws-clean-')));
    handle = await workspaceRegistryStore.openTemp();
    liveSessions = new Map();
    runtime = new WorkspaceRegistryRuntime({
      attachments: new LocalAttachmentStore(path.join(root, 'attachments')),
      handle,
      clock: new ManualClock(10_000),
      countSessions: async (workspacePath) => liveSessions.get(workspacePath) ?? 0,
    });
    wire = createTestWire(workspaceRegistryContract, createWorkspaceRegistryController(runtime));
  });

  afterEach(async () => {
    wire.dispose();
    runtime.dispose();
    handle.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  /** A registered repository whose `.gitignore` covers the usual artifact kinds. */
  async function registerRepository(): Promise<string> {
    const repoPath = path.join(root, 'repo');
    await fs.mkdir(repoPath);
    git(repoPath, 'init', '--initial-branch=main');
    await write(
      path.join(repoPath, '.gitignore'),
      [
        'node_modules/',
        'dist/',
        '*.log',
        '*.db',
        '.env*',
        'config/',
        '.claude/',
        '.emdash.json',
      ].join('\n')
    );
    await write(path.join(repoPath, 'tracked.txt'), 'v1\n');
    git(repoPath, 'add', '.');
    git(repoPath, 'commit', '-m', 'initial');
    const created = await wire.client.createWorkspace({ workspaceId: 'ws-repo', path: repoPath });
    if (!created.success) throw new Error(`createWorkspace failed: ${created.error.type}`);
    return repoPath;
  }

  async function createWorktree(name: string): Promise<string> {
    const created = await wire.client.createWorktree({
      workspaceId: `wt-${name}`,
      repositoryId: 'ws-repo',
      branch: name,
      baseRef: 'main',
      path: path.join(root, name),
      preservePatterns: [],
    });
    if (!created.success) throw new Error(`createWorktree failed: ${created.error.type}`);
    return created.data.path;
  }

  async function measure(workspaceId: string) {
    const measured = await wire.client.measureUsage({ workspaceId });
    if (!measured.success) throw new Error(`measureUsage failed: ${measured.error.type}`);
    return measured.data;
  }

  // Many real git subprocesses and two disk walks: the default deadline is tight under load.
  it('removes artifacts in place and keeps every kind of work in a dirty worktree', async () => {
    const repoPath = await registerRepository();
    await wire.client.patchPersonalProjectConfig({
      workspaceId: 'ws-repo',
      patch: { preservePatterns: ['local.db', 'config/local.json'] },
    });
    const worktree = await createWorktree('feature');

    await write(path.join(worktree, 'committed.txt'), 'unpushed\n');
    git(worktree, 'add', 'committed.txt');
    git(worktree, 'commit', '-m', 'unpushed work');
    const unpushed = git(worktree, 'rev-parse', 'HEAD');
    await write(path.join(worktree, 'tracked.txt'), 'v2, uncommitted\n');
    await write(path.join(worktree, 'staged.txt'), 'staged\n');
    git(worktree, 'add', 'staged.txt');
    await write(path.join(worktree, 'notes.md'), 'untracked, not ignored\n');
    await write(path.join(worktree, 'node_modules/dep/index.js'), 'x'.repeat(8_192));
    await write(path.join(worktree, 'dist/bundle.js'), 'x'.repeat(8_192));
    await write(path.join(worktree, 'debug.log'), 'log\n');
    await write(path.join(worktree, '.env'), 'SECRET=1\n');
    await write(path.join(worktree, '.env.local'), 'SECRET=2\n');
    await write(path.join(worktree, 'local.db'), 'preserved\n');
    await write(path.join(worktree, 'config/local.json'), '{}\n');
    await write(path.join(worktree, 'config/cache.json'), '{}\n');
    await write(path.join(worktree, '.emdash.json'), '{}\n');
    await write(path.join(worktree, '.claude/cache/state'), 'x'.repeat(4_096));
    // A nested worktree inside an ignored directory is another workspace, never an artifact.
    const nested = path.join(worktree, '.claude/worktrees/nested');
    git(repoPath, 'worktree', 'add', nested, '-b', 'nested');
    await write(path.join(nested, 'node_modules/dep/index.js'), 'nested\n');
    // An artifact symlinked outside the workspace goes as a link; its target stays.
    const outside = path.join(root, 'outside');
    await write(path.join(outside, 'keep.txt'), 'outside\n');
    await fs.symlink(outside, path.join(worktree, 'node_modules/linked'));
    const statusBefore = git(worktree, 'status', '--porcelain=v1', '--untracked-files=all');

    const before = await measure('wt-feature');
    const cleaned = await wire.client.cleanArtifacts({ workspaceId: 'wt-feature' });
    expect(cleaned).toEqual({ success: true, data: undefined });

    for (const removed of ['node_modules', 'dist', 'debug.log', '.claude/cache']) {
      expect(await exists(path.join(worktree, removed)), removed).toBe(false);
    }
    for (const kept of [
      'tracked.txt',
      'staged.txt',
      'notes.md',
      '.env',
      '.env.local',
      'local.db',
      'config/local.json',
      'config/cache.json',
      '.emdash.json',
      '.claude/worktrees/nested/node_modules/dep/index.js',
    ]) {
      expect(await exists(path.join(worktree, kept)), kept).toBe(true);
    }
    expect(await fs.readFile(path.join(worktree, 'tracked.txt'), 'utf8')).toBe('v2, uncommitted\n');
    expect(git(worktree, 'status', '--porcelain=v1', '--untracked-files=all')).toBe(statusBefore);
    expect(git(repoPath, 'rev-parse', 'feature')).toBe(unpushed);
    expect(await exists(path.join(outside, 'keep.txt'))).toBe(true);
    expect((await wire.client.getProjectConfig({ workspaceId: 'wt-feature' })).success).toBe(true);

    // The cached measurement was dropped, and what it reported as artifacts is what went.
    const after = await measure('wt-feature');
    expect(before.artifactBytes).toBeGreaterThan(16_384);
    expect(after.artifactBytes).toBe(0);
    // Parents that lost entries may shrink a little too (APFS sizes directories by entry).
    const freed = before.totalBytes - after.totalBytes;
    expect(freed).toBeGreaterThanOrEqual(before.artifactBytes);
    expect(freed).toBeLessThan(before.artifactBytes + 4_096);
  }, 15_000);

  it('keeps local env files by default and removes ignored config nothing preserves', async () => {
    await registerRepository();
    const worktree = await createWorktree('plain');
    await write(path.join(worktree, '.env'), 'SECRET=1\n');
    await write(path.join(worktree, 'packages/app/.env.production'), 'SECRET=2\n');
    await write(path.join(worktree, 'config/local.json'), '{}\n');
    // Git cannot re-include below a directory ignored as a whole: it stays one artifact.
    await write(path.join(worktree, 'config/.env'), 'SECRET=3\n');
    const before = await measure('wt-plain');

    expect((await wire.client.cleanArtifacts({ workspaceId: 'wt-plain' })).success).toBe(true);

    expect(await exists(path.join(worktree, '.env'))).toBe(true);
    expect(await exists(path.join(worktree, 'packages/app/.env.production'))).toBe(true);
    expect(await exists(path.join(worktree, 'config'))).toBe(false);
    expect(await exists(path.join(worktree, 'tracked.txt'))).toBe(true);
    // The kept env files were never counted as reclaimable.
    expect((await measure('wt-plain')).artifactBytes).toBe(0);
    expect(before.artifactBytes).toBeGreaterThan(0);
  });

  it.skipIf(process.platform === 'win32')(
    'removes ignored files whose names git has to quote',
    async () => {
      await registerRepository();
      const worktree = await createWorktree('quoted');
      const names = ['notes "draft" é.log', 'back\\slash\ttab.log', ' leading space.log'];
      for (const name of names) await write(path.join(worktree, name), 'x'.repeat(4_096));
      await write(path.join(worktree, 'dist/ünïcode dir/out.js'), 'x'.repeat(4_096));
      const before = await measure('wt-quoted');

      expect((await wire.client.cleanArtifacts({ workspaceId: 'wt-quoted' })).success).toBe(true);

      for (const name of [...names, 'dist']) {
        expect(await exists(path.join(worktree, name)), name).toBe(false);
      }
      expect(await exists(path.join(worktree, 'tracked.txt'))).toBe(true);
      // Every quoted name was counted before it went.
      expect(before.artifactBytes).toBeGreaterThanOrEqual(4 * 4_096);
      expect((await measure('wt-quoted')).artifactBytes).toBe(0);
    }
  );

  it('never removes or counts another registered workspace nested in an ignored directory', async () => {
    await registerRepository();
    const worktree = await createWorktree('outer');
    // `config/` is ignored as a whole; git sees no repository below it to skip.
    const nested = path.join(worktree, 'config', 'local');
    await write(path.join(nested, 'notes.md'), 'x'.repeat(8_192));
    await write(path.join(worktree, 'config', 'cache.json'), 'x'.repeat(8_192));
    await write(path.join(worktree, 'dist', 'bundle.js'), 'x'.repeat(8_192));
    const registered = await wire.client.createWorkspace({
      workspaceId: 'ws-nested',
      path: nested,
    });
    expect(registered).toMatchObject({ success: true, data: { kind: 'directory' } });
    const before = await measure('wt-outer');

    expect((await wire.client.cleanArtifacts({ workspaceId: 'wt-outer' })).success).toBe(true);

    // The directory holding the nested workspace stays whole; other artifacts go.
    expect(await exists(path.join(nested, 'notes.md'))).toBe(true);
    expect(await exists(path.join(worktree, 'config', 'cache.json'))).toBe(true);
    expect(await exists(path.join(worktree, 'dist'))).toBe(false);
    const after = await measure('wt-outer');
    expect(after.artifactBytes).toBe(0);
    expect(before.artifactBytes).toBeLessThan(2 * 8_192);
  });

  it('refuses while sessions run under the workspace and touches nothing', async () => {
    await registerRepository();
    const worktree = await createWorktree('busy');
    await write(path.join(worktree, 'node_modules/dep/index.js'), 'in use\n');
    liveSessions.set(worktree, 1);

    expect(await wire.client.cleanArtifacts({ workspaceId: 'wt-busy' })).toEqual({
      success: false,
      error: { type: 'workspace-active', workspaceId: 'wt-busy' },
    });
    expect(await exists(path.join(worktree, 'node_modules/dep/index.js'))).toBe(true);
  });

  it('drops only the cleaned workspace from the usage cache', async () => {
    await registerRepository();
    const cleaned = await createWorktree('cleaned');
    const untouched = await createWorktree('untouched');
    await write(path.join(cleaned, 'dist/bundle.js'), 'x'.repeat(8_192));
    const cleanedBefore = await measure('wt-cleaned');
    const untouchedBefore = await measure('wt-untouched');
    // Grown outside emdash: only a fresh walk would see it.
    await write(path.join(untouched, 'dist/bundle.js'), 'x'.repeat(64_000));

    expect((await wire.client.cleanArtifacts({ workspaceId: 'wt-cleaned' })).success).toBe(true);

    expect(await measure('wt-untouched')).toEqual(untouchedBefore);
    expect((await measure('wt-cleaned')).totalBytes).toBeLessThan(cleanedBefore.totalBytes);
  });

  it('reports unknown and missing workspaces with typed errors', async () => {
    const repoPath = await registerRepository();
    const worktree = await createWorktree('gone');
    git(repoPath, 'worktree', 'remove', '--force', worktree);

    expect(await wire.client.cleanArtifacts({ workspaceId: 'unknown' })).toEqual({
      success: false,
      error: { type: 'workspace-not-found', workspaceId: 'unknown' },
    });
    expect(await wire.client.cleanArtifacts({ workspaceId: 'wt-gone' })).toEqual({
      success: false,
      error: { type: 'workspace-missing', workspaceId: 'wt-gone' },
    });
  });
});
