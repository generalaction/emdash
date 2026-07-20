import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as drizzleClientModule from '@main/db/drizzleClient';
import * as databaseInitializeModule from '@main/db/initialize';
import { getAppDb, resetAppDbForTests, setAppDb } from '@main/db/instance';
import { databasePhase } from './database';

const mocks = vi.hoisted(() => {
  const db = {
    run: vi.fn(),
    select: vi.fn(() => ({
      from: vi.fn(async () => []),
    })),
  };
  const sqlite = {};
  const client = {
    close: vi.fn(),
    db,
    sqlite,
  };
  return {
    cleanupLegacyBrowserPartitions: vi.fn(),
    client,
    createDrizzleClient: vi.fn(() => client),
    deleteOrphans: vi.fn(async () => ({ success: true, data: { deleted: 0 } })),
    editorBufferPrune: vi.fn(),
    initializeDatabase: vi.fn(async () => sqlite),
    resetStaleAcpAgentStatuses: vi.fn(),
    resetStaleTuiAgentStatuses: vi.fn(),
    runInBackground: vi.fn(),
    searchInitialize: vi.fn(),
    setWorkspaceIdentityService: vi.fn(),
    writeBootingMarker: vi.fn(),
  };
});

vi.mock('@core/features/editor/node/editor-buffer-service', () => ({
  createEditorBufferService: () => ({ pruneStale: mocks.editorBufferPrune }),
}));
vi.mock('@core/features/search/node/search-service', () => ({
  createSearchService: () => ({ initialize: mocks.searchInitialize }),
}));
vi.mock('@core/features/workspaces/node/workspace-identity-source', () => ({
  createWorkspaceIdentityService: () => ({}),
}));
vi.mock('@core/services/workspace-runtime-access/node', () => ({
  acquireWorkspaceRuntime: vi.fn(),
}));
vi.mock('@core/services/app-db/node/schema', () => ({
  projects: { id: 'projects.id' },
  tasks: { id: 'tasks.id' },
}));
vi.mock('@main/core/conversations/reset-stale-acp-agent-statuses', () => ({
  resetStaleAcpAgentStatuses: mocks.resetStaleAcpAgentStatuses,
}));
vi.mock('@main/core/conversations/reset-stale-tui-agent-statuses', () => ({
  resetStaleTuiAgentStatuses: mocks.resetStaleTuiAgentStatuses,
}));
vi.mock('@main/gateway/desktop-workers', () => ({
  getMementosRuntimeClient: async () => ({ deleteOrphans: mocks.deleteOrphans }),
}));
vi.mock('@main/host/browser/browser-partition-cleanup', () => ({
  cleanupLegacyBrowserPartitions: mocks.cleanupLegacyBrowserPartitions,
}));
vi.mock('@main/lib/logger', () => ({
  log: { warn: vi.fn() },
}));
vi.mock('../../core/background', () => ({
  runInBackground: mocks.runInBackground,
}));
vi.mock('../../core/boot-guard', () => ({
  writeBootingMarker: mocks.writeBootingMarker,
}));
vi.mock('../../core/service-instances', () => ({
  setWorkspaceIdentityService: mocks.setWorkspaceIdentityService,
}));

describe('database boot phase', () => {
  beforeEach(() => {
    resetAppDbForTests();
    vi.clearAllMocks();
    mocks.initializeDatabase.mockResolvedValue(mocks.client.sqlite);
    vi.spyOn(drizzleClientModule, 'createDrizzleClient').mockImplementation(
      mocks.createDrizzleClient as never
    );
    vi.spyOn(databaseInitializeModule, 'initializeDatabase').mockImplementation(
      mocks.initializeDatabase as never
    );
    mocks.resetStaleAcpAgentStatuses.mockImplementation(() => {
      expect(getAppDb()).toBe(mocks.client.db);
    });
  });

  afterEach(() => {
    resetAppDbForTests();
  });

  it('initializes and publishes one client before startup repairs', async () => {
    await databasePhase.run({ config: { forceBootFailure: false } } as never);

    expect(mocks.createDrizzleClient).toHaveBeenCalledOnce();
    expect(mocks.initializeDatabase).toHaveBeenCalledWith(mocks.client.sqlite);
    expect(getAppDb()).toBe(mocks.client.db);
    expect(mocks.client.close).not.toHaveBeenCalled();
    expect(mocks.resetStaleAcpAgentStatuses).toHaveBeenCalledOnce();
  });

  it('closes an unpublished client when initialization fails', async () => {
    mocks.initializeDatabase.mockRejectedValue(new Error('migration failed'));

    await expect(
      databasePhase.run({ config: { forceBootFailure: false } } as never)
    ).rejects.toThrow('migration failed');

    expect(() => getAppDb()).toThrow('App database has not been initialized');
    expect(mocks.client.close).toHaveBeenCalledOnce();
  });

  it('closes the new client when publishing fails', async () => {
    setAppDb({ db: {} as never, sqlite: {} as never, close: vi.fn() });

    await expect(
      databasePhase.run({ config: { forceBootFailure: false } } as never)
    ).rejects.toThrow('already initialized');

    expect(mocks.client.close).toHaveBeenCalledOnce();
    expect(mocks.resetStaleAcpAgentStatuses).not.toHaveBeenCalled();
  });

  it('does not create a client for a forced pre-database boot failure', async () => {
    await expect(
      databasePhase.run({ config: { forceBootFailure: true } } as never)
    ).rejects.toThrow('Boot failure forced');

    expect(mocks.createDrizzleClient).not.toHaveBeenCalled();
  });
});
