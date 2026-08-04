import { parseAbsolute } from '@emdash/core/primitives/path/api';
import type { WorkspaceHostRepoSnapshot } from '@emdash/core/runtimes/workspace-host/api';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tasks, workspaces } from '@core/services/app-db/node/schema';
import { applyRepoSnapshot } from './apply-repo-snapshot';

describe('applyRepoSnapshot', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
    fixture.sqlite
      .prepare(
        `INSERT INTO projects (id, name, path, repository_workspace_id, created_at, updated_at)
         VALUES ('project-1', 'Project', '/repo', 'repo-ws', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .run();
    await fixture.db.insert(workspaces).values({
      id: 'repo-ws',
      type: 'local',
      kind: 'repository',
      location: 'local',
      path: '/repo',
    });
  });

  afterEach(() => {
    fixture.close();
  });

  it('adopts observed worktrees and refreshes observed facts', async () => {
    await applyRepoSnapshot({
      db: fixture.db,
      projectId: 'project-1',
      repository: { id: 'repo-ws', path: '/repo', location: 'local', sshConnectionId: null },
      snapshot: snapshot(['/repo/worktrees/task-a']),
    });

    const [row] = await fixture.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.path, '/repo/worktrees/task-a'));

    expect(row).toMatchObject({
      kind: 'worktree',
      parentId: 'repo-ws',
      observedStatus: 'present',
      observedGitBranch: 'task-a',
    });
    expect(row?.observedData?.adminName).toBe('admin-task-a');
  });

  it('keeps annotated missing rows visible and silently untracks pure mirrors', async () => {
    await fixture.db.insert(workspaces).values([
      {
        id: 'annotated-ws',
        type: 'local',
        kind: 'worktree',
        location: 'local',
        parentId: 'repo-ws',
        path: '/repo/worktrees/annotated',
      },
      {
        id: 'mirror-ws',
        type: 'local',
        kind: 'worktree',
        location: 'local',
        parentId: 'repo-ws',
        path: '/repo/worktrees/mirror',
      },
    ]);
    await fixture.db.insert(tasks).values({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Annotated',
      status: 'ready',
      workspaceId: 'annotated-ws',
    });

    await applyRepoSnapshot({
      db: fixture.db,
      projectId: 'project-1',
      repository: { id: 'repo-ws', path: '/repo', location: 'local', sshConnectionId: null },
      snapshot: snapshot([]),
    });

    const rows = await fixture.db.select().from(workspaces);
    const annotated = rows.find((row) => row.id === 'annotated-ws');
    const mirror = rows.find((row) => row.id === 'mirror-ws');

    expect(annotated?.observedStatus).toBe('missing');
    expect(annotated?.untrackedAt).toBeNull();
    expect(mirror?.observedStatus).toBe('missing');
    expect(mirror?.untrackedAt).toBeTruthy();
  });
});

function snapshot(paths: string[]): WorkspaceHostRepoSnapshot {
  return {
    repoRoot: hostPath('/repo'),
    scannedAt: Date.parse('2026-01-01T00:00:00.000Z'),
    tier: 'full',
    repository: { path: hostPath('/repo'), status: 'present' },
    worktrees: paths.map((path) => ({
      path: hostPath(path),
      adminName: `admin-${path.split('/').at(-1)}`,
      isMain: false,
      head: { kind: 'branch', name: path.split('/').at(-1) ?? 'branch' },
      branch: path.split('/').at(-1) ?? 'branch',
      status: 'present',
      dirty: true,
      diffStats: { added: 2, deleted: 1 },
    })),
  };
}

function hostPath(value: string) {
  const parsed = parseAbsolute(value);
  if (!parsed.success) throw new Error(`Expected absolute path: ${value}`);
  return parsed.data;
}
