import { ManualClock } from '@emdash/shared/testing';
import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  projects,
  workspaces,
  type LifecycleOperationRow,
} from '@core/services/app-db/node/schema';
import { createDeleteWorkspaceOperationDefinition } from './workspace-lifecycle-definitions';

const mocks = vi.hoisted(() => ({
  unregisterFileSearchRoot: vi.fn(async () => {}),
}));

vi.mock('@main/core/file-search/runtime-client', () => ({
  unregisterFileSearchRoot: mocks.unregisterFileSearchRoot,
}));

vi.mock('@main/core/projects/project-manager', () => ({
  projectManager: {
    getProject: () => undefined,
  },
}));

vi.mock('@main/core/runtime/operations/session-cleanup', () => ({
  resolveLifecycleSessionTargets: async () => ({
    acpConversationIds: [],
    tuiConversationIds: [],
    terminalSessionIds: [],
    tmuxSessionNames: [],
  }),
  killLifecycleAcpSessions: vi.fn(),
  killLifecycleTerminalSessions: vi.fn(),
}));

describe('delete-workspace operation convergence', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
    vi.clearAllMocks();
  });

  it('purges an unused workspace row and safely converges when rerun', async () => {
    fixture = await openFixture('empty');
    await fixture.db.insert(projects).values({
      id: 'project-1',
      name: 'Project',
      path: '/repo',
      workspaceProvider: 'local',
    });
    await fixture.db.insert(workspaces).values({
      id: 'workspace-1',
      type: 'byoi',
      kind: 'byoi',
      location: 'local',
      path: '/repo/workspace',
      deletedAt: '2026-07-20T00:00:00.000Z',
    });
    const definition = createDeleteWorkspaceOperationDefinition();
    const context = {
      operation: operation(),
      db: fixture.db,
      signal: new AbortController().signal,
      clock: new ManualClock(),
      reportProgress: vi.fn(),
    };

    await expect(definition.run(context)).resolves.toEqual({
      success: true,
      data: undefined,
    });
    expect(await fixture.db.select().from(workspaces)).toHaveLength(0);

    await expect(definition.run(context)).resolves.toEqual({
      success: true,
      data: undefined,
    });
    expect(await fixture.db.select().from(workspaces)).toHaveLength(0);
  });
});

function operation(): LifecycleOperationRow {
  return {
    id: 'operation-1',
    kind: 'delete-workspace',
    status: 'running',
    projectId: 'project-1',
    taskId: null,
    workspaceId: 'workspace-1',
    entityKey: 'workspace-1',
    hostRef: 'local',
    payload: {
      version: '1',
      source: 'user',
      workspacePath: '/repo/workspace',
      deleteWorktree: false,
    },
    attempt: 0,
    error: null,
    createdAt: 0,
    finishedAt: null,
  };
}
