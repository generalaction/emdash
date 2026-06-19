import type { WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '@main/lib/events';
import { tabNavigationShortcutChannel } from '@shared/events/appEvents';
import { BrowserWebContentsRegistry } from './browser-webcontents-registry';

const sessionsByPartition = new Map<string, object>();

vi.mock('electron', () => ({
  session: {
    fromPartition: (partition: string) => {
      let value = sessionsByPartition.get(partition);
      if (!value) {
        value = { partition, getUserAgent: () => 'base-ua', clearData: vi.fn() };
        sessionsByPartition.set(partition, value);
      }
      return value;
    },
  },
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
  },
}));

const PROFILE_PARTITION = 'persist:emdash-browser-profile';

type FakeWebContents = WebContents & {
  windowOpenHandler: Parameters<WebContents['setWindowOpenHandler']>[0] | null;
  destroy(): void;
  emitEvent(event: string, ...args: unknown[]): void;
};

let nextWebContentsId = 1;

function fakeWebContents(partition: string = PROFILE_PARTITION): FakeWebContents {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const fake = {
    id: nextWebContentsId++,
    session: sessionFor(partition),
    windowOpenHandler: null as FakeWebContents['windowOpenHandler'],
    close: vi.fn(),
    isDestroyed: () => false,
    getUserAgent: () => 'base-ua',
    setUserAgent: vi.fn(),
    openDevTools: vi.fn(),
    setWindowOpenHandler(handler: FakeWebContents['windowOpenHandler']) {
      fake.windowOpenHandler = handler;
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return fake;
    },
    once(event: string, listener: (...args: unknown[]) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return fake;
    },
    destroy() {
      for (const listener of listeners.get('destroyed') ?? []) listener();
    },
    emitEvent(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
  return fake as unknown as FakeWebContents;
}

function sessionFor(partition: string): object {
  let value = sessionsByPartition.get(partition);
  if (!value) {
    value = { partition, getUserAgent: () => 'base-ua', clearData: vi.fn() };
    sessionsByPartition.set(partition, value);
  }
  return value;
}

describe('BrowserWebContentsRegistry', () => {
  beforeEach(() => {
    sessionsByPartition.clear();
    vi.mocked(events.emit).mockClear();
  });

  it('closes attached webviews whose session has no registered partition', () => {
    const registry = new BrowserWebContentsRegistry();
    const webContents = fakeWebContents('persist:other');

    expect(registry.handleWebviewAttached(webContents)).toBe(false);
    expect(webContents.close).toHaveBeenCalled();
  });

  it('binds webviews on a shared partition to their browser ids explicitly', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.registerSession({ browserId: 'browser-1', partition: PROFILE_PARTITION });
    registry.registerSession({ browserId: 'browser-2', partition: PROFILE_PARTITION });

    const first = fakeWebContents();
    const second = fakeWebContents();
    expect(registry.handleWebviewAttached(first)).toBe(true);
    expect(registry.handleWebviewAttached(second)).toBe(true);

    expect(registry.bindWebContents('browser-1', first)).toBe(true);
    expect(registry.bindWebContents('browser-2', second)).toBe(true);

    expect(registry.openDevTools('browser-1')).toBe(true);
    expect(first.openDevTools).toHaveBeenCalled();
    expect(registry.getActiveBrowser()).toBe('browser-2');
  });

  it('rejects binding for unknown browsers, unattached or already-bound webContents', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.registerSession({ browserId: 'browser-1', partition: PROFILE_PARTITION });
    registry.registerSession({ browserId: 'browser-2', partition: PROFILE_PARTITION });

    const attached = fakeWebContents();
    registry.handleWebviewAttached(attached);

    expect(registry.bindWebContents('missing', attached)).toBe(false);
    expect(registry.bindWebContents('browser-1', fakeWebContents())).toBe(false);

    expect(registry.bindWebContents('browser-1', attached)).toBe(true);
    expect(registry.bindWebContents('browser-1', attached)).toBe(true);
    expect(registry.bindWebContents('browser-2', attached)).toBe(false);
  });

  it('rejects binding webContents from a different registered partition', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.registerSession({ browserId: 'browser-1', partition: PROFILE_PARTITION });
    registry.registerSession({
      browserId: 'browser-2',
      partition: 'persist:emdash-browser-profile-work',
    });

    const attached = fakeWebContents(PROFILE_PARTITION);
    registry.handleWebviewAttached(attached);

    expect(registry.bindWebContents('browser-2', attached)).toBe(false);
    expect(registry.bindWebContents('browser-1', attached)).toBe(true);
  });

  it('allows OAuth popups as hardened windows and routes tab links in-app', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.registerSession({ browserId: 'browser-1', partition: PROFILE_PARTITION });

    const webContents = fakeWebContents();
    registry.handleWebviewAttached(webContents);
    registry.bindWebContents('browser-1', webContents);

    const handler = webContents.windowOpenHandler!;
    const popup = handler({
      url: 'https://github.com/login/oauth/authorize',
      disposition: 'new-window',
    } as Parameters<typeof handler>[0]);
    expect(popup.action).toBe('allow');
    expect(popup).toMatchObject({
      overrideBrowserWindowOptions: {
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      },
    });

    const tab = handler({
      url: 'https://example.com/docs',
      disposition: 'foreground-tab',
    } as Parameters<typeof handler>[0]);
    expect(tab.action).toBe('deny');
    expect(events.emit).toHaveBeenCalledWith(expect.anything(), {
      sourceBrowserId: 'browser-1',
      url: 'https://example.com/docs',
    });

    const windowOpen = handler({
      url: 'https://example.com/popup',
      disposition: 'new-window',
    } as Parameters<typeof handler>[0]);
    expect(windowOpen.action).toBe('deny');
    expect(events.emit).toHaveBeenCalledWith(expect.anything(), {
      sourceBrowserId: 'browser-1',
      url: 'https://example.com/popup',
    });

    const blocked = handler({
      url: 'javascript:alert(1)',
      disposition: 'new-window',
    } as Parameters<typeof handler>[0]);
    expect(blocked.action).toBe('deny');
  });

  it('switches popup webContents user agent during Google auth navigations', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.registerSession({ browserId: 'browser-1', partition: PROFILE_PARTITION });
    const webContents = fakeWebContents();
    const popupWebContents = fakeWebContents();

    registry.handleWebviewAttached(webContents);
    webContents.emitEvent('did-create-window', { webContents: popupWebContents });
    popupWebContents.emitEvent(
      'did-start-navigation',
      {},
      'https://accounts.google.com/signin',
      false,
      true
    );

    expect(popupWebContents.setUserAgent).toHaveBeenCalledWith(
      expect.stringContaining('Firefox/140.0')
    );
  });

  it('cleans up bindings when the webContents is destroyed', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.registerSession({ browserId: 'browser-1', partition: PROFILE_PARTITION });

    const webContents = fakeWebContents();
    registry.handleWebviewAttached(webContents);
    registry.bindWebContents('browser-1', webContents);
    expect(registry.getActiveBrowser()).toBe('browser-1');

    webContents.destroy();

    expect(registry.getActiveBrowser()).toBeNull();
    expect(registry.openDevTools('browser-1')).toBe(false);
  });

  it('emits tab navigation shortcuts from focused browser webContents', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.registerSession({ browserId: 'browser-1', partition: PROFILE_PARTITION });

    const webContents = fakeWebContents();
    registry.handleWebviewAttached(webContents);
    registry.bindWebContents('browser-1', webContents);

    const keyEvent = { preventDefault: vi.fn() };
    webContents.emitEvent('before-input-event', keyEvent, {
      type: 'keyDown',
      key: 'Tab',
      control: true,
      shift: true,
      alt: false,
      meta: false,
    });

    expect(keyEvent.preventDefault).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(tabNavigationShortcutChannel, {
      source: { kind: 'browser', browserId: 'browser-1' },
      direction: 'previous',
    });
  });

  it('clears storage for a named profile without requiring an open browser', async () => {
    const registry = new BrowserWebContentsRegistry();

    await expect(registry.clearProfileStorage('work')).resolves.toBe(true);
    await expect(registry.clearProfileStorage('isolated-per-task')).resolves.toBe(false);

    const profileSession = sessionsByPartition.get('persist:emdash-browser-profile-work') as
      | { clearData: ReturnType<typeof vi.fn> }
      | undefined;
    expect(profileSession?.clearData).toHaveBeenCalled();
  });
});
