import crypto from 'node:crypto';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projects, tasks, workspaces } from '@main/db/schema';
import { WorkspaceBootstrapService, type WorktreeContext } from './workspace-bootstrap-service';
import { computeWorkspaceKey } from './workspace-key';

// Prevent the module-level singleton from attempting to open the Electron app DB.
vi.mock('@main/db/client', () => ({ db: {}, sqlite: {} }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<WorktreeContext> = {}): WorktreeContext {
  return {
    connectionId: undefined,
    repoPath: '/repo/root',
    worktreeService: {
      existsAtAbsolutePath: vi.fn().mockResolvedValue(false),
      findBranchAnywhere: vi.fn().mockResolvedValue(undefined),
      checkoutExistingBranch: vi
        .fn()
        .mockResolvedValue({ success: true, data: '/worktrees/branch' }),
      checkoutBranchWorktree: vi
        .fn()
        .mockResolvedValue({ success: true, data: '/worktrees/branch' }),
    },
    ...overrides,
  };
}

const PROJECT_ID = 'proj-1';
const TASK_ID = 'task-1';
const WS_ID = 'ws-1';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('WorkspaceBootstrapService', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let svc: WorkspaceBootstrapService;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    svc = new WorkspaceBootstrapService(fixture.db);

    // Seed a minimal project and workspace row; task is seeded per-test
    await fixture.db
      .insert(projects)
      .values({ id: PROJECT_ID, name: 'Test Project', path: '/repo/root' });
    await fixture.db.insert(workspaces).values({ id: WS_ID, type: 'local' });
    await fixture.db.insert(tasks).values({
      id: TASK_ID,
      projectId: PROJECT_ID,
      name: 'Test Task',
      status: 'active',
      workspaceId: WS_ID,
    });
  });

  afterEach(() => {
    fixture.close();
  });

  // -------------------------------------------------------------------------
  // resolveBootstrap
  // -------------------------------------------------------------------------

  describe('resolveBootstrap', () => {
    it('returns ready when workspace path exists on disk', async () => {
      await fixture.db
        .update(workspaces)
        .set({ path: '/worktrees/branch' })
        .where(eq(workspaces.id, WS_ID));

      const ctx = makeCtx({
        worktreeService: {
          ...makeCtx().worktreeService,
          existsAtAbsolutePath: vi.fn().mockResolvedValue(true),
        },
      });

      const result = await svc.resolveBootstrap(TASK_ID, ctx);
      expect(result).toEqual({ kind: 'ready' });
    });

    it('persists path and returns ready when branch found via findBranchAnywhere', async () => {
      const ctx = makeCtx({
        worktreeService: {
          ...makeCtx().worktreeService,
          findBranchAnywhere: vi.fn().mockResolvedValue('/worktrees/found-branch'),
        },
      });

      await fixture.db.update(tasks).set({ taskBranch: 'my-branch' }).where(eq(tasks.id, TASK_ID));

      const result = await svc.resolveBootstrap(TASK_ID, ctx);
      expect(result).toEqual({ kind: 'ready' });

      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.path).toBe('/worktrees/found-branch');
      expect(ws.key).toBe(computeWorkspaceKey('local', '/worktrees/found-branch'));
    });

    it('returns needs_create when no path and no branch', async () => {
      const result = await svc.resolveBootstrap(TASK_ID, makeCtx());
      expect(result).toEqual({ kind: 'needs_create' });
    });

    it('returns needs_create when no path and branch not found anywhere', async () => {
      await fixture.db.update(tasks).set({ taskBranch: 'my-branch' }).where(eq(tasks.id, TASK_ID));

      const result = await svc.resolveBootstrap(TASK_ID, makeCtx());
      expect(result).toEqual({ kind: 'needs_create' });
    });

    it('returns branch_elsewhere when path is set but missing and branch found at a new path', async () => {
      await fixture.db
        .update(workspaces)
        .set({ path: '/old/path' })
        .where(eq(workspaces.id, WS_ID));
      await fixture.db.update(tasks).set({ taskBranch: 'my-branch' }).where(eq(tasks.id, TASK_ID));

      const ctx = makeCtx({
        worktreeService: {
          ...makeCtx().worktreeService,
          existsAtAbsolutePath: vi.fn().mockResolvedValue(false),
          findBranchAnywhere: vi.fn().mockResolvedValue('/new/path'),
        },
      });

      const result = await svc.resolveBootstrap(TASK_ID, ctx);
      expect(result).toEqual({
        kind: 'branch_elsewhere',
        taskBranch: 'my-branch',
        candidatePath: '/new/path',
        previousPath: '/old/path',
      });
    });

    it('returns path_missing when path set, missing on disk, branch not found', async () => {
      await fixture.db
        .update(workspaces)
        .set({ path: '/old/path' })
        .where(eq(workspaces.id, WS_ID));
      await fixture.db.update(tasks).set({ taskBranch: 'my-branch' }).where(eq(tasks.id, TASK_ID));

      const result = await svc.resolveBootstrap(TASK_ID, makeCtx());
      expect(result).toEqual({
        kind: 'path_missing',
        previousPath: '/old/path',
        taskBranch: 'my-branch',
      });
    });

    it('re-points task to existing workspace on key conflict during branch discovery', async () => {
      // Another workspace already owns the same path
      const existingWsId = crypto.randomUUID();
      const conflictPath = '/worktrees/taken';
      const conflictKey = computeWorkspaceKey('local', conflictPath);
      await fixture.db
        .insert(workspaces)
        .values({ id: existingWsId, type: 'local', path: conflictPath, key: conflictKey });

      await fixture.db.update(tasks).set({ taskBranch: 'my-branch' }).where(eq(tasks.id, TASK_ID));

      const ctx = makeCtx({
        worktreeService: {
          ...makeCtx().worktreeService,
          findBranchAnywhere: vi.fn().mockResolvedValue(conflictPath),
        },
      });

      const result = await svc.resolveBootstrap(TASK_ID, ctx);
      expect(result).toEqual({ kind: 'ready' });

      const [taskRow] = await fixture.db.select().from(tasks).where(eq(tasks.id, TASK_ID));
      expect(taskRow.workspaceId).toBe(existingWsId);
    });

    it('migrates a legacy local: prefixed workspaceId to a UUID workspace row', async () => {
      const legacyId = 'local:/some/old/path';
      await fixture.db.update(tasks).set({ workspaceId: legacyId }).where(eq(tasks.id, TASK_ID));

      const result = await svc.resolveBootstrap(TASK_ID, makeCtx());

      // Should have created a new workspace row and returned needs_create (no branch)
      expect(result.kind).toBe('needs_create');

      const [taskRow] = await fixture.db.select().from(tasks).where(eq(tasks.id, TASK_ID));
      expect(taskRow.workspaceId).not.toBe(legacyId);
      expect(taskRow.workspaceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    });

    it('returns ready immediately for byoi workspace type', async () => {
      await fixture.db.update(workspaces).set({ type: 'byoi' }).where(eq(workspaces.id, WS_ID));

      const result = await svc.resolveBootstrap(TASK_ID, makeCtx());
      expect(result).toEqual({ kind: 'ready' });
    });
  });

  // -------------------------------------------------------------------------
  // createWorktreeForTask
  // -------------------------------------------------------------------------

  describe('createWorktreeForTask', () => {
    it('uses repoPath directly when task has no taskBranch', async () => {
      const ctx = makeCtx({ repoPath: '/repo/root' });

      await svc.createWorktreeForTask(TASK_ID, ctx);

      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.path).toBe('/repo/root');
      expect(ctx.worktreeService.checkoutExistingBranch).not.toHaveBeenCalled();
    });

    it('checks out existing branch when task has a taskBranch (no sourceBranch)', async () => {
      await fixture.db.update(tasks).set({ taskBranch: 'my-branch' }).where(eq(tasks.id, TASK_ID));

      const ctx = makeCtx({
        worktreeService: {
          ...makeCtx().worktreeService,
          checkoutExistingBranch: vi
            .fn()
            .mockResolvedValue({ success: true, data: '/worktrees/my-branch' }),
        },
      });

      await svc.createWorktreeForTask(TASK_ID, ctx);

      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.path).toBe('/worktrees/my-branch');
      expect(ws.key).toBe(computeWorkspaceKey('local', '/worktrees/my-branch'));
    });

    it('uses checkoutBranchWorktree when sourceBranch differs from taskBranch', async () => {
      const sourceBranch = { type: 'local', branch: 'main' };
      await fixture.db
        .update(tasks)
        .set({ taskBranch: 'feature/x', sourceBranch: sourceBranch as never })
        .where(eq(tasks.id, TASK_ID));

      const ctx = makeCtx({
        worktreeService: {
          ...makeCtx().worktreeService,
          checkoutBranchWorktree: vi
            .fn()
            .mockResolvedValue({ success: true, data: '/worktrees/feature-x' }),
        },
      });

      await svc.createWorktreeForTask(TASK_ID, ctx);

      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.path).toBe('/worktrees/feature-x');
    });
  });

  // -------------------------------------------------------------------------
  // adoptPath
  // -------------------------------------------------------------------------

  describe('adoptPath', () => {
    it('persists the candidate path and key onto the workspace row', async () => {
      await svc.adoptPath(TASK_ID, '/worktrees/adopted', makeCtx());

      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.path).toBe('/worktrees/adopted');
      expect(ws.key).toBe(computeWorkspaceKey('local', '/worktrees/adopted'));
    });

    it('includes connectionId in key for SSH workspaces', async () => {
      await fixture.db
        .update(workspaces)
        .set({ type: 'project-ssh' })
        .where(eq(workspaces.id, WS_ID));

      const ctx = makeCtx({ connectionId: 'conn-123' });
      await svc.adoptPath(TASK_ID, '/remote/worktrees/branch', ctx);

      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.key).toBe(
        computeWorkspaceKey('project-ssh', '/remote/worktrees/branch', 'conn-123')
      );
    });
  });

  // -------------------------------------------------------------------------
  // persistPath
  // -------------------------------------------------------------------------

  describe('persistPath', () => {
    it('updates workspace path and key, returns original workspaceId', async () => {
      const returned = await svc.persistPath(WS_ID, '/worktrees/branch', 'local');

      expect(returned).toBe(WS_ID);
      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.path).toBe('/worktrees/branch');
      expect(ws.key).toBe(computeWorkspaceKey('local', '/worktrees/branch'));
    });

    it('does not set a key for byoi workspaces', async () => {
      await fixture.db.update(workspaces).set({ type: 'byoi' }).where(eq(workspaces.id, WS_ID));

      await svc.persistPath(WS_ID, '/some/path', 'byoi');

      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.key).toBeNull();
    });

    it('returns existing workspace id on UNIQUE key conflict', async () => {
      const existingWsId = crypto.randomUUID();
      const conflictPath = '/worktrees/taken';
      const conflictKey = computeWorkspaceKey('local', conflictPath);
      await fixture.db
        .insert(workspaces)
        .values({ id: existingWsId, type: 'local', path: conflictPath, key: conflictKey });

      const returned = await svc.persistPath(WS_ID, conflictPath, 'local');

      expect(returned).toBe(existingWsId);
      // Original workspace remains unchanged
      const [ws] = await fixture.db.select().from(workspaces).where(eq(workspaces.id, WS_ID));
      expect(ws.path).toBeNull();
    });
  });
});
