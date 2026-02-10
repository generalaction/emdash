import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePtyId } from '../../shared/ptyId';

type ExitPayload = {
  exitCode: number | null | undefined;
  signal: number | undefined;
};

type MockProc = {
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (payload: ExitPayload) => void) => void;
  emitExit: (exitCode: number | null | undefined, signal?: number) => void;
};

const ipcHandleHandlers = new Map<string, (...args: any[]) => any>();
const ipcOnHandlers = new Map<string, (...args: any[]) => any>();
const appListeners = new Map<string, Array<() => void>>();
const ptys = new Map<string, MockProc>();
const notificationCtor = vi.fn();
const notificationShow = vi.fn();
const telemetryCaptureMock = vi.fn();

function createMockProc(): MockProc {
  let exitHandler: ((payload: ExitPayload) => void) | null = null;
  return {
    onData: vi.fn(),
    onExit: (cb) => {
      exitHandler = cb;
    },
    emitExit: (exitCode, signal) => {
      if (!exitHandler) return;
      exitHandler({ exitCode, signal });
    },
  };
}

const startPtyMock = vi.fn(async ({ id }: { id: string }) => {
  const proc = createMockProc();
  ptys.set(id, proc);
  return proc;
});
const getPtyMock = vi.fn((id: string) => ptys.get(id));
const killPtyMock = vi.fn((id: string) => {
  ptys.delete(id);
});
const getAllWindowsMock = vi.fn(() => [
  {
    isFocused: () => false,
    webContents: { isDestroyed: () => false, send: vi.fn() },
  },
]);

vi.mock('electron', () => {
  class MockNotification {
    static isSupported = vi.fn(() => true);

    constructor(options: unknown) {
      notificationCtor(options);
    }

    show() {
      notificationShow();
    }
  }

  return {
    app: {
      on: vi.fn((event: string, cb: () => void) => {
        const list = appListeners.get(event) || [];
        list.push(cb);
        appListeners.set(event, list);
      }),
    },
    ipcMain: {
      handle: vi.fn((channel: string, cb: (...args: any[]) => any) => {
        ipcHandleHandlers.set(channel, cb);
      }),
      on: vi.fn((channel: string, cb: (...args: any[]) => any) => {
        ipcOnHandlers.set(channel, cb);
      }),
    },
    BrowserWindow: {
      getAllWindows: getAllWindowsMock,
    },
    Notification: MockNotification,
  };
});

vi.mock('../../main/services/ptyManager', () => ({
  startPty: startPtyMock,
  writePty: vi.fn(),
  resizePty: vi.fn(),
  killPty: killPtyMock,
  getPty: getPtyMock,
  startDirectPty: vi.fn(),
  setOnDirectCliExit: vi.fn(),
}));

vi.mock('../../main/lib/logger', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../main/settings', () => ({
  getAppSettings: vi.fn(() => ({
    notifications: { enabled: true, sound: true },
  })),
}));

vi.mock('../../main/telemetry', () => ({
  capture: telemetryCaptureMock,
}));

vi.mock('../../shared/providers/registry', () => ({
  PROVIDER_IDS: ['codex', 'claude'],
  getProvider: vi.fn((id: string) => ({ name: id === 'codex' ? 'Codex' : 'Claude Code' })),
}));

vi.mock('../../main/errorTracking', () => ({
  errorTracking: {
    captureAgentSpawnError: vi.fn(),
  },
}));

vi.mock('../../main/services/TerminalSnapshotService', () => ({
  terminalSnapshotService: {
    getSnapshot: vi.fn(),
    saveSnapshot: vi.fn(),
    deleteSnapshot: vi.fn(),
  },
}));

vi.mock('../../main/services/TerminalConfigParser', () => ({
  detectAndLoadTerminalConfig: vi.fn(),
}));

vi.mock('../../main/services/DatabaseService', () => ({
  databaseService: {},
}));

describe('ptyIpc notification lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    ipcHandleHandlers.clear();
    ipcOnHandlers.clear();
    appListeners.clear();
    ptys.clear();
  });

  function createSender() {
    return {
      id: 1,
      send: vi.fn(),
      isDestroyed: vi.fn(() => false),
      once: vi.fn(),
    };
  }

  it('does not show completion notification after app quit cleanup even if exit 0 arrives', async () => {
    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const start = ipcHandleHandlers.get('pty:start');
    expect(start).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-quit');
    await start!(
      { sender: createSender() },
      { id, cwd: '/tmp/task', shell: 'codex', cols: 120, rows: 32 }
    );

    const proc = ptys.get(id);
    expect(proc).toBeDefined();

    const beforeQuit = appListeners.get('before-quit')?.[0];
    expect(beforeQuit).toBeTypeOf('function');
    beforeQuit!();

    // Simulate late onExit callback firing after cleanup kill.
    proc!.emitExit(0, undefined);

    expect(notificationCtor).not.toHaveBeenCalled();
    expect(notificationShow).not.toHaveBeenCalled();
  });

  it('shows completion notification on normal successful process exit', async () => {
    const { registerPtyIpc } = await import('../../main/services/ptyIpc');
    registerPtyIpc();

    const start = ipcHandleHandlers.get('pty:start');
    expect(start).toBeTypeOf('function');

    const id = makePtyId('codex', 'main', 'task-success');
    await start!(
      { sender: createSender() },
      { id, cwd: '/tmp/task', shell: 'codex', cols: 120, rows: 32 }
    );

    const proc = ptys.get(id);
    expect(proc).toBeDefined();

    proc!.emitExit(0, undefined);

    expect(notificationCtor).toHaveBeenCalledTimes(1);
    expect(notificationShow).toHaveBeenCalledTimes(1);
  });
});
