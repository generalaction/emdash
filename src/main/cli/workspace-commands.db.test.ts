import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { computeWorkspaceKey } from '@main/core/workspaces/workspace-key';
import { tasks, workspaces } from '@main/db/schema';
import { makePtySessionId } from '@shared/ptySessionId';
import {
  createWorkspace,
  listWorkspaces,
  removeWorkspace,
  resolveProject,
  sendToWorkspace,
  type TmuxRunner,
} from './workspace-commands';

type Fixture = Awaited<ReturnType<typeof openFixture>>;

/** Records tmux calls and reports which sessions "exist". */
function fakeTmux(present: string[] = []) {
  const live = new Set(present);
  const calls: Array<{ name: string; keys: string[] }> = [];
  const runner: TmuxRunner = {
    hasSession: (name) => live.has(name),
    sendKeys: (name, keys) => {
      calls.push({ name, keys });
      return true;
    },
  };
  return { runner, calls };
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  })
    .toString()
    .trim();
}

/** Creates a git repo with a single commit on `main`. */
function initRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init');
  git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  fs.writeFileSync(path.join(dir, 'README.md'), '# test\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'init');
}

function localBranches(repo: string): string[] {
  return git(repo, 'branch', '--format=%(refname:short)')
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean);
}

/** Adds a bare `origin` remote with `main` pushed + fetched (so origin/main exists). */
function addOrigin(repo: string, dir: string): void {
  git(dir, 'init', '--bare', 'origin.git');
  git(repo, 'remote', 'add', 'origin', path.join(dir, 'origin.git'));
  git(repo, 'push', 'origin', 'main');
  git(repo, 'fetch', 'origin');
}

describe('workspace cli commands', () => {
  let fixture: Fixture;
  let tmpRoot: string;
  let repoPath: string;
  let worktreeDir: string;
  const projectId = 'project-1';
  const proj = (baseRef = 'main') => ({ id: projectId, name: 'Acme', path: repoPath, baseRef });

  beforeEach(async () => {
    fixture = await openFixture('empty');
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-cli-test-'));
    repoPath = path.join(tmpRoot, 'repo');
    worktreeDir = path.join(tmpRoot, 'worktrees');
    initRepo(repoPath);

    fixture.sqlite
      .prepare(
        `INSERT INTO projects (id, name, path, workspace_provider, base_ref, created_at, updated_at)
         VALUES (?, 'Acme', ?, 'local', 'main', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run(projectId, repoPath);
  });

  afterEach(() => {
    fixture.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('resolveProject', () => {
    it('resolves by name (case-insensitive) and by id', async () => {
      await expect(resolveProject(fixture.db, 'acme')).resolves.toMatchObject({
        id: projectId,
        name: 'Acme',
        path: repoPath,
      });
      await expect(resolveProject(fixture.db, projectId)).resolves.toMatchObject({
        id: projectId,
      });
    });

    it('throws when the project is unknown', async () => {
      await expect(resolveProject(fixture.db, 'nope')).rejects.toThrow(/not found/i);
    });
  });

  describe('listWorkspaces', () => {
    beforeEach(() => {
      // Active workspace + task.
      fixture.sqlite
        .prepare(`INSERT INTO workspaces (id, type, path, key) VALUES (?, 'local', ?, ?)`)
        .run('ws-active', '/x/worktrees/Acme/feat-a', 'key-a');
      fixture.sqlite
        .prepare(
          `INSERT INTO tasks (id, project_id, name, status, task_branch, workspace_id,
             created_at, updated_at, status_changed_at)
           VALUES ('t-active', ?, 'A', 'in_progress', 'feat-a', 'ws-active',
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .run(projectId);

      // Archived workspace + task.
      fixture.sqlite
        .prepare(`INSERT INTO workspaces (id, type, path, key) VALUES (?, 'local', ?, ?)`)
        .run('ws-archived', '/x/worktrees/Acme/feat-b', 'key-b');
      fixture.sqlite
        .prepare(
          `INSERT INTO tasks (id, project_id, name, status, task_branch, workspace_id, archived_at,
             created_at, updated_at, status_changed_at)
           VALUES ('t-archived', ?, 'B', 'in_progress', 'feat-b', 'ws-archived', CURRENT_TIMESTAMP,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .run(projectId);
    });

    it('returns non-archived workspaces by default', async () => {
      const items = await listWorkspaces(fixture.db);
      expect(items.map((i) => i.id)).toEqual(['ws-active']);
      expect(items[0]).toMatchObject({
        type: 'local',
        branch: 'feat-a',
        project: 'Acme',
        archived: false,
      });
    });

    it('includes archived workspaces with --include-archived', async () => {
      const items = await listWorkspaces(fixture.db, { includeArchived: true });
      expect(new Set(items.map((i) => i.id))).toEqual(new Set(['ws-active', 'ws-archived']));
      expect(items.find((i) => i.id === 'ws-archived')?.archived).toBe(true);
    });

    it('filters by project name', async () => {
      expect(await listWorkspaces(fixture.db, { project: 'acme' })).toHaveLength(1);
      expect(await listWorkspaces(fixture.db, { project: 'other' })).toHaveLength(0);
    });
  });

  describe('createWorkspace', () => {
    it('creates a DB row + git worktree shaped like a UI-created workspace', async () => {
      const result = await createWorkspace(fixture.db, {
        project: { id: projectId, name: 'Acme', path: repoPath, baseRef: 'main' },
        branch: 'feature/login',
        base: 'main',
        worktreeDirectory: worktreeDir,
      });

      expect(result.reused).toBe(false);
      expect(result.type).toBe('local');
      expect(result.branch).toBe('feature/login');

      // Worktree exists on disk on the new branch.
      expect(fs.existsSync(path.join(result.path, '.git'))).toBe(true);
      expect(localBranches(repoPath)).toContain('feature/login');
      expect(result.path.startsWith(worktreeDir)).toBe(true);

      // Workspace row matches the in-app shape: type 'local' + sha256 key over the path.
      const [ws] = await fixture.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, result.workspaceId));
      expect(ws).toMatchObject({ type: 'local', path: result.path });
      expect(ws!.key).toBe(computeWorkspaceKey('local', result.path));
      expect(result.key).toBe(ws!.key);

      // A parent task row was created and linked (so it shows in the sidebar).
      const [task] = await fixture.db.select().from(tasks).where(eq(tasks.id, result.taskId));
      expect(task).toMatchObject({
        projectId,
        taskBranch: 'feature/login',
        status: 'in_progress',
        workspaceId: result.workspaceId,
      });
      expect(JSON.parse(task!.sourceBranch as unknown as string)).toEqual({
        type: 'local',
        branch: 'main',
      });
    });

    it('is idempotent: re-running returns the existing workspace', async () => {
      const first = await createWorkspace(fixture.db, {
        project: { id: projectId, name: 'Acme', path: repoPath, baseRef: 'main' },
        branch: 'feature/dup',
        worktreeDirectory: worktreeDir,
      });
      const second = await createWorkspace(fixture.db, {
        project: { id: projectId, name: 'Acme', path: repoPath, baseRef: 'main' },
        branch: 'feature/dup',
        worktreeDirectory: worktreeDir,
      });

      expect(second.reused).toBe(true);
      expect(second.workspaceId).toBe(first.workspaceId);

      const branchTasks = await fixture.db
        .select()
        .from(tasks)
        .where(eq(tasks.taskBranch, 'feature/dup'));
      expect(branchTasks).toHaveLength(1);
    });

    it('checks out an existing branch', async () => {
      git(repoPath, 'branch', 'already-here');
      const result = await createWorkspace(fixture.db, {
        project: { id: projectId, name: 'Acme', path: repoPath, baseRef: 'main' },
        branch: 'already-here',
        strategy: 'checkout-existing',
        worktreeDirectory: worktreeDir,
      });
      expect(fs.existsSync(path.join(result.path, '.git'))).toBe(true);
      expect(result.path.endsWith(path.join('already-here'))).toBe(true);
    });

    it('supports no-worktree workspaces rooted at the repo', async () => {
      const result = await createWorkspace(fixture.db, {
        project: { id: projectId, name: 'Acme', path: repoPath, baseRef: 'main' },
        strategy: 'no-worktree',
        name: 'rootless',
        worktreeDirectory: worktreeDir,
      });
      expect(result.branch).toBeNull();
      expect(result.path).toBe(repoPath);
      expect(result.key).toBe(computeWorkspaceKey('local', repoPath));
    });

    // Regression: staub's base_ref is `origin/main` (remote), which used to fail
    // with branch-not-found because the source was assumed to be a local ref.
    it('forks from a remote base ref (origin/main)', async () => {
      addOrigin(repoPath, tmpRoot);
      const result = await createWorkspace(fixture.db, {
        project: proj('origin/main'),
        branch: 'feature/from-remote',
        base: 'origin/main',
        worktreeDirectory: worktreeDir,
      });

      expect(fs.existsSync(path.join(result.path, '.git'))).toBe(true);
      expect(localBranches(repoPath)).toContain('feature/from-remote');

      const [task] = await fixture.db.select().from(tasks).where(eq(tasks.id, result.taskId));
      expect(JSON.parse(task!.sourceBranch as unknown as string)).toMatchObject({
        type: 'remote',
        branch: 'main',
        remote: { name: 'origin' },
      });
    });

    // Regression: a git failure must not leave orphaned task/workspace rows.
    it('is atomic — a git failure writes no rows', async () => {
      await expect(
        createWorkspace(fixture.db, {
          project: proj(),
          branch: 'feature/atomic',
          base: 'does-not-exist',
          worktreeDirectory: worktreeDir,
        })
      ).rejects.toThrow(/Failed to create worktree|branch-not-found/);

      expect(await fixture.db.select().from(tasks)).toHaveLength(0);
      expect(await fixture.db.select().from(workspaces)).toHaveLength(0);
    });

    it('launches an agent and seeds the prompt (--prompt, default agent claude)', async () => {
      const calls: Array<Record<string, unknown>> = [];
      const result = await createWorkspace(fixture.db, {
        project: proj(),
        branch: 'feature/dispatch',
        worktreeDirectory: worktreeDir,
        prompt: 'do the thing',
        autoApprove: true,
        dispatch: async (a) => {
          calls.push(a);
          return { delivered: true, promptDelivered: true, tmuxSession: 'sess' };
        },
      });

      expect(result.agent).toBe('claude');
      expect(result.conversationId).toBeTruthy();
      expect(result.promptDelivered).toBe(true);

      // Dispatcher got the worktree cwd + prompt + provider.
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        cwd: result.path,
        prompt: 'do the thing',
        providerId: 'claude',
        autoApprove: true,
        conversationId: result.conversationId,
      });

      // A conversation row was written (so the app adopts the same session).
      const conv = fixture.sqlite
        .prepare(
          'SELECT id, provider, config, is_initial_conversation FROM conversations WHERE task_id = ?'
        )
        .get(result.taskId) as
        | { id: string; provider: string; config: string | null; is_initial_conversation: number }
        | undefined;
      expect(conv?.provider).toBe('claude');
      expect(conv?.is_initial_conversation).toBe(1);
      expect(JSON.parse(conv!.config!)).toEqual({ autoApprove: true });
    });

    it('rejects an unknown agent provider', async () => {
      await expect(
        createWorkspace(fixture.db, {
          project: proj(),
          branch: 'feature/bad-agent',
          worktreeDirectory: worktreeDir,
          prompt: 'x',
          agent: 'not-a-real-agent',
          dispatch: async () => ({ delivered: true, promptDelivered: true, tmuxSession: 's' }),
        })
      ).rejects.toThrow(/unknown agent/i);
    });

    it('publishes the branch with --push-branch', async () => {
      addOrigin(repoPath, tmpRoot);
      const result = await createWorkspace(fixture.db, {
        project: proj('origin/main'),
        branch: 'feature/pushed',
        base: 'origin/main',
        worktreeDirectory: worktreeDir,
        pushBranch: true,
      });
      expect(result.pushed).toBe(true);
      // The branch now exists on the origin remote.
      expect(git(repoPath, 'ls-remote', '--heads', 'origin', 'feature/pushed')).toContain(
        'feature/pushed'
      );
    });
  });

  describe('removeWorkspace', () => {
    const seed = (branch = 'feature/rm') =>
      createWorkspace(fixture.db, { project: proj(), branch, worktreeDirectory: worktreeDir });

    it('tears down worktree + branch + rows, idempotently', async () => {
      const created = await seed();

      const res = await removeWorkspace(fixture.db, {
        project: proj(),
        branch: 'feature/rm',
        worktreeDirectory: worktreeDir,
      });

      expect(res).toMatchObject({
        removedWorktree: true,
        removedBranch: true,
        deletedWorkspace: true,
        deletedTasks: 1,
        alreadyGone: false,
      });
      expect(fs.existsSync(created.path)).toBe(false);
      expect(localBranches(repoPath)).not.toContain('feature/rm');
      expect(
        await fixture.db.select().from(workspaces).where(eq(workspaces.id, created.workspaceId))
      ).toHaveLength(0);

      // Re-running is a no-op.
      const again = await removeWorkspace(fixture.db, {
        project: proj(),
        branch: 'feature/rm',
        worktreeDirectory: worktreeDir,
      });
      expect(again.alreadyGone).toBe(true);
    });

    it('removes by workspace id', async () => {
      const created = await seed('feature/byid');
      const res = await removeWorkspace(fixture.db, {
        project: proj(),
        id: created.workspaceId,
        worktreeDirectory: worktreeDir,
      });
      expect(res.deletedWorkspace).toBe(true);
      expect(fs.existsSync(created.path)).toBe(false);
    });

    it('refuses to remove a workspace owned by another project (--id safety)', async () => {
      // Seed a second project with its own workspace + task.
      fixture.sqlite
        .prepare(
          `INSERT INTO projects (id, name, path, workspace_provider, base_ref, created_at, updated_at)
           VALUES ('other', 'Other', '/other/repo', 'local', 'main', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .run();
      fixture.sqlite
        .prepare(
          `INSERT INTO workspaces (id, type, path, key) VALUES ('ws-other', 'local', '/x/y', 'k-other')`
        )
        .run();
      fixture.sqlite
        .prepare(
          `INSERT INTO tasks (id, project_id, name, status, task_branch, workspace_id, created_at, updated_at, status_changed_at)
           VALUES ('t-other', 'other', 'O', 'in_progress', 'feat-o', 'ws-other', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .run();

      const res = await removeWorkspace(fixture.db, {
        project: proj(), // Acme — NOT the owner of ws-other
        id: 'ws-other',
        worktreeDirectory: worktreeDir,
      });
      expect(res.alreadyGone).toBe(true);
      // The other project's workspace + task are untouched.
      expect(
        await fixture.db.select().from(workspaces).where(eq(workspaces.id, 'ws-other'))
      ).toHaveLength(1);
    });

    it('does not delete a worktree path outside the project pool (rm guard)', async () => {
      const strayDir = path.join(tmpRoot, 'stray-not-a-worktree');
      fs.mkdirSync(strayDir, { recursive: true });
      fs.writeFileSync(path.join(strayDir, 'important.txt'), 'keep me\n');
      fixture.sqlite
        .prepare(
          `INSERT INTO workspaces (id, type, path, key) VALUES ('ws-stray', 'local', ?, 'k-stray')`
        )
        .run(strayDir);
      fixture.sqlite
        .prepare(
          `INSERT INTO tasks (id, project_id, name, status, workspace_id, created_at, updated_at, status_changed_at)
           VALUES ('t-stray', ?, 'S', 'in_progress', 'ws-stray', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .run(projectId);

      const res = await removeWorkspace(fixture.db, {
        project: proj(),
        id: 'ws-stray',
        worktreeDirectory: worktreeDir,
      });
      // Row deleted, but the out-of-pool directory is NOT recursively removed.
      expect(res.deletedWorkspace).toBe(true);
      expect(res.removedWorktree).toBe(false);
      expect(fs.existsSync(path.join(strayDir, 'important.txt'))).toBe(true);
    });

    it('runs the pre-remove hook (capture) before teardown', async () => {
      await seed('feature/hook');
      const marker = path.join(tmpRoot, 'captured.txt');
      const res = await removeWorkspace(fixture.db, {
        project: proj(),
        branch: 'feature/hook',
        worktreeDirectory: worktreeDir,
        preRemoveCmd: `printf '%s' "$EMDASH_BRANCH" > ${marker}`,
      });
      expect(res.hookRan).toBe(true);
      expect(fs.readFileSync(marker, 'utf8')).toBe('feature/hook');
      expect(res.deletedWorkspace).toBe(true);
    });

    it('aborts when the hook fails — nothing deleted — unless forced', async () => {
      const created = await seed('feature/abort');

      await expect(
        removeWorkspace(fixture.db, {
          project: proj(),
          branch: 'feature/abort',
          worktreeDirectory: worktreeDir,
          preRemoveCmd: 'exit 3',
        })
      ).rejects.toThrow(/code 3/);

      // Hook failure → worktree + rows still present.
      expect(fs.existsSync(created.path)).toBe(true);
      expect(
        await fixture.db.select().from(workspaces).where(eq(workspaces.id, created.workspaceId))
      ).toHaveLength(1);

      // --force tears down despite the failing hook.
      const forced = await removeWorkspace(fixture.db, {
        project: proj(),
        branch: 'feature/abort',
        worktreeDirectory: worktreeDir,
        preRemoveCmd: 'exit 3',
        force: true,
      });
      expect(forced.deletedWorkspace).toBe(true);
      expect(fs.existsSync(created.path)).toBe(false);
    });

    const seedUnmerged = async (branch: string) => {
      const created = await seed(branch);
      fs.writeFileSync(path.join(created.path, 'extra.txt'), 'work\n');
      git(created.path, 'add', '.');
      git(created.path, 'commit', '-m', 'unmerged work');
      return created;
    };

    it('keeps a branch with unmerged commits (no silent loss)', async () => {
      await seedUnmerged('feature/unmerged');
      const res = await removeWorkspace(fixture.db, {
        project: proj(),
        branch: 'feature/unmerged',
        worktreeDirectory: worktreeDir,
      });
      // Worktree + rows torn down, but the branch is preserved (has unmerged work).
      expect(res.removedWorktree).toBe(true);
      expect(res.deletedWorkspace).toBe(true);
      expect(res.removedBranch).toBe(false);
      expect(res.branchRetained).toBe('unmerged');
      expect(localBranches(repoPath)).toContain('feature/unmerged');
    });

    it('force-deletes an unmerged branch with --force', async () => {
      await seedUnmerged('feature/unmerged-forced');
      const res = await removeWorkspace(fixture.db, {
        project: proj(),
        branch: 'feature/unmerged-forced',
        worktreeDirectory: worktreeDir,
        force: true,
      });
      expect(res.removedBranch).toBe(true);
      expect(res.branchRetained).toBeUndefined();
      expect(localBranches(repoPath)).not.toContain('feature/unmerged-forced');
    });

    it('skips the hook with skipHook', async () => {
      const created = await seed('feature/skip');
      const res = await removeWorkspace(fixture.db, {
        project: proj(),
        branch: 'feature/skip',
        worktreeDirectory: worktreeDir,
        preRemoveCmd: 'exit 1',
        skipHook: true,
      });
      expect(res.hookRan).toBe(false);
      expect(res.deletedWorkspace).toBe(true);
      expect(fs.existsSync(created.path)).toBe(false);
    });
  });

  describe('sendToWorkspace', () => {
    // Seeds a task + (optionally) a conversation, returning the derived tmux name.
    function seedAgent(branch: string, opts: { conversationId?: string; initial?: boolean } = {}) {
      const taskId = `task-${branch.replace(/\W/g, '-')}`;
      fixture.sqlite
        .prepare(
          `INSERT INTO tasks (id, project_id, name, status, task_branch, created_at, updated_at, status_changed_at, last_interacted_at)
           VALUES (?, ?, ?, 'in_progress', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .run(taskId, projectId, branch, branch);

      let tmuxName: string | undefined;
      if (opts.conversationId) {
        fixture.sqlite
          .prepare(
            `INSERT INTO conversations (id, project_id, task_id, title, provider, is_initial_conversation, created_at, updated_at, last_interacted_at)
             VALUES (?, ?, ?, 'Agent', 'claude', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
          )
          .run(opts.conversationId, projectId, taskId, opts.initial ? 1 : 0);
        tmuxName = makeTmuxSessionName(makePtySessionId(projectId, taskId, opts.conversationId));
      }
      return { taskId, tmuxName };
    }

    it('dispatches text then a separate Enter into the agent tmux session', async () => {
      const { tmuxName } = seedAgent('feature/send', { conversationId: 'conv-1', initial: true });
      const { runner, calls } = fakeTmux([tmuxName!]);

      const res = await sendToWorkspace(
        fixture.db,
        { project: proj(), branch: 'feature/send', message: 'run the tests' },
        runner
      );

      expect(res).toMatchObject({
        delivered: true,
        conversationId: 'conv-1',
        tmuxSession: tmuxName,
      });
      // Text and submit-Enter are TWO separate send-keys calls (TUI submit quirk);
      // `--` ends option parsing so a message starting with '-' stays literal.
      expect(calls).toEqual([
        { name: tmuxName, keys: ['-l', '--', 'run the tests'] },
        { name: tmuxName, keys: ['Enter'] },
      ]);
    });

    it('does not silently drop when no live session exists', async () => {
      seedAgent('feature/dead', { conversationId: 'conv-dead', initial: true });
      const { runner, calls } = fakeTmux([]); // session not present

      const res = await sendToWorkspace(
        fixture.db,
        { project: proj(), branch: 'feature/dead', message: 'hi' },
        runner
      );

      expect(res.delivered).toBe(false);
      expect(res.reason).toBe('no-active-session');
      expect(calls).toHaveLength(0); // nothing sent
    });

    it('reports no-conversation when the task has no agent session', async () => {
      seedAgent('feature/noconv'); // task but no conversation
      const { runner } = fakeTmux();
      const res = await sendToWorkspace(
        fixture.db,
        { project: proj(), branch: 'feature/noconv', message: 'hi' },
        runner
      );
      expect(res.delivered).toBe(false);
      expect(res.reason).toBe('no-conversation');
    });

    it('targets the initial conversation by default', async () => {
      const { taskId } = seedAgent('feature/multi', {
        conversationId: 'conv-secondary',
        initial: false,
      });
      // Add the initial conversation for the same task.
      fixture.sqlite
        .prepare(
          `INSERT INTO conversations (id, project_id, task_id, title, provider, is_initial_conversation, created_at, updated_at, last_interacted_at)
           VALUES ('conv-initial', ?, ?, 'Agent', 'claude', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        )
        .run(projectId, taskId);
      const initialTmux = makeTmuxSessionName(makePtySessionId(projectId, taskId, 'conv-initial'));
      const { runner } = fakeTmux([initialTmux]);

      const res = await sendToWorkspace(
        fixture.db,
        { project: proj(), branch: 'feature/multi', message: 'go' },
        runner
      );
      expect(res.delivered).toBe(true);
      expect(res.conversationId).toBe('conv-initial');
    });
  });
});
