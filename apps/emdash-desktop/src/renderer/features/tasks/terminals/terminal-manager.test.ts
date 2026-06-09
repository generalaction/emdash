import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalManagerStore } from './terminal-manager';

const createTerminal = vi.hoisted(() => vi.fn());
const getTerminalsForTask = vi.hoisted(() => vi.fn());
const hydrateTerminal = vi.hoisted(() => vi.fn());
const renameTerminal = vi.hoisted(() => vi.fn());
const deleteTerminal = vi.hoisted(() => vi.fn());
const frontendConnect = vi.hoisted(() => vi.fn());
const frontendDispose = vi.hoisted(() => vi.fn());
const getAppSettingValueSnapshot = vi.hoisted(() => vi.fn());

vi.mock('@renderer/features/settings/app-settings-client', () => ({
  getAppSettingValueSnapshot,
}));

vi.mock('@renderer/lib/ipc', () => ({
  events: { on: () => () => {} },
  rpc: {
    app: {
      openPath: vi.fn(),
    },
    fs: {
      fileExists: vi.fn(),
    },
    ssh: {
      getConnections: async () => [],
      getConnectionState: async () => ({}),
      getHealthStates: async () => ({}),
    },
    terminals: {
      createTerminal,
      deleteTerminal,
      getTerminalsForTask,
      hydrateTerminal,
      renameTerminal,
    },
  },
}));

vi.mock('@renderer/lib/pty/pty', () => ({
  FrontendPty: class {
    constructor(readonly sessionId: string) {}

    connect = frontendConnect;
    dispose = frontendDispose;
  },
}));

describe('TerminalManagerStore session hydration', () => {
  beforeEach(() => {
    createTerminal.mockReset();
    getTerminalsForTask.mockReset();
    hydrateTerminal.mockReset();
    renameTerminal.mockReset();
    deleteTerminal.mockReset();
    frontendConnect.mockReset();
    frontendDispose.mockReset();
    getAppSettingValueSnapshot.mockReset();

    createTerminal.mockImplementation(async (terminal) => terminal);
    getTerminalsForTask.mockResolvedValue([]);
    hydrateTerminal.mockResolvedValue(undefined);
    renameTerminal.mockResolvedValue(undefined);
    deleteTerminal.mockResolvedValue(undefined);
    frontendConnect.mockResolvedValue(undefined);
    getAppSettingValueSnapshot.mockReturnValue(undefined);
  });

  it('creates terminal sessions from records without hydrating until the session connects', async () => {
    getTerminalsForTask.mockResolvedValue([
      {
        id: 'terminal-1',
        projectId: 'project-1',
        taskId: 'task-1',
        shellId: 'system',
        name: 'Terminal 1',
      },
    ]);
    const store = new TerminalManagerStore('project-1', 'task-1');

    store.list.setValue([
      {
        id: 'terminal-1',
        projectId: 'project-1',
        taskId: 'task-1',
        shellId: 'system',
        name: 'Terminal 1',
      },
    ]);

    expect(hydrateTerminal).not.toHaveBeenCalled();

    const session = store.sessions.get('terminal-1');
    expect(session).toBeDefined();

    await session?.connect();

    expect(hydrateTerminal).toHaveBeenCalledTimes(1);
    expect(hydrateTerminal).toHaveBeenCalledWith({
      projectId: 'project-1',
      taskId: 'task-1',
      terminalId: 'terminal-1',
    });
    expect(frontendConnect).toHaveBeenCalledTimes(1);

    await session?.connect();

    expect(hydrateTerminal).toHaveBeenCalledTimes(1);
    expect(frontendConnect).toHaveBeenCalledTimes(1);

    store.dispose();
  });

  it('uses the cached default shell for optimistic terminals when no shell is specified', async () => {
    getAppSettingValueSnapshot.mockReturnValue({ defaultShell: 'fish' });
    createTerminal.mockResolvedValue({
      id: 'terminal-1',
      projectId: 'project-1',
      taskId: 'task-1',
      shellId: 'fish',
      name: 'Terminal 1',
    });
    const store = new TerminalManagerStore('project-1', 'task-1');

    const promise = store.createTerminal({
      id: 'terminal-1',
      projectId: 'project-1',
      taskId: 'task-1',
      name: 'Terminal 1',
    });

    expect(store.terminals.get('terminal-1')?.data.shellId).toBe('fish');
    await promise;
    store.dispose();
  });
});
