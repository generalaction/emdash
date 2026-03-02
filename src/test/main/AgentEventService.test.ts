import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import { makePtyId } from '../../shared/ptyId';

// --- Mocks ---

const notificationInstances: Array<{ options: any; clickHandler?: () => void }> = [];
const getMainWindowMock = vi.fn();

vi.mock('electron', () => {
  class MockNotification {
    static isSupported = vi.fn(() => true);
    private _instance: { options: any; clickHandler?: () => void };

    constructor(options: any) {
      this._instance = { options };
      notificationInstances.push(this._instance);
    }

    on(event: string, handler: () => void) {
      if (event === 'click') this._instance.clickHandler = handler;
    }

    show() {}
  }

  return {
    BrowserWindow: {
      getAllWindows: vi.fn(() => [
        {
          isDestroyed: () => false,
          isFocused: () => false,
          webContents: { isDestroyed: () => false, send: vi.fn() },
        },
      ]),
    },
    Notification: MockNotification,
  };
});

vi.mock('../../main/app/window', () => ({
  getMainWindow: (...args: any[]) => getMainWindowMock(...args),
}));

vi.mock('../../main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../main/settings', () => ({
  getAppSettings: vi.fn(() => ({
    notifications: { enabled: true, osNotifications: true },
  })),
}));

vi.mock('../../shared/providers/registry', () => ({
  PROVIDER_IDS: ['claude'],
  getProvider: vi.fn(() => ({ name: 'Claude' })),
}));

vi.mock('../../main/services/DatabaseService', () => ({
  databaseService: {
    getTaskById: vi.fn(async () => ({ name: 'My Task' })),
  },
}));

// --- Helpers ---

function postEvent(
  port: number,
  token: string,
  ptyId: string,
  type: string,
  body: Record<string, any> = {}
): Promise<number> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/hook',
        method: 'POST',
        headers: {
          'x-emdash-token': token,
          'x-emdash-pty-id': ptyId,
          'x-emdash-event-type': type,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
        },
      },
      (res) => resolve(res.statusCode ?? 0)
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// --- Tests ---

describe('AgentEventService notification click', () => {
  let service: typeof import('../../main/services/AgentEventService').agentEventService;

  beforeEach(async () => {
    vi.clearAllMocks();
    notificationInstances.length = 0;
    const mod = await import('../../main/services/AgentEventService');
    service = mod.agentEventService;
    await service.start();
  });

  afterEach(() => {
    service?.stop();
  });

  it('click handler focuses window and sends focus-task IPC for main PTY', async () => {
    const ptyId = makePtyId('claude', 'main', 'task-123');
    const status = await postEvent(service.getPort(), service.getToken(), ptyId, 'stop');
    expect(status).toBe(200);
    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].clickHandler).toBeTypeOf('function');

    const mockWin = {
      isDestroyed: () => false,
      isMinimized: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn(),
      webContents: { send: vi.fn() },
    };
    getMainWindowMock.mockReturnValue(mockWin);

    notificationInstances[0].clickHandler!();

    expect(mockWin.show).toHaveBeenCalled();
    expect(mockWin.focus).toHaveBeenCalled();
    expect(mockWin.restore).not.toHaveBeenCalled();
    expect(mockWin.webContents.send).toHaveBeenCalledWith('notification:focus-task', 'task-123');
  });

  it('restores minimized window on click', async () => {
    const ptyId = makePtyId('claude', 'main', 'task-456');
    await postEvent(service.getPort(), service.getToken(), ptyId, 'stop');

    const mockWin = {
      isDestroyed: () => false,
      isMinimized: () => true,
      show: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn(),
      webContents: { send: vi.fn() },
    };
    getMainWindowMock.mockReturnValue(mockWin);

    notificationInstances[0].clickHandler!();

    expect(mockWin.restore).toHaveBeenCalled();
  });

  it('does not send focus-task IPC for chat PTY', async () => {
    const ptyId = makePtyId('claude', 'chat', 'conv-789');
    await postEvent(service.getPort(), service.getToken(), ptyId, 'notification', {
      notification_type: 'permission_prompt',
    });
    expect(notificationInstances).toHaveLength(1);

    const mockWin = {
      isDestroyed: () => false,
      isMinimized: () => false,
      show: vi.fn(),
      focus: vi.fn(),
      restore: vi.fn(),
      webContents: { send: vi.fn() },
    };
    getMainWindowMock.mockReturnValue(mockWin);

    notificationInstances[0].clickHandler!();

    expect(mockWin.show).toHaveBeenCalled();
    expect(mockWin.focus).toHaveBeenCalled();
    expect(mockWin.webContents.send).not.toHaveBeenCalled();
  });
});
