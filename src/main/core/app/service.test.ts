import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exec: vi.fn(),
  getVersion: vi.fn(() => '1.1.27'),
  openExternal: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  exec: mocks.exec,
}));

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => ''),
    getVersion: mocks.getVersion,
    quit: vi.fn(),
  },
  clipboard: {
    writeText: vi.fn(),
  },
  dialog: {
    showOpenDialog: vi.fn(),
  },
  shell: {
    openExternal: mocks.openExternal,
    openPath: mocks.openPath,
  },
}));

vi.mock('@main/app/window', () => ({
  getMainWindow: vi.fn(),
}));

vi.mock('@main/db/client', () => ({
  db: {},
}));

vi.mock('@main/db/schema', () => ({
  sshConnections: {},
}));

vi.mock('@main/lib/events', () => ({
  events: {
    on: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    error: vi.fn(),
  },
}));

vi.mock('@main/utils/childProcessEnv', () => ({
  buildExternalToolEnv: () => ({}),
}));

const { appService } = await import('./service');

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    ...originalPlatform,
    value: platform,
  });
}

describe('AppService.openIn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPlatform('win32');
    mocks.openPath.mockResolvedValue('');
    mocks.exec.mockImplementation(
      (_command: string, _options: object, callback: (error: Error | null) => void) => {
        callback(null);
      }
    );
  });

  afterEach(() => {
    if (originalPlatform) Object.defineProperty(process, 'platform', originalPlatform);
  });

  it('opens the platform file manager with Electron shell.openPath instead of a shell command', async () => {
    const target = 'C:/Users/Qwenzy/Desktop/ees_ams';

    await appService.openIn({ app: 'finder', path: target });

    expect(mocks.openPath).toHaveBeenCalledWith(target);
    expect(mocks.exec).not.toHaveBeenCalled();
  });
});
