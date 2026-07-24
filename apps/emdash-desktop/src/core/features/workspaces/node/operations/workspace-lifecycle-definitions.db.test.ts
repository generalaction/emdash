import { hostRef } from '@emdash/core/primitives/host/api';
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
const dependencies = {
  cleanup: {
    getWorkspaceRuntimeClient: vi.fn(),
    projects: { getProject: () => undefined },
    unregisterFileSearchRoot: mocks.unregisterFileSearchRoot,
  },
  lifecycleContext: {
    projects: { getProject: () => undefined },
    workspaceBootstrap: {} as never,
  },
  sessions: {
    resolve: async () => ({
      acpConversationIds: [],
      tuiConversationIds: [],
      terminalSessionIds: [],
      tmuxSessionNames: [],
    }),
    killAcp: vi.fn(),
    killTerminals: vi.fn(),
  },
} as never;

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
    const definition = createDeleteWorkspaceOperationDefinition(dependencies);
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

  it('unregisters a remote workspace root from its runtime host', async () => {
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
      location: 'remote',
      path: '/repo/workspace',
      deletedAt: '2026-07-20T00:00:00.000Z',
    });
    const definition = createDeleteWorkspaceOperationDefinition(dependencies);

    await expect(
      definition.run({
        operation: operation('ssh-1'),
        db: fixture.db,
        signal: new AbortController().signal,
        clock: new ManualClock(),
        reportProgress: vi.fn(),
      })
    ).resolves.toEqual({
      success: true,
      data: undefined,
    });

    expect(mocks.unregisterFileSearchRoot).toHaveBeenCalledWith(
      expect.anything(),
      hostRef('remote', 'ssh-1')
    );
  });
});

function operation(hostRef = 'local'): LifecycleOperationRow {
  return {
    id: 'operation-1',
    kind: 'delete-workspace',
    status: 'running',
    projectId: 'project-1',
    taskId: null,
    workspaceId: 'workspace-1',
    entityKey: 'workspace-1',
    hostRef,
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
