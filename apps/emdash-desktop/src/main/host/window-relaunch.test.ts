import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Rectangle } from 'electron';
import { expect, it, vi } from 'vitest';
import { createMainWindow } from './window';

let profile: string;
const bounds = { x: -1200, y: 60, width: 900, height: 600 };

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const display = { id: 7, workArea: { x: -1600, y: 0, width: 1600, height: 900 } };
  class BrowserWindow extends EventEmitter {
    webContents = new EventEmitter();
    constructor(readonly options: Partial<Rectangle>) {
      super();
    }
    getNormalBounds = () => bounds;
    isDestroyed = () => false;
    isMaximized = () => true;
    isFullScreen = () => false;
    maximize = vi.fn();
    show = vi.fn();
    setMenuBarVisibility = vi.fn();
    loadURL = vi.fn();
  }
  return {
    BrowserWindow,
    app: Object.assign(new EventEmitter(), { getPath: () => profile, getAppPath: () => '' }),
    nativeTheme: {},
    screen: {
      getDisplayMatching: () => display,
      getAllDisplays: () => [display],
      getPrimaryDisplay: () => display,
    },
  };
});
vi.mock('@/assets/images/emdash/emdash-dev.png?asset', () => ({ default: '' }));
vi.mock('@core/features/workbench/node', () => ({ desktopHostEvents: {} }));
vi.mock('@main/bootstrap/core/boot-report', () => ({ recordWindowVisible: vi.fn() }));
vi.mock('@main/bootstrap/core/boot-status', () => ({ reportBootSuccessSignal: vi.fn() }));
vi.mock('@main/bootstrap/shutdown', () => ({
  watchWindow: vi.fn(),
  shouldAllowWindowClose: () => true,
}));
vi.mock('@main/host/externalLinks', () => ({ registerExternalLinkHandlers: vi.fn() }));
vi.mock('@main/host/browser/browser-webcontents-registry', () => ({
  browserWebContentsRegistry: {},
}));
vi.mock('@main/lib/logger', () => ({ log: { info: vi.fn() } }));
vi.mock('@main/lib/telemetry', () => ({ telemetryService: {} }));
vi.mock('./protocol', () => ({ APP_ORIGIN: 'app://emdash' }));

it.each(['close', 'before-quit'])(
  'restores placement on the next launch after %s',
  async (event) => {
    const { app } = await import('electron');
    profile = mkdtempSync(join(tmpdir(), 'emdash-relaunch-'));
    const getCreationTime = process.getCreationTime;
    process.getCreationTime = () => Date.now();
    try {
      const first = createMainWindow();
      expect(first).toMatchObject({ options: { width: 1400, height: 900 } });
      const emitter: EventEmitter = event === 'close' ? first : app;
      emitter.emit(event);
      first.emit('closed');
      expect(app.listenerCount('before-quit')).toBe(0);
      const reopened = createMainWindow();
      expect(reopened).toMatchObject({ options: bounds });
      expect(reopened.maximize).toHaveBeenCalledOnce();
      reopened.emit('closed');
    } finally {
      process.getCreationTime = getCreationTime;
      rmSync(profile, { recursive: true, force: true });
    }
  }
);
