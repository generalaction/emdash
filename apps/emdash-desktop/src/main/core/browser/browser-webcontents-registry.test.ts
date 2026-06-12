import type { BrowserWindow as ElectronBrowserWindow, WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browserLinkCopiedChannel, browserOpenInNewTabChannel } from '@shared/events/browserEvents';
import { BrowserWebContentsRegistry } from './browser-webcontents-registry';

const sessionsByPartition = new Map<string, object>();
const mocks = vi.hoisted(() => {
  const menuPopup = vi.fn();
  return {
    clipboardWriteText: vi.fn(),
    menuPopup,
    menuBuildFromTemplate: vi.fn((template: unknown[]) => ({ popup: menuPopup, template })),
    eventsEmit: vi.fn(),
  };
});

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => null),
    getFocusedWindow: vi.fn(() => null),
  },
  clipboard: {
    writeText: mocks.clipboardWriteText,
  },
  Menu: {
    buildFromTemplate: mocks.menuBuildFromTemplate,
  },
  session: {
    fromPartition: (partition: string) => {
      let value = sessionsByPartition.get(partition);
      if (!value) {
        value = { partition };
        sessionsByPartition.set(partition, value);
      }
      return value;
    },
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: mocks.eventsEmit,
  },
}));

function webContentsWithSession(session: object): WebContents {
  return {
    session,
  } as WebContents;
}

function attachedWebContents(session: object): WebContents & {
  emitContextMenu: (linkURL: string) => void;
  emitCopyUrlShortcut: (input?: Partial<Electron.Input>) => void;
} {
  const listeners = new Map<
    string,
    (event: { preventDefault: () => void }, params: never) => void
  >();
  return {
    id: 1,
    session,
    getURL: vi.fn(() => 'https://example.com/current'),
    isDestroyed: () => false,
    loadURL: vi.fn(),
    reload: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    getOwnerBrowserWindow: () => null,
    on: vi.fn(
      (
        eventName: string,
        listener: (event: { preventDefault: () => void }, params: never) => void
      ) => {
        listeners.set(eventName, listener);
        return undefined;
      }
    ),
    once: vi.fn(),
    emitContextMenu: (linkURL: string) => {
      listeners.get('context-menu')?.({ preventDefault: vi.fn() }, { linkURL } as never);
    },
    emitCopyUrlShortcut: (input = {}) => {
      listeners.get('before-input-event')?.({ preventDefault: vi.fn() }, {
        type: 'keyDown',
        key: 'c',
        shift: true,
        meta: process.platform === 'darwin',
        control: process.platform !== 'darwin',
        alt: false,
        ...input,
      } as never);
    },
  } as unknown as WebContents & {
    emitContextMenu: (linkURL: string) => void;
    emitCopyUrlShortcut: (input?: Partial<Electron.Input>) => void;
  };
}

function ownerWindow() {
  return {} as ElectronBrowserWindow;
}

describe('BrowserWebContentsRegistry', () => {
  beforeEach(() => {
    sessionsByPartition.clear();
    mocks.clipboardWriteText.mockClear();
    mocks.menuPopup.mockClear();
    mocks.menuBuildFromTemplate.mockClear();
    mocks.eventsEmit.mockClear();
  });

  it('resolves the browser id from the attached webContents session', () => {
    const registry = new BrowserWebContentsRegistry();
    const firstPartition = 'persist:emdash-browser-project-workspace-task-browser-1';
    const secondPartition = 'persist:emdash-browser-project-workspace-task-browser-2';
    const firstSession = { partition: firstPartition };
    const secondSession = { partition: secondPartition };
    sessionsByPartition.set(firstPartition, firstSession);
    sessionsByPartition.set(secondPartition, secondSession);

    registry.registerSession({
      browserId: 'browser-1',
      partition: firstPartition,
    });
    registry.registerSession({
      browserId: 'browser-2',
      partition: secondPartition,
    });

    expect(registry.getBrowserIdForWebContents(webContentsWithSession(secondSession))).toBe(
      'browser-2'
    );
  });

  it('does not resolve unregistered webContents sessions', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.registerSession({
      browserId: 'browser-1',
      partition: 'persist:emdash-browser-project-workspace-task-browser-1',
    });

    expect(registry.getBrowserIdForWebContents(webContentsWithSession({}))).toBeUndefined();
  });

  it('shows link context menu with copy and open in new tab actions', () => {
    const registry = new BrowserWebContentsRegistry();
    const partition = 'persist:emdash-browser-project-workspace-task-browser-1';
    const webContentsSession = { partition };
    sessionsByPartition.set(partition, webContentsSession);
    const webContents = attachedWebContents(webContentsSession);
    registry.registerSession({ browserId: 'browser-1', partition });

    registry.attachWebContents('browser-1', webContents, ownerWindow());
    webContents.emitContextMenu('https://example.com/docs');

    expect(mocks.menuBuildFromTemplate).toHaveBeenCalledTimes(1);
    const template = mocks.menuBuildFromTemplate.mock.calls[0]?.[0] as Array<{ click: () => void }>;
    template[0]?.click();
    template[1]?.click();
    template[2]?.click();

    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('https://example.com/docs');
    expect(mocks.eventsEmit).toHaveBeenCalledWith(browserLinkCopiedChannel, {
      kind: 'link',
      url: 'https://example.com/docs',
    });
    expect(webContents.loadURL).toHaveBeenCalledWith('https://example.com/docs');
    expect(mocks.eventsEmit).toHaveBeenCalledWith(browserOpenInNewTabChannel, {
      sourceBrowserId: 'browser-1',
      url: 'https://example.com/docs',
    });
    expect(mocks.menuPopup).toHaveBeenCalledWith({
      window: expect.any(Object),
      x: undefined,
      y: undefined,
    });
  });

  it('shows disabled link actions for unsupported URLs', () => {
    const registry = new BrowserWebContentsRegistry();
    const partition = 'persist:emdash-browser-project-workspace-task-browser-1';
    const webContentsSession = { partition };
    const webContents = attachedWebContents(webContentsSession);
    registry.registerSession({ browserId: 'browser-1', partition });

    registry.attachWebContents('browser-1', webContents, ownerWindow());
    webContents.emitContextMenu('javascript:alert(1)');

    expect(mocks.menuBuildFromTemplate).toHaveBeenCalledTimes(1);
    expect(mocks.menuBuildFromTemplate.mock.calls[0]?.[0]).toMatchObject([
      { label: 'Copy Link', enabled: false },
      { label: 'Open Link', enabled: false },
      { label: 'Open Link in New Tab', enabled: false },
      { type: 'separator' },
      { label: 'Reload' },
    ]);
  });

  it('copies the current browser URL from the webview shortcut', () => {
    const registry = new BrowserWebContentsRegistry();
    const partition = 'persist:emdash-browser-project-workspace-task-browser-1';
    const webContentsSession = { partition };
    const webContents = attachedWebContents(webContentsSession);
    registry.registerSession({ browserId: 'browser-1', partition });

    registry.attachWebContents('browser-1', webContents, ownerWindow());
    webContents.emitCopyUrlShortcut();

    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('https://example.com/current');
    expect(mocks.eventsEmit).toHaveBeenCalledWith(browserLinkCopiedChannel, {
      kind: 'url',
      url: 'https://example.com/current',
    });
  });

  it('uses the configured webview copy URL shortcut', () => {
    const registry = new BrowserWebContentsRegistry();
    const partition = 'persist:emdash-browser-project-workspace-task-browser-1';
    const webContentsSession = { partition };
    const webContents = attachedWebContents(webContentsSession);
    registry.registerSession({ browserId: 'browser-1', partition });
    registry.setKeyboardSettings({ browserCopyUrl: 'Control+Shift+U' });

    registry.attachWebContents('browser-1', webContents, ownerWindow());
    webContents.emitCopyUrlShortcut();
    webContents.emitCopyUrlShortcut({ key: 'u', meta: false, control: true });

    expect(mocks.clipboardWriteText).toHaveBeenCalledTimes(1);
    expect(mocks.clipboardWriteText).toHaveBeenCalledWith('https://example.com/current');
  });

  it('does not copy from the webview when the copy URL shortcut is cleared', () => {
    const registry = new BrowserWebContentsRegistry();
    const partition = 'persist:emdash-browser-project-workspace-task-browser-1';
    const webContentsSession = { partition };
    const webContents = attachedWebContents(webContentsSession);
    registry.registerSession({ browserId: 'browser-1', partition });
    registry.setKeyboardSettings({ browserCopyUrl: null });

    registry.attachWebContents('browser-1', webContents, ownerWindow());
    webContents.emitCopyUrlShortcut();

    expect(mocks.clipboardWriteText).not.toHaveBeenCalled();
    expect(mocks.eventsEmit).not.toHaveBeenCalledWith(browserLinkCopiedChannel, expect.any(Object));
  });
});
