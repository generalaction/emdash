import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDb } from '@main/db/client';
import { projectRemotes, projects, pullRequests, tasks, workspaces } from '@main/db/schema';
import { listPrAutoCleanupCandidates } from './pr-auto-cleanup-candidates';

const mocks = vi.hoisted(() => ({
  db: undefined as AppDb | undefined,
}));

vi.mock('@main/db/client', () => ({
  get db() {
    if (!mocks.db) throw new Error('Test database not initialized');
    return mocks.db;
  },
}));

const PROJECT_ID = 'project-1';
const REPOSITORY_URL = 'https://github.com/acme/repo';
const UPSTREAM_REPOSITORY_URL = 'https://github.com/emdash/repo';

function prRow(overrides: Partial<typeof pullRequests.$inferInsert>) {
  return {
    url: 'https://github.com/acme/repo/pull/1',
    repositoryUrl: REPOSITORY_URL,
    baseRefName: 'main',
    baseRefOid: 'base-oid',
    headRepositoryUrl: REPOSITORY_URL,
    headRefName: 'feature/cleanup',
    headRefOid: 'head-oid',
    identifier: '#1',
    title: 'Cleanup PR',
    status: 'merged',
    isDraft: 0,
    pullRequestCreatedAt: '2026-01-01T00:00:00.000Z',
    pullRequestUpdatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('listPrAutoCleanupCandidates', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    mocks.db = fixture.db;

    await fixture.db.insert(projects).values({
      id: PROJECT_ID,
      name: 'Project',
      path: '/repo',
    });
    await fixture.db.insert(projectRemotes).values({
      projectId: PROJECT_ID,
      remoteName: 'origin',
      remoteUrl: REPOSITORY_URL,
    });
    await fixture.db.insert(workspaces).values({
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/.worktrees/cleanup',
      branchName: 'feature/cleanup',
    });
    await fixture.db.insert(tasks).values({
      id: 'task-1',
      projectId: PROJECT_ID,
      name: 'Cleanup task',
      status: 'review',
      workspaceId: 'workspace-1',
    });
  });

  afterEach(() => {
    fixture.close();
    mocks.db = undefined;
  });

  it('returns an active task whose current PR is merged', async () => {
    await fixture.db.insert(pullRequests).values(prRow({}));

    await expect(listPrAutoCleanupCandidates(REPOSITORY_URL)).resolves.toEqual([
      {
        taskId: 'task-1',
        projectId: PROJECT_ID,
        taskName: 'Cleanup task',
        prUrl: 'https://github.com/acme/repo/pull/1',
      },
    ]);
  });

  it('associates a fork PR with its head project without crossing same-branch projects', async () => {
    await fixture.db.insert(projectRemotes).values({
      projectId: PROJECT_ID,
      remoteName: 'upstream',
      remoteUrl: UPSTREAM_REPOSITORY_URL,
    });
    await fixture.db.insert(projects).values({
      id: 'project-2',
      name: 'Upstream project',
      path: '/upstream-repo',
    });
    await fixture.db.insert(projectRemotes).values({
      projectId: 'project-2',
      remoteName: 'origin',
      remoteUrl: UPSTREAM_REPOSITORY_URL,
    });
    await fixture.db.insert(workspaces).values({
      id: 'workspace-2',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/upstream-repo/.worktrees/cleanup',
      branchName: 'feature/cleanup',
    });
    await fixture.db.insert(tasks).values({
      id: 'task-2',
      projectId: 'project-2',
      name: 'Unrelated upstream task',
      status: 'review',
      workspaceId: 'workspace-2',
    });
    await fixture.db.insert(pullRequests).values(
      prRow({
        repositoryUrl: UPSTREAM_REPOSITORY_URL,
        headRepositoryUrl: REPOSITORY_URL,
      })
    );

    await expect(listPrAutoCleanupCandidates(REPOSITORY_URL)).resolves.toEqual([
      {
        taskId: 'task-1',
        projectId: PROJECT_ID,
        taskName: 'Cleanup task',
        prUrl: 'https://github.com/acme/repo/pull/1',
      },
    ]);
    await expect(listPrAutoCleanupCandidates(UPSTREAM_REPOSITORY_URL)).resolves.toEqual([
      {
        taskId: 'task-1',
        projectId: PROJECT_ID,
        taskName: 'Cleanup task',
        prUrl: 'https://github.com/acme/repo/pull/1',
      },
    ]);
  });

  it('does not use an older merged PR while the task has an open PR', async () => {
    await fixture.db.insert(pullRequests).values([
      prRow({}),
      prRow({
        url: 'https://github.com/acme/repo/pull/2',
        identifier: '#2',
        title: 'Follow-up PR',
        status: 'open',
        pullRequestCreatedAt: '2026-02-01T00:00:00.000Z',
        pullRequestUpdatedAt: '2026-02-02T00:00:00.000Z',
      }),
    ]);

    await expect(listPrAutoCleanupCandidates(REPOSITORY_URL)).resolves.toEqual([]);
  });

  it('ignores archived tasks', async () => {
    await fixture.db.insert(pullRequests).values(prRow({}));
    await fixture.db
      .update(tasks)
      .set({ archivedAt: '2026-03-01T00:00:00.000Z' })
      .where(eq(tasks.id, 'task-1'));

    await expect(listPrAutoCleanupCandidates(REPOSITORY_URL)).resolves.toEqual([]);
  });
});
