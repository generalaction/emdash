import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ManualClock } from '@emdash/shared/testing';
import { remote, snapshot } from '@emdash/wire/state';
import { createTestWire, type TestWire } from '@emdash/wire/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TempStoreHandle } from '#primitives/sqlite-store/api';
import { workspaceRegistryContract } from '#runtimes/workspace-registry/api';
import { WorkspaceRecordStore } from '#runtimes/workspace-registry/node/persistence/record-store';
import {
  workspaceRegistryStore,
  type WorkspaceRegistryDb,
} from '#runtimes/workspace-registry/node/persistence/store';
import { WorkspaceRegistryRuntime } from '#runtimes/workspace-registry/node/runtime';
import { WorkspaceScanScheduler } from '#runtimes/workspace-registry/node/scan/scheduler';
import { nativeWatchBackend } from '#services/fs-watch/impl/native-backend';
import { createWatchService } from '#services/fs-watch/impl/watch-service';
import { createWorkspaceRegistryController } from './controller';

async function eventually(assertion: () => Promise<void>, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

// Contract-seam tests for the host workspace registry (ADR 0005), against real SQLite
// and real git repositories in a temp dir. Property statements under test:
//
// - Sole writer: every mutation goes through the wire contract — the only client-facing
//   write path; the `records` live model is the sole read path.
// - Kind is host-detected, never client-supplied.
// - Identity: ids are minted by the caller on create verbs and never reused; path is a
//   mutable unique attribute, not the identity.
// - Deletes are idempotent facts, not desired state.

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

async function makeWorktree(repoPath: string, root: string, name: string): Promise<string> {
  const worktreePath = path.join(root, name);
  git(repoPath, 'worktree', 'add', worktreePath, '-b', `branch-${name}`);
  return await fs.realpath(worktreePath);
}

/** One lifecycle step from a wire record's runtime projection, by id. */
function lifecycleStep(
  record: { runtime: { lifecycle?: Array<{ id: string }> | null } | null } | undefined,
  id: string
) {
  return record?.runtime?.lifecycle?.find((step) => step.id === id);
}

describe('workspace registry contract', () => {
  let root: string;
  let handle: TempStoreHandle<WorkspaceRegistryDb>;
  let clock: ManualClock;
  let runtime: WorkspaceRegistryRuntime;
  let wire: TestWire<typeof workspaceRegistryContract>;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ws-registry-')));
    handle = await workspaceRegistryStore.openTemp();
    clock = new ManualClock(10_000);
    runtime = new WorkspaceRegistryRuntime({ handle, clock });
    wire = createTestWire(workspaceRegistryContract, createWorkspaceRegistryController(runtime));
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

  it('createWorkspace detects a repository and the records model lists it', async () => {
    const repoPath = await makeRepo(root, 'repo');

    const created = await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });
    expect(created).toEqual({
      success: true,
      data: {
        id: 'ws-repo',
        kind: 'repository',
        path: repoPath,
        parentId: null,
        origin: 'registered',
        gitAdminName: null,
        observedStatus: 'present',
        creation: null,
        lastCreateOutcome: null,
        lifecycle: null,
        lastRemovalAttempt: null,
        git: null,
        lastActivatedAt: null,
        createdAt: 10_000,
        updatedAt: 10_000,
        lastObservedAt: 10_000,
        runtime: null,
      },
    });

    const records = await listRecords();
    expect(Object.keys(records)).toEqual(['ws-repo']);
  });

  it('createWorkspace detects a plain directory (including subdirectories of a repo)', async () => {
    const plain = path.join(root, 'plain');
    await fs.mkdir(plain);
    const created = await wire.client.createWorkspace({ id: 'ws-dir', path: plain });
    expect(created).toMatchObject({ success: true, data: { kind: 'directory' } });

    const repoPath = await makeRepo(root, 'repo-with-sub');
    const sub = path.join(repoPath, 'packages');
    await fs.mkdir(sub);
    const subCreated = await wire.client.createWorkspace({ id: 'ws-sub', path: sub });
    expect(subCreated).toMatchObject({ success: true, data: { kind: 'directory' } });
  });

  it('createWorkspace on a worktree auto-registers the parent repository as adopted', async () => {
    const repoPath = await makeRepo(root, 'repo');
    const worktreePath = await makeWorktree(repoPath, root, 'wt-1');

    const created = await wire.client.createWorkspace({ id: 'ws-wt', path: worktreePath });
    expect(created).toMatchObject({
      success: true,
      data: {
        kind: 'worktree',
        path: worktreePath,
        origin: 'registered',
        gitAdminName: 'wt-1',
      },
    });
    if (!created.success) throw new Error('expected success');
    const parentId = created.data.parentId;
    expect(parentId).not.toBeNull();

    const records = await listRecords();
    expect(records[parentId!]).toMatchObject({
      kind: 'repository',
      path: repoPath,
      origin: 'adopted',
      parentId: null,
    });
  });

  it('createWorkspace replays idempotently and rejects a divergent path', async () => {
    const repoPath = await makeRepo(root, 'repo');
    const first = await wire.client.createWorkspace({ id: 'ws-1', path: repoPath });
    const replay = await wire.client.createWorkspace({ id: 'ws-1', path: repoPath });
    expect(replay).toEqual(first);

    const other = path.join(root, 'other');
    await fs.mkdir(other);
    const divergent = await wire.client.createWorkspace({ id: 'ws-1', path: other });
    expect(divergent).toMatchObject({
      success: false,
      error: { type: 'immutable-field-mismatch', workspaceId: 'ws-1' },
    });
  });

  it('createWorkspace hands the existing record to a second registrant of the same path', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-a', path: repoPath });

    const second = await wire.client.createWorkspace({ id: 'ws-b', path: repoPath });
    expect(second).toMatchObject({
      success: false,
      error: { type: 'already-registered', record: { id: 'ws-a', path: repoPath } },
    });
  });

  it('createWorkspace errors on a nonexistent path', async () => {
    const missing = path.join(root, 'does-not-exist');
    const created = await wire.client.createWorkspace({ id: 'ws-x', path: missing });
    expect(created).toEqual({
      success: false,
      error: { type: 'path-not-found', path: missing },
    });
  });

  it('deleteWorkspace unregisters without touching disk and is idempotent', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-1', path: repoPath });

    const deleted = await wire.client.deleteWorkspace({ id: 'ws-1' });
    expect(deleted).toEqual({ success: true, data: undefined });
    expect(await listRecords()).toEqual({});
    // The artifact is untouched.
    await fs.access(path.join(repoPath, 'README.md'));

    const again = await wire.client.deleteWorkspace({ id: 'ws-1' });
    expect(again).toEqual({ success: true, data: undefined });
    const absent = await wire.client.deleteWorkspace({ id: 'never-existed' });
    expect(absent).toEqual({ success: true, data: undefined });
  });

  it('refresh observes git state with untracked lines counted as additions', async () => {
    const repoPath = await makeRepo(root, 'repo');
    const worktreePath = await makeWorktree(repoPath, root, 'wt-1');
    const created = await wire.client.createWorkspace({ id: 'ws-wt', path: worktreePath });
    expect(created).toMatchObject({ success: true });

    // Only untracked changes: a new 3-line file plus an ignored file that must not count.
    await fs.writeFile(path.join(worktreePath, 'new-file.txt'), 'one\ntwo\nthree\n');
    await fs.writeFile(path.join(worktreePath, '.gitignore'), 'ignored.txt\n');
    await fs.writeFile(path.join(worktreePath, 'ignored.txt'), 'x\n'.repeat(100));

    const refreshed = await wire.client.refresh({ id: 'ws-wt' });
    expect(refreshed).toEqual({ success: true, data: undefined });

    const records = await listRecords();
    const record = records['ws-wt']!;
    expect(record.git).toMatchObject({
      branch: 'branch-wt-1',
      dirty: true,
      // 3 lines from new-file.txt + 1 line from .gitignore; ignored.txt excluded.
      diffStats: { added: 4, deleted: 0 },
    });
  });

  it('refresh adopts hand-made worktrees and un-adopts vanished ones', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });
    const worktreePath = await makeWorktree(repoPath, root, 'hand-made');

    await wire.client.refresh({});
    let records = await listRecords();
    const adopted = Object.values(records).find((record) => record.path === worktreePath);
    expect(adopted).toMatchObject({
      kind: 'worktree',
      origin: 'adopted',
      parentId: 'ws-repo',
      gitAdminName: 'hand-made',
      observedStatus: 'present',
    });

    // Deleted on disk: the adopted record follows the disk and disappears.
    await fs.rm(worktreePath, { recursive: true, force: true });
    await wire.client.refresh({});
    records = await listRecords();
    expect(Object.values(records).some((record) => record.path === worktreePath)).toBe(false);
  });

  it('refresh flips vanished registered workspaces to missing and back', async () => {
    const plain = path.join(root, 'plain');
    await fs.mkdir(plain);
    await wire.client.createWorkspace({ id: 'ws-dir', path: plain });

    await fs.rm(plain, { recursive: true, force: true });
    await wire.client.refresh({});
    let records = await listRecords();
    expect(records['ws-dir']).toMatchObject({ observedStatus: 'missing' });

    await fs.mkdir(plain);
    await wire.client.refresh({});
    records = await listRecords();
    expect(records['ws-dir']).toMatchObject({ observedStatus: 'present' });
  });

  it('refresh relinks a moved worktree by its admin name, preserving identity', async () => {
    const repoPath = await makeRepo(root, 'repo');
    const worktreePath = await makeWorktree(repoPath, root, 'movable');
    await wire.client.createWorkspace({ id: 'ws-moved', path: worktreePath });

    const movedPath = path.join(root, 'relocated');
    git(repoPath, 'worktree', 'move', worktreePath, movedPath);

    await wire.client.refresh({});
    const records = await listRecords();
    expect(records['ws-moved']).toMatchObject({
      id: 'ws-moved',
      path: await fs.realpath(movedPath),
      gitAdminName: 'movable',
      observedStatus: 'present',
    });
  });

  it('refresh of an unknown id is a typed not-found error', async () => {
    const refreshed = await wire.client.refresh({ id: 'unknown' });
    expect(refreshed).toEqual({
      success: false,
      error: { type: 'workspace-not-found', workspaceId: 'unknown' },
    });
  });

  it('createWorktree returns at agent-spawnable; artifacts and push land in the background', async () => {
    const repoPath = await makeRepo(root, 'repo');
    // A bare origin so the background push-branch step has somewhere to go.
    const originPath = path.join(root, 'origin.git');
    git(root, 'init', '--bare', originPath);
    git(repoPath, 'remote', 'add', 'origin', originPath);
    git(repoPath, 'push', '-u', 'origin', 'main');
    // Gitignored artifacts: they ride the background clone (the .env preserve case
    // included — ignored files are the clone set, no patterns needed).
    await fs.writeFile(path.join(repoPath, '.gitignore'), '.env\nnode_modules/\n');
    await fs.writeFile(path.join(repoPath, '.env'), 'SECRET=1\n');
    await fs.mkdir(path.join(repoPath, 'node_modules', 'dep'), { recursive: true });
    await fs.writeFile(path.join(repoPath, 'node_modules', 'dep', 'index.js'), 'ok\n');
    git(repoPath, 'add', '.gitignore');
    git(repoPath, 'commit', '-m', 'ignore env');
    await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });

    const worktreePath = path.join(root, 'feature-wt');
    const created = await wire.client.createWorktree({
      id: 'ws-new',
      repositoryId: 'ws-repo',
      branch: 'feature/new',
      baseRef: 'main',
      path: worktreePath,
      preservePatterns: ['.env'],
      pushBranch: true,
    });
    // The verb returns at agent-spawnable: worktree checked out, background pending.
    expect(created).toMatchObject({
      success: true,
      data: {
        id: 'ws-new',
        kind: 'worktree',
        parentId: 'ws-repo',
        origin: 'registered',
        observedStatus: 'present',
        creation: { branch: 'feature/new', baseRef: 'main', requestedPath: worktreePath },
        lastCreateOutcome: { status: 'succeeded' },
        git: { branch: 'feature/new' },
      },
    });
    if (!created.success) throw new Error('expected success');
    expect(created.data.gitAdminName).not.toBeNull();
    // No push happened on the critical path.
    expect(git(repoPath, 'ls-remote', '--heads', 'origin', 'feature/new')).toBe('');

    // The background steps settle: artifacts cloned, branch pushed, statuses durable.
    await eventually(async () => {
      const records = await listRecords();
      expect(lifecycleStep(records['ws-new'], 'copy-artifacts')).toMatchObject({
        status: 'succeeded',
      });
      expect(lifecycleStep(records['ws-new'], 'push-branch')).toMatchObject({
        status: 'succeeded',
      });
    });
    await fs.access(path.join(created.data.path, '.env'));
    await fs.access(path.join(created.data.path, 'node_modules', 'dep', 'index.js'));
    expect(git(repoPath, 'ls-remote', '--heads', 'origin', 'feature/new')).toContain(
      'refs/heads/feature/new'
    );
    // git status in the new worktree stays clean — artifacts are all ignored.
    expect(git(created.data.path, 'status', '--porcelain')).toBe('');
  });

  it('createWorktree failure records the stage durably and keeps the record', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });

    const worktreePath = path.join(root, 'doomed-wt');
    const created = await wire.client.createWorktree({
      id: 'ws-doomed',
      repositoryId: 'ws-repo',
      branch: 'feature/doomed',
      baseRef: 'refs/heads/does-not-exist',
      path: worktreePath,
      preservePatterns: [],
      pushBranch: false,
    });
    expect(created).toMatchObject({
      success: false,
      error: { type: 'stage-failed', stage: 'add-worktree' },
    });

    const records = await listRecords();
    expect(records['ws-doomed']).toMatchObject({
      observedStatus: 'missing',
      lastCreateOutcome: { status: 'failed', stage: 'add-worktree' },
    });
    // The failed pipeline leaves a failed lifecycle step carrying git's message.
    expect(lifecycleStep(records['ws-doomed'], 'create-worktree')).toMatchObject({
      status: 'failed',
    });
  });

  it('createWorktree replays: succeeded is a no-op, a failed push retries manually, divergent errors', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });
    const worktreePath = path.join(root, 'retry-wt');
    const input = {
      id: 'ws-retry',
      repositoryId: 'ws-repo',
      branch: 'feature/retry',
      baseRef: 'main',
      path: worktreePath,
      preservePatterns: [],
      // No remote: the background push fails, but never the creation itself.
      pushBranch: true,
    };

    const first = await wire.client.createWorktree(input);
    expect(first).toMatchObject({
      success: true,
      data: { lastCreateOutcome: { status: 'succeeded' } },
    });

    // The push failure is a durable, non-blocking "branch not pushed" state.
    await eventually(async () => {
      const records = await listRecords();
      expect(lifecycleStep(records['ws-retry'], 'push-branch')).toMatchObject({
        status: 'failed',
      });
    });

    const replay = await wire.client.createWorktree(input);
    expect(replay).toMatchObject({
      success: true,
      data: { lastCreateOutcome: { status: 'succeeded' } },
    });

    // The transient condition clears; one manual retry pushes the branch.
    const originPath = path.join(root, 'origin.git');
    git(root, 'init', '--bare', originPath);
    git(repoPath, 'remote', 'add', 'origin', originPath);
    const retried = await wire.client.retryStep({ id: 'ws-retry', step: 'push-branch' });
    expect(retried).toMatchObject({ success: true });
    if (!retried.success) throw new Error('expected success');
    expect(lifecycleStep(retried.data, 'push-branch')).toMatchObject({ status: 'succeeded' });
    expect(git(repoPath, 'ls-remote', '--heads', 'origin', 'feature/retry')).toContain(
      'refs/heads/feature/retry'
    );

    const divergent = await wire.client.createWorktree({ ...input, baseRef: 'other-base' });
    expect(divergent).toMatchObject({
      success: false,
      error: { type: 'immutable-field-mismatch', workspaceId: 'ws-retry' },
    });
  });

  it('an interrupted creation reads as started with no overlay and retries to success', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });
    const worktreePath = path.join(root, 'interrupted-wt');

    // Simulated daemon crash mid-flight: the durable registration exists ('started'),
    // the pipeline never finished, and the rebuilt runtime has no overlay.
    const store = new WorkspaceRecordStore(handle);
    store.insert({
      id: 'ws-interrupted',
      kind: 'worktree',
      path: worktreePath,
      parentId: 'ws-repo',
      origin: 'registered',
      gitAdminName: null,
      observedStatus: 'missing',
      creation: { branch: 'feature/interrupted', baseRef: 'main', requestedPath: worktreePath },
      lastCreateOutcome: { status: 'started', at: 9_000 },
      lifecycle: null,
      lastRemovalAttempt: null,
      git: null,
      lastActivatedAt: null,
      createdAt: 9_000,
      updatedAt: 9_000,
      lastObservedAt: 9_000,
    });
    wire.dispose();
    runtime.dispose();
    runtime = new WorkspaceRegistryRuntime({ handle, clock });
    wire = createTestWire(workspaceRegistryContract, createWorkspaceRegistryController(runtime));

    const records = await listRecords();
    expect(records['ws-interrupted']).toMatchObject({
      lastCreateOutcome: { status: 'started' },
      observedStatus: 'missing',
      runtime: null,
    });

    // The host never re-converges on its own — only a client retry resolves it.
    const retried = await wire.client.createWorktree({
      id: 'ws-interrupted',
      repositoryId: 'ws-repo',
      branch: 'feature/interrupted',
      baseRef: 'main',
      path: worktreePath,
      preservePatterns: [],
      pushBranch: false,
    });
    expect(retried).toMatchObject({
      success: true,
      data: { observedStatus: 'present', lastCreateOutcome: { status: 'succeeded' } },
    });
  });

  it('concurrent same-repository creations serialize and both succeed', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-repo', path: repoPath });

    const [a, b] = await Promise.all([
      wire.client.createWorktree({
        id: 'ws-a',
        repositoryId: 'ws-repo',
        branch: 'feature/a',
        baseRef: 'main',
        path: path.join(root, 'wt-a'),
        preservePatterns: [],
        pushBranch: false,
      }),
      wire.client.createWorktree({
        id: 'ws-b',
        repositoryId: 'ws-repo',
        branch: 'feature/b',
        baseRef: 'main',
        path: path.join(root, 'wt-b'),
        preservePatterns: [],
        pushBranch: false,
      }),
    ]);
    expect(a).toMatchObject({
      success: true,
      data: { lastCreateOutcome: { status: 'succeeded' } },
    });
    expect(b).toMatchObject({
      success: true,
      data: { lastCreateOutcome: { status: 'succeeded' } },
    });
  });

  it('fs events refresh observations without any client call', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-live', path: repoPath });

    const watchService = createWatchService({ backend: nativeWatchBackend() });
    const scheduler = new WorkspaceScanScheduler({
      watcher: watchService,
      execute: (request) => runtime.executeScanRequest(request),
      listTargets: () => runtime.scanTargets(),
      isActive: () => false,
      debounceMs: 25,
      pollIntervalMs: 60 * 60_000,
    });
    runtime.setOnRecordsChanged(() => scheduler.syncWatches());
    scheduler.start();
    try {
      await fs.writeFile(path.join(repoPath, 'untracked.txt'), 'a\nb\n');
      await eventually(async () => {
        const records = await listRecords();
        expect(records['ws-live']?.git).toMatchObject({
          dirty: true,
          diffStats: { added: 2, deleted: 0 },
        });
      });
    } finally {
      await scheduler.dispose();
      await watchService.dispose();
    }
  });

  it('registry state survives a runtime rebuild over the same store', async () => {
    const repoPath = await makeRepo(root, 'repo');
    await wire.client.createWorkspace({ id: 'ws-1', path: repoPath });

    // Simulated daemon restart: new runtime over the same durable store.
    wire.dispose();
    runtime.dispose();
    runtime = new WorkspaceRegistryRuntime({ handle, clock });
    wire = createTestWire(workspaceRegistryContract, createWorkspaceRegistryController(runtime));

    const records = await listRecords();
    expect(records['ws-1']).toMatchObject({ id: 'ws-1', kind: 'repository', path: repoPath });
  });
});
