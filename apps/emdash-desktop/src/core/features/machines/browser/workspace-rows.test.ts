import { describe, expect, it } from 'vitest';
import type { ProjectWorkspaceRow } from '@core/primitives/workspaces/api';
import { joinWorkspaceRows } from './workspace-rows';

describe('joinWorkspaceRows', () => {
  it('joins usage and mirror git stats into one row', () => {
    const joined = joinWorkspaceRows({
      rows: [workspaceRow()],
      usageResults: [
        {
          path: '/repo/task',
          success: true,
          usage: { totalBytes: 100, artifactBytes: 40, errors: [] },
        },
      ],
    });

    expect(joined).toHaveLength(1);
    expect(joined[0]).toMatchObject({
      key: 'workspace-1',
      status: 'idle',
      usage: { totalBytes: 100 },
      gitStats: { added: 2 },
      pendingRemoval: false,
      removalNeedsAttention: false,
    });
  });

  it('falls back to path identity and active-session status', () => {
    const row = { ...workspaceRow(), workspaceId: null, hasActiveSessions: true };
    const [joined] = joinWorkspaceRows({ rows: [row] });

    expect(joined).toMatchObject({ key: row.path, status: 'active' });
  });

  it('renders a tombstoned row as its own pending-deletion state', () => {
    const row = { ...workspaceRow(), pendingRemoval: true };
    const [joined] = joinWorkspaceRows({ rows: [row] });

    expect(joined).toMatchObject({
      status: 'tearing-down',
      pendingRemoval: true,
      removalNeedsAttention: false,
    });
  });

  it('keeps a transient removal failure pending, not needs-attention', () => {
    const row = {
      ...workspaceRow(),
      pendingRemoval: true,
      lastRemovalAttempt: removalAttempt('transient'),
    };
    const [joined] = joinWorkspaceRows({ rows: [row] });

    expect(joined).toMatchObject({
      status: 'tearing-down',
      pendingRemoval: true,
      removalNeedsAttention: false,
    });
  });

  it('derives needs-attention from tombstone presence plus a terminal attempt', () => {
    const row = {
      ...workspaceRow(),
      pendingRemoval: true,
      lastRemovalAttempt: removalAttempt('terminal'),
    };
    const [joined] = joinWorkspaceRows({ rows: [row] });

    expect(joined).toMatchObject({
      status: 'error',
      pendingRemoval: true,
      removalNeedsAttention: true,
      statusMessage: 'worktree is locked',
    });
  });

  it('ignores a stale removal attempt without a tombstone', () => {
    const row = { ...workspaceRow(), lastRemovalAttempt: removalAttempt('terminal') };
    const [joined] = joinWorkspaceRows({ rows: [row] });

    expect(joined).toMatchObject({
      status: 'idle',
      pendingRemoval: false,
      removalNeedsAttention: false,
    });
  });

  it('reports a failed create outcome as an error with its message', () => {
    const row = {
      ...workspaceRow(),
      lastCreateOutcome: {
        version: '1' as const,
        status: 'failed' as const,
        at: 1,
        stage: 'add-worktree',
        message: 'branch already exists',
      },
    };
    const [joined] = joinWorkspaceRows({ rows: [row] });

    expect(joined).toMatchObject({ status: 'error', statusMessage: 'branch already exists' });
  });

  it('shows an in-flight create from the runtime overlay as setting-up', () => {
    const row = {
      ...workspaceRow(),
      runtimeOverlay: {
        version: '1' as const,
        creation: { stage: 'fetch', startedAt: 1 },
        notices: [],
        activation: null,
      },
    };
    const [joined] = joinWorkspaceRows({ rows: [row] });

    expect(joined).toMatchObject({ status: 'setting-up' });
  });
});

function workspaceRow(): ProjectWorkspaceRow {
  return {
    kind: 'workspace',
    projectId: 'project-1',
    workspaceId: 'workspace-1',
    path: '/repo/task',
    branch: 'task',
    tasks: [],
    usage: null,
    gitStats: { added: 2, removed: 1, ahead: 1, behind: 0 },
    pathState: 'measured',
    canCleanArtifacts: true,
    canDelete: true,
    hasActiveSessions: false,
    pendingRemoval: false,
    errors: [],
  };
}

function removalAttempt(failureClass: 'transient' | 'terminal') {
  return {
    version: '1' as const,
    stage: 'remove',
    class: failureClass,
    message: 'worktree is locked',
    at: 1,
  };
}
