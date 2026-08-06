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

  /** Simulated daemon restart: a fresh runtime over the same durable store. */
  function rebuildRuntime() {
    wire.dispose();
    runtime.dispose();
    runtime = new WorkspaceRegistryRuntime({ handle, clock });
    wire = createTestWire(workspaceRegistryContract, createWorkspaceRegistryController(runtime), {
      validate: 'full',
    });
  }

  it('a failed removal records stage, class, and message durably; the trace survives a restart', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });
    await createWorktree('ws-repo', 'stuck');
    // The owning repository vanishes while the worktree directory remains: removal has
    // no repository to prune from and cannot converge without user intervention.
    await fs.rm(repoPath, { recursive: true, force: true });

    await clock.advanceBy(2_000);
    const deleted = await wire.client.deleteWorktree({ id: 'wt-stuck', deleteBranch: false });
    if (deleted.success) throw new Error('expected the delete to fail');
    expect(deleted.error.type).toBe('remove-failed');

    const record = (await listRecords())['wt-stuck'];
    expect(record?.lastRemovalAttempt).toEqual({
      stage: 'remove',
      class: 'terminal',
      message: expect.stringContaining('Cannot resolve the owning repository'),
      at: 12_000,
    });
    // The RPC return is loop control only: it carries nothing the record does not.
    expect(deleted.error).toEqual({
      type: 'remove-failed',
      message: record?.lastRemovalAttempt?.message,
    });

    rebuildRuntime();
    expect((await listRecords())['wt-stuck']?.lastRemovalAttempt).toEqual({
      stage: 'remove',
      class: 'terminal',
      message: expect.stringContaining('Cannot resolve the owning repository'),
      at: 12_000,
    });
  });

  it('a failing teardown fails the delete at the teardown stage; the artifact stays; the retry converges', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });
    const worktree = await createWorktree('ws-repo', 'torn');
    await fs.writeFile(
      path.join(worktree.path, '.emdash.json'),
      JSON.stringify({ scripts: { teardown: 'echo torn down >&2; exit 9' } })
    );
    expect((await wire.client.activateWorkspace({ id: 'wt-torn' })).success).toBe(true);

    const deleted = await wire.client.deleteWorktree({ id: 'wt-torn', deleteBranch: false });
    expect(deleted).toMatchObject({ success: false, error: { type: 'remove-failed' } });

    // Teardown failed, so nothing was removed and the record stays registered.
    await expect(fs.stat(worktree.path)).resolves.toBeDefined();
    expect((await listRecords())['wt-torn']?.lastRemovalAttempt).toMatchObject({
      stage: 'teardown',
      class: 'transient',
      message: expect.any(String),
    });

    // Teardown runs at most once per activation: the retry proceeds past it.
    const retried = await wire.client.deleteWorktree({ id: 'wt-torn', deleteBranch: false });
    expect(retried).toEqual({ success: true, data: undefined });
    await expect(fs.stat(worktree.path)).rejects.toThrow();
    expect((await listRecords())['wt-torn']).toBeUndefined();
  });

  it('deleteWorkspace records a failing teardown as a removal attempt and stays retryable', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });
    await fs.writeFile(
      path.join(repoPath, '.emdash.json'),
      JSON.stringify({ scripts: { teardown: 'exit 3' } })
    );
    expect((await wire.client.activateWorkspace({ id: 'ws-repo' })).success).toBe(true);

    const deleted = await wire.client.deleteWorkspace({ id: 'ws-repo' });
    expect(deleted).toMatchObject({ success: false, error: { type: 'remove-failed' } });
    expect((await listRecords())['ws-repo']?.lastRemovalAttempt).toMatchObject({
      stage: 'teardown',
      class: 'transient',
    });

    const retried = await wire.client.deleteWorkspace({ id: 'ws-repo' });
    expect(retried).toEqual({ success: true, data: undefined });
    // Unregister never touches the artifact.
    await expect(fs.stat(repoPath)).resolves.toBeDefined();
    expect((await listRecords())['ws-repo']).toBeUndefined();
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
