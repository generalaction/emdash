import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalManagerStore } from './terminal-manager';

const createTerminal = vi.hoisted(() => vi.fn());
const listTerminals = vi.hoisted(() => vi.fn());
const hydrateTerminal = vi.hoisted(() => vi.fn());
const renameTerminal = vi.hoisted(() => vi.fn());
const deleteTerminal = vi.hoisted(() => vi.fn());
const frontendConnect = vi.hoisted(() => vi.fn());
const frontendDispose = vi.hoisted(() => vi.fn());
const getAppSettingValueSnapshot = vi.hoisted(() => vi.fn());

vi.mock('@core/features/editor/browser/open-file-in-file-editor', () => ({
  makeFileLinkHandlers: () => ({}),
}));

vi.mock('@core/features/settings/browser/app-settings-client', () => ({
  getAppSettingValueSnapshot,
}));

vi.mock('@renderer/lib/runtime/desktop-host-client', () => ({
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
  },
}));

vi.mock('@core/features/terminals/browser/client', () => ({
  getTerminalsClient: async () => ({
    create: createTerminal,
    delete: deleteTerminal,
    list: listTerminals,
    hydrate: hydrateTerminal,
    rename: renameTerminal,
  }),
}));

vi.mock('@core/features/terminals/browser/pty/pty', () => ({
  FrontendPty: class {
    constructor(readonly sessionId: string) {}

    connect = frontendConnect;
    dispose = frontendDispose;
  },
}));

vi.mock('@core/features/conversations/browser/acp/acp-chat-store', () => ({
  AcpChatStore: class {
    conversationId = '';
    dispose() {}
    bootstrap() {}
  },
}));

vi.mock('@core/features/conversations/browser/acp/acp-chat-panel', () => ({
  AcpChatPanel: () => null,
}));

describe('TerminalManagerStore session hydration', () => {
  beforeEach(() => {
    createTerminal.mockReset();
    listTerminals.mockReset();
    hydrateTerminal.mockReset();
    renameTerminal.mockReset();
    deleteTerminal.mockReset();
    frontendConnect.mockReset();
    frontendDispose.mockReset();
    getAppSettingValueSnapshot.mockReset();

    createTerminal.mockImplementation(async (input) => ({
      success: true,
      data: {
        terminal: { ...input, shellId: input.shell ?? 'system' },
        key: { workspaceId: 'workspace-1', terminalId: input.id },
      },
    }));
    listTerminals.mockResolvedValue({ success: true, data: [] });
    hydrateTerminal.mockResolvedValue({
      success: true,
      data: {
        key: { workspaceId: 'workspace-1', terminalId: 'terminal-1' },
      },
    });
    renameTerminal.mockResolvedValue({ success: true, data: undefined });
    deleteTerminal.mockResolvedValue({ success: true, data: undefined });
    frontendConnect.mockResolvedValue(undefined);
    getAppSettingValueSnapshot.mockReturnValue(undefined);
  });

  it('creates terminal sessions from records without hydrating until the session connects', async () => {
    listTerminals.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'terminal-1',
          projectId: 'project-1',
          taskId: 'task-1',
          shellId: 'system',
          name: 'Terminal 1',
        },
      ],
    });
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
      success: true,
      data: {
        terminal: {
          id: 'terminal-1',
          projectId: 'project-1',
          taskId: 'task-1',
          shellId: 'fish',
          name: 'Terminal 1',
        },
        key: { workspaceId: 'workspace-1', terminalId: 'terminal-1' },
      },
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
