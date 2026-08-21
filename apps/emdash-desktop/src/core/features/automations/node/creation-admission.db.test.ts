import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import { tombstoneWorkspaceRow } from '@core/features/workspaces/api/node/registry/workspace-tombstones';
import type { WorkspaceRow } from '@core/services/app-db/node/schema';
import { checkLocalWorktreeCreationAdmission } from './creation-admission';

/**
 * Creation admission for automation runs (ADR 0006): the local mirror data check the
 * automations worker consumes as its `creationAdmission` dependency. A pending
 * deletion tombstone on the requested path or branch refuses; anything else admits.
 */
describe('automation run creation admission', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
  });

  afterEach(() => {
    fixture.close();
  });

  function seedWorktree(id: string, path: string, branch: string): WorkspaceRow {
    return createWorkspaceRegistry(fixture.db).recordCreationIntent({
      id,
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path,
      config: {
        version: '2',
        git: {
          kind: 'create-branch',
          branchName: branch,
          fromBranch: { type: 'local', branch: 'main' },
        },
        workspace: { kind: 'new-worktree' },
      },
    });
  }

  it('admits when nothing at the path or branch is pending deletion', () => {
    seedWorktree('ws-live', '/repo/.worktrees/live', 'feature/live');

    const result = checkLocalWorktreeCreationAdmission(fixture.db, {
      path: '/repo/.worktrees/fresh',
      branch: 'feature/fresh',
    });

    expect(result).toEqual({ success: true, data: undefined });
  });

  it('refuses a path carrying a pending tombstone with the typed conflict', () => {
    const workspace = seedWorktree('ws-held', '/repo/.worktrees/held', 'feature/held');
    tombstoneWorkspaceRow(fixture.db, {
      workspace,
      options: { deleteBranch: true, deleteConversations: false },
      createdAt: 1,
    });

    const result = checkLocalWorktreeCreationAdmission(fixture.db, {
      path: '/repo/.worktrees/held',
      branch: 'feature/other',
    });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        type: 'workspace-tombstone-pending',
        workspaceId: 'ws-held',
      }),
    });
  });

  it('refuses a branch carrying a pending tombstone even at a fresh path', () => {
    const workspace = seedWorktree('ws-held', '/repo/.worktrees/held', 'feature/held');
    tombstoneWorkspaceRow(fixture.db, {
      workspace,
      options: { deleteBranch: false, deleteConversations: false },
      createdAt: 1,
    });

    const result = checkLocalWorktreeCreationAdmission(fixture.db, {
      path: '/repo/.worktrees/fresh',
      branch: 'feature/held',
    });

    expect(result).toEqual({
      success: false,
      error: expect.objectContaining({
        type: 'workspace-tombstone-pending',
        workspaceId: 'ws-held',
      }),
    });
  });

  it('admits again once the pending row is untracked (Untrack-anyway)', () => {
    const workspace = seedWorktree('ws-held', '/repo/.worktrees/held', 'feature/held');
    tombstoneWorkspaceRow(fixture.db, {
      workspace,
      options: { deleteBranch: false, deleteConversations: false },
      createdAt: 1,
    });
    createWorkspaceRegistry(fixture.db).untrack(['ws-held'], '2026-01-01T00:00:00.000Z');

    const result = checkLocalWorktreeCreationAdmission(fixture.db, {
      path: '/repo/.worktrees/held',
      branch: 'feature/held',
    });

    expect(result).toEqual({ success: true, data: undefined });
  });
});
