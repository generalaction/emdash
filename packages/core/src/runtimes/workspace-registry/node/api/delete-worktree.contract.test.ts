import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ManualClock } from '@emdash/shared/testing';
import { remote, snapshot } from '@emdash/wire';
import { createTestWire, type TestWire } from '@emdash/wire/testing';
import type { TempStoreHandle } from '@primitives/sqlite-store/api';
import { workspaceRegistryContract } from '@runtimes/workspace-registry/api';
import {
  workspaceRegistryStore,
  type WorkspaceRegistryDb,
} from '@runtimes/workspace-registry/node/persistence/store';
import { WorkspaceRegistryRuntime } from '@runtimes/workspace-registry/node/runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceRegistryController } from './controller';

// Contract-seam tests for deleteWorktree (ADR 0005): one call that deactivates
// (sessions + teardown), force-removes the artifact, optionally deletes the branch, and
// unregisters — with no host-side dirty/unpushed refusals, and idempotent on absent ids.

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

async function makeRepo(root: string, name: string): Promise<string> {
  const repoPath = path.join(root, name);
  await fs.mkdir(repoPath, { recursive: true });
  git(repoPath, 'init', '--initial-branch=main');
  await fs.writeFile(path.join(repoPath, 'README.md'), `# ${name}\n`);
  git(repoPath, 'add', '.');
  git(repoPath, 'commit', '-m', 'initial');
  return repoPath;
}

describe('workspace registry deleteWorktree', () => {
  let root: string;
  let handle: TempStoreHandle<WorkspaceRegistryDb>;
  let clock: ManualClock;
  let runtime: WorkspaceRegistryRuntime;
  let wire: TestWire<typeof workspaceRegistryContract>;
  let killedPaths: string[];

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ws-delete-')));
    handle = await workspaceRegistryStore.openTemp();
    clock = new ManualClock(10_000);
    killedPaths = [];
    runtime = new WorkspaceRegistryRuntime({
      handle,
      clock,
      killSessions: async (workspacePath) => {
        killedPaths.push(workspacePath);
      },
    });
    wire = createTestWire(workspaceRegistryContract, createWorkspaceRegistryController(runtime), {
      validate: 'full',
    });
  });

  afterEach(async () => {
    wire.dispose();
    runtime.dispose();
    handle.close();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function listRecords() {
    const records = remote(workspaceRegistryContract.records, wire.client.records);
    const model = records(undefined);
    try {
      await model.states.list.refresh();
      return snapshot(model.states.list).value ?? {};
    } finally {
      await records.dispose();
    }
  }

  async function createWorktree(repositoryId: string, name: string) {
    const result = await wire.client.createWorktree({
      id: `wt-${name}`,
      repositoryId,
      branch: `branch-${name}`,
      baseRef: 'main',
      path: path.join(root, name),
      preservePatterns: [],
      pushBranch: false,
    });
    if (!result.success) throw new Error(`createWorktree failed: ${JSON.stringify(result.error)}`);
    return result.data;
  }

  it('deleting an active worktree kills sessions, runs teardown, removes the artifact, and drops the record', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });
    const worktree = await createWorktree('ws-repo', 'active');
    await fs.writeFile(
      path.join(worktree.path, '.emdash.json'),
      JSON.stringify({ scripts: { teardown: 'echo teardown >> ../teardown-log' } })
    );
    const activated = await wire.client.activateWorkspace({ id: 'wt-active' });
    expect(activated.success).toBe(true);

    const deleted = await wire.client.deleteWorktree({ id: 'wt-active', deleteBranch: false });
    expect(deleted).toEqual({ success: true, data: undefined });

    expect(killedPaths).toContain(worktree.path);
    await expect(fs.readFile(path.join(root, 'teardown-log'), 'utf8')).resolves.toBe('teardown\n');
    await expect(fs.stat(worktree.path)).rejects.toThrow();
    expect(git(repoPath, 'worktree', 'list')).not.toContain('active');
    expect((await listRecords())['wt-active']).toBeUndefined();
  });

  it('deleteBranch decides whether the branch goes with its worktree', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });
    await createWorktree('ws-repo', 'keep');
    await createWorktree('ws-repo', 'drop');

    expect(await wire.client.deleteWorktree({ id: 'wt-keep', deleteBranch: false })).toMatchObject({
      success: true,
    });
    expect(await wire.client.deleteWorktree({ id: 'wt-drop', deleteBranch: true })).toMatchObject({
      success: true,
    });

    const branches = git(repoPath, 'branch', '--list');
    expect(branches).toContain('branch-keep');
    expect(branches).not.toContain('branch-drop');
  });

  it('dirty and unpushed worktrees delete without refusal', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });
    const worktree = await createWorktree('ws-repo', 'dirty');
    await fs.writeFile(path.join(worktree.path, 'untracked.txt'), 'dirty');
    await fs.writeFile(path.join(worktree.path, 'committed.txt'), 'unpushed');
    git(worktree.path, 'add', 'committed.txt');
    git(worktree.path, 'commit', '-m', 'unpushed work');

    const deleted = await wire.client.deleteWorktree({ id: 'wt-dirty', deleteBranch: true });
    expect(deleted).toEqual({ success: true, data: undefined });
    await expect(fs.stat(worktree.path)).rejects.toThrow();
  });

  it('absent ids and repeated deletes succeed; non-worktree records get the typed error', async () => {
    expect(await wire.client.deleteWorktree({ id: 'wt-never', deleteBranch: false })).toEqual({
      success: true,
      data: undefined,
    });

    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });
    await createWorktree('ws-repo', 'twice');
    expect(await wire.client.deleteWorktree({ id: 'wt-twice', deleteBranch: false })).toMatchObject(
      { success: true }
    );
    expect(await wire.client.deleteWorktree({ id: 'wt-twice', deleteBranch: false })).toEqual({
      success: true,
      data: undefined,
    });

    expect(await wire.client.deleteWorktree({ id: 'ws-repo', deleteBranch: false })).toEqual({
      success: false,
      error: { type: 'not-a-worktree', workspaceId: 'ws-repo' },
    });

    const directoryPath = path.join(root, 'plain');
    await fs.mkdir(directoryPath);
    await wire.client.createWorkspace({ id: 'ws-plain', path: directoryPath });
    expect(await wire.client.deleteWorktree({ id: 'ws-plain', deleteBranch: false })).toEqual({
      success: false,
      error: { type: 'not-a-worktree', workspaceId: 'ws-plain' },
    });
  });

  it('deleteWorkspace deactivates before unregistering and still never touches disk', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });
    await fs.writeFile(
      path.join(repoPath, '.emdash.json'),
      JSON.stringify({ scripts: { teardown: 'echo teardown >> ../repo-teardown-log' } })
    );
    const activated = await wire.client.activateWorkspace({ id: 'ws-repo' });
    expect(activated.success).toBe(true);

    const deleted = await wire.client.deleteWorkspace({ id: 'ws-repo' });
    expect(deleted).toEqual({ success: true, data: undefined });

    expect(killedPaths).toContain(repoPath);
    await expect(fs.readFile(path.join(root, 'repo-teardown-log'), 'utf8')).resolves.toBe(
      'teardown\n'
    );
    // Unregister never touches the artifact.
    await expect(fs.stat(repoPath)).resolves.toBeDefined();
    expect((await listRecords())['ws-repo']).toBeUndefined();
  });
});
