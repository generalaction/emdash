import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Rectangle } from 'electron';
import { expect, it, vi } from 'vitest';
import { createMainWindow, showMainWindow } from './window';
import { readWindowPlacement } from './window-placement';

let allowClose = true;
let profile: string;
let fullscreen: boolean;
let maximized: boolean;
const tiled = { x: -1600, y: 400, width: 800, height: 500 };
const bounds = { x: -1200, y: 60, width: 900, height: 600 };

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const display = {
    id: 7,
    workArea: { x: -1600, y: 0, width: 1600, height: 900 },
  };
  class BrowserWindow extends EventEmitter {
    webContents = new EventEmitter();
    constructor(readonly options: Partial<Rectangle>) {
      super();
    }
    getNormalBounds = () => bounds;
    getBounds = () => (this.options.x === undefined ? tiled : bounds);
    setBounds = vi.fn();
    isMinimized = () => false;
    isDestroyed = () => false;
    visible = false;
    isVisible = () => this.visible;
    hide = () => {
      this.visible = false;
    };
    focus = vi.fn();
    isMaximized = () => maximized;
    isFullScreen = () => fullscreen;
    setFullScreen = vi.fn();
    maximize = vi.fn();
    show = () => {
      this.visible = true;
    };
    setMenuBarVisibility = vi.fn();
    loadURL = vi.fn();
  }
  return {
    BrowserWindow,
    app: Object.assign(new EventEmitter(), {
      focus: vi.fn(),
      getPath: () => profile,
      getAppPath: () => '',
    }),
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
vi.mock('@main/bootstrap/core/boot-report', () => ({
  recordWindowVisible: vi.fn(),
}));
vi.mock('@main/bootstrap/core/boot-status', () => ({
  reportBootSuccessSignal: vi.fn(),
}));
vi.mock('@main/bootstrap/shutdown', () => ({
  watchWindow: vi.fn(),
  shouldAllowWindowClose: () => allowClose,
  isShutdownInProgress: () => false,
}));
vi.mock('@main/host/externalLinks', () => ({
  registerExternalLinkHandlers: vi.fn(),
}));
vi.mock('@main/host/browser/browser-webcontents-registry', () => ({
  browserWebContentsRegistry: {},
}));
vi.mock('@main/lib/logger', () => ({ log: { info: vi.fn() } }));
vi.mock('@main/lib/telemetry', () => ({ telemetryService: {} }));
vi.mock('./protocol', () => ({ APP_ORIGIN: 'app://emdash' }));

it.each([
  ['close', false, false],
  ['before-quit', false, true],
  ['before-quit', true, false],
] as const)(
  'restores placement on the next launch after %s (fullscreen=%s, maximized=%s)',
  async (event, inFullscreen, isMaximized) => {
    fullscreen = inFullscreen;
    maximized = isMaximized;
    const { app } = await import('electron');
    profile = mkdtempSync(join(tmpdir(), 'emdash-relaunch-'));
    const getCreationTime = process.getCreationTime;
    process.getCreationTime = () => Date.now();
    try {
      const first = createMainWindow();
      expect(first).toMatchObject({ options: { width: 1400, height: 900 } });
      const emitter: EventEmitter = event === 'close' ? first : app;
      emitter.emit(event);
      expect(readWindowPlacement(join(profile, 'main-window-placement.json'))?.fullscreen).toBe(
        fullscreen
      );
      first.emit('closed');
      expect(app.listenerCount('before-quit')).toBe(0);
      const reopened = createMainWindow();
      expect(reopened).toMatchObject({
        options: fullscreen || maximized ? bounds : tiled,
      });
      if (fullscreen) expect(reopened.setFullScreen).toHaveBeenCalledWith(true);
      else if (!maximized && process.platform === 'darwin')
        expect(reopened.setBounds).toHaveBeenCalledWith(tiled);
      else if (maximized) expect(reopened.maximize).toHaveBeenCalledOnce();
      reopened.emit('closed');
    } finally {
      process.getCreationTime = getCreationTime;
      rmSync(profile, { recursive: true, force: true });
    }
  }
);

it.skipIf(process.platform !== 'darwin')(
  'reopens the same hidden window on the remaining display after unplugging its monitor',
  async () => {
    const { screen } = await import('electron');
    const primary = {
      ...screen.getPrimaryDisplay(),
      id: 1,
      workArea: { x: 0, y: 30, width: 1400, height: 900 },
    };
    profile = mkdtempSync(join(tmpdir(), 'emdash-hidden-'));
    const getCreationTime = process.getCreationTime;
    process.getCreationTime = () => Date.now();
    allowClose = false;
    fullscreen = maximized = false;
    try {
      const window = createMainWindow();
      const preventDefault = vi.fn();
      window.emit('close', { preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
      expect(window.isVisible()).toBe(false);
      vi.spyOn(screen, 'getAllDisplays').mockReturnValue([primary]);
      vi.spyOn(screen, 'getPrimaryDisplay').mockReturnValue(primary);
      expect(showMainWindow()).toBe(window);
      expect(window.isVisible()).toBe(true);
      expect(window.setBounds).toHaveBeenCalledWith({ x: 300, y: 230, width: 800, height: 500 });
      window.emit('closed');
    } finally {
      allowClose = true;
      process.getCreationTime = getCreationTime;
      vi.restoreAllMocks();
      rmSync(profile, { recursive: true, force: true });
    }
  }
);
