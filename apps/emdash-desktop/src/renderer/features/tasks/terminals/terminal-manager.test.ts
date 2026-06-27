import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getProjectSshConnectionId } from '@renderer/features/projects/stores/project-selectors';
import type { PtySession } from '@renderer/lib/pty/pty-session';
import { TerminalManagerStore } from './terminal-manager';

const createTerminal = vi.hoisted(() => vi.fn());
const getTerminalsForTask = vi.hoisted(() => vi.fn());
const hydrateTerminal = vi.hoisted(() => vi.fn());
const renameTerminal = vi.hoisted(() => vi.fn());
const deleteTerminal = vi.hoisted(() => vi.fn());
const frontendConnect = vi.hoisted(() => vi.fn());
const frontendDispose = vi.hoisted(() => vi.fn());
const frontendOptions = vi.hoisted(() => [] as Array<{ windowsPtyBackend?: string }>);
const getAppSettingValueSnapshot = vi.hoisted(() => vi.fn());

function stubNavigatorPlatform(platform: string): void {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { platform },
  });
}

vi.mock('@renderer/features/settings/app-settings-client', () => ({
  getAppSettingValueSnapshot,
}));

vi.mock('@renderer/features/projects/stores/project-selectors', () => ({
  getProjectSshConnectionId: vi.fn(() => undefined),
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
    constructor(
      readonly sessionId: string,
      _theme?: unknown,
      _onOpenFile?: unknown,
      _onOpenExternal?: unknown,
      options?: { windowsPtyBackend?: string }
    ) {
      frontendOptions.push(options ?? {});
    }

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
    frontendOptions.length = 0;
    getAppSettingValueSnapshot.mockReset();
    vi.mocked(getProjectSshConnectionId).mockReturnValue(undefined);
    stubNavigatorPlatform('MacIntel');

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

  it('uses an SSH connection learned after session creation before connecting', async () => {
    stubNavigatorPlatform('Win32');
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
    const session = store.sessions.get('terminal-1');

    store.setSshConnectionId('ssh-1');
    await session?.connect();

    expect(frontendOptions[0]?.windowsPtyBackend).toBeUndefined();
    store.dispose();
  });

  it('refreshes existing terminal sessions when the SSH connection is learned', () => {
    const store = new TerminalManagerStore('project-1', 'task-1');
    const refreshWindowsPtyBackend = vi.fn();
    store.sessions.set('terminal-1', {
      destroy: vi.fn(),
      refreshWindowsPtyBackend,
    } as unknown as PtySession);

    store.setSshConnectionId('ssh-1');

    expect(refreshWindowsPtyBackend).toHaveBeenCalledTimes(1);
    store.dispose();
  });
});
