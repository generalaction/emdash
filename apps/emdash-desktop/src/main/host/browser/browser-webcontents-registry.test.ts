import type { WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { browserEvents } from '@core/features/browser/node';
import { commandPaletteCommand } from '@core/features/workbench/contributions/commands';
import { desktopHostEvents } from '@core/features/workbench/node';
import { buildBrowserClaims } from '@core/manifests/shared/browser-claims';
import { matchesElectronInput } from '@core/primitives/keybindings/api';
import { KeybindingService } from '@core/primitives/keybindings/browser/keybinding-service';
import { defineViewScope, type ViewScopeImpl } from '@core/primitives/view-scopes/api';
import { ViewScopes } from '@core/primitives/view-scopes/browser';
import { KeybindingDispatcher } from '@renderer/lib/keybindings/keybinding-dispatcher';
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

vi.mock('@core/features/browser/node', () => ({
  browserEvents: {
    emit: vi.fn(),
  },
}));
vi.mock('@core/features/workbench/node', () => ({
  desktopHostEvents: {
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
    getURL: () => 'https://example.com',
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
    vi.mocked(browserEvents.emit).mockClear();
    vi.mocked(desktopHostEvents.emit).mockClear();
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
    expect(browserEvents.emit).toHaveBeenCalledWith(undefined, {
      type: 'open-in-new-tab',
      sourceBrowserId: 'browser-1',
      url: 'https://example.com/docs',
    });

    const windowOpen = handler({
      url: 'https://example.com/popup',
      disposition: 'new-window',
    } as Parameters<typeof handler>[0]);
    expect(windowOpen.action).toBe('deny');
    expect(browserEvents.emit).toHaveBeenCalledWith(undefined, {
      type: 'open-in-new-tab',
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
    expect(desktopHostEvents.emit).toHaveBeenCalledWith(undefined, {
      type: 'tab-navigation-shortcut',
      source: { kind: 'browser', browserId: 'browser-1' },
      direction: 'previous',
    });
  });

  it('emits app shortcuts from focused browser webContents', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.registerSession({ browserId: 'browser-1', partition: PROFILE_PARTITION });

    const webContents = fakeWebContents();
    registry.handleWebviewAttached(webContents);
    registry.bindWebContents('browser-1', webContents);

    const keyEvent = { preventDefault: vi.fn() };
    webContents.emitEvent('before-input-event', keyEvent, {
      type: 'keyDown',
      key: 'K',
      control: false,
      shift: false,
      alt: false,
      meta: true,
    });

    expect(keyEvent.preventDefault).toHaveBeenCalled();
    expect(desktopHostEvents.emit).toHaveBeenCalledWith(undefined, {
      type: 'browser-app-shortcut',
      source: { kind: 'browser', browserId: 'browser-1' },
      commandId: 'app.commandPalette',
    });
  });

  it('does not emit disabled app shortcuts from focused browser webContents', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.setKeyboardSettings({ commandPalette: null });
    registry.registerSession({ browserId: 'browser-1', partition: PROFILE_PARTITION });

    const webContents = fakeWebContents();
    registry.handleWebviewAttached(webContents);
    registry.bindWebContents('browser-1', webContents);

    const keyEvent = { preventDefault: vi.fn() };
    webContents.emitEvent('before-input-event', keyEvent, {
      type: 'keyDown',
      key: 'K',
      control: false,
      shift: false,
      alt: false,
      meta: true,
    });

    expect(keyEvent.preventDefault).not.toHaveBeenCalled();
    expect(desktopHostEvents.emit).not.toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ type: 'browser-app-shortcut' })
    );
  });

  it('does not claim text-input-gated shortcuts from browser webContents', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.registerSession({ browserId: 'browser-1', partition: PROFILE_PARTITION });

    const webContents = fakeWebContents();
    registry.handleWebviewAttached(webContents);
    registry.bindWebContents('browser-1', webContents);

    const keyEvent = { preventDefault: vi.fn() };
    webContents.emitEvent('before-input-event', keyEvent, {
      type: 'keyDown',
      key: 'Backspace',
      control: process.platform !== 'darwin',
      shift: false,
      alt: false,
      meta: process.platform === 'darwin',
    });

    expect(keyEvent.preventDefault).not.toHaveBeenCalled();
    expect(desktopHostEvents.emit).not.toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ type: 'browser-app-shortcut' })
    );
  });

  it('does not consume Escape in focused browser webContents', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.registerSession({ browserId: 'browser-1', partition: PROFILE_PARTITION });

    const webContents = fakeWebContents();
    registry.handleWebviewAttached(webContents);
    registry.bindWebContents('browser-1', webContents);

    const keyEvent = { preventDefault: vi.fn() };
    webContents.emitEvent('before-input-event', keyEvent, {
      type: 'keyDown',
      key: 'Escape',
      control: false,
      shift: false,
      alt: false,
      meta: false,
    });

    expect(keyEvent.preventDefault).not.toHaveBeenCalled();
    expect(desktopHostEvents.emit).not.toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ type: 'browser-app-shortcut' })
    );
  });

  it('does not consume shortcuts ignored in focused browser webContents', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.registerSession({ browserId: 'browser-1', partition: PROFILE_PARTITION });

    const webContents = fakeWebContents();
    registry.handleWebviewAttached(webContents);
    registry.bindWebContents('browser-1', webContents);

    const keyEvent = { preventDefault: vi.fn() };
    webContents.emitEvent('before-input-event', keyEvent, {
      type: 'keyDown',
      key: 'Z',
      control: true,
      shift: false,
      alt: false,
      meta: false,
    });

    expect(keyEvent.preventDefault).not.toHaveBeenCalled();
    expect(desktopHostEvents.emit).not.toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ type: 'browser-app-shortcut' })
    );
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

  it('clears the requested browsing data category across every passed partition', async () => {
    const registry = new BrowserWebContentsRegistry();
    const partitions = [PROFILE_PARTITION, 'persist:emdash-browser-profile-work'];

    await expect(registry.clearBrowsingData('cache', partitions)).resolves.toBe(true);

    for (const partition of partitions) {
      const partitionSession = sessionsByPartition.get(partition) as
        | { clearData: ReturnType<typeof vi.fn> }
        | undefined;
      expect(partitionSession?.clearData).toHaveBeenCalledWith({ dataTypes: ['cache'] });
    }
  });

  it('passes no options for an "all" clear and dataTypes for other categories', async () => {
    const registry = new BrowserWebContentsRegistry();

    await registry.clearBrowsingData('all', [PROFILE_PARTITION]);
    await registry.clearBrowsingData('cookies', [PROFILE_PARTITION]);
    await registry.clearBrowsingData('siteData', [PROFILE_PARTITION]);

    const partitionSession = sessionsByPartition.get(PROFILE_PARTITION) as {
      clearData: ReturnType<typeof vi.fn>;
    };
    expect(partitionSession.clearData).toHaveBeenNthCalledWith(1);
    expect(partitionSession.clearData).toHaveBeenNthCalledWith(2, { dataTypes: ['cookies'] });
    expect(partitionSession.clearData).toHaveBeenNthCalledWith(3, {
      dataTypes: [
        'backgroundFetch',
        'cacheStorage',
        'fileSystems',
        'indexedDB',
        'localStorage',
        'serviceWorkers',
        'webSQL',
      ],
    });
  });

  it('projects one override through dispatch, display, menu, and browser claims', () => {
    const testScope = defineViewScope({
      id: 'test.roundtrip',
      params: z.object({}),
      commands: [commandPaletteCommand] as const,
      activation: 'logical',
    });
    const runtime = new ViewScopes(undefined);
    const execute = vi.fn();
    const instance = runtime.instantiate(testScope(), {
      impl: {
        'app.commandPalette': () => ({ execute }),
      } satisfies ViewScopeImpl<typeof testScope>,
    });
    runtime.activate(instance);
    const service = new KeybindingService([commandPaletteCommand], { os: 'mac' }, [
      commandPaletteCommand,
    ]);
    service.setOverrides({ commandPalette: 'Meta+Shift+P' });
    const dispatcher = new KeybindingDispatcher(service, runtime);
    const event = (key: string, code: string, shiftKey: boolean) =>
      ({
        type: 'keydown',
        key,
        code,
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey,
        repeat: false,
        isComposing: false,
        target: null,
        getModifierState: (modifier: string) =>
          modifier === 'Meta' || (shiftKey && modifier === 'Shift'),
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      }) as unknown as KeyboardEvent;

    expect(dispatcher.dispatch(event('k', 'KeyK', false)).kind).toBe('none');
    expect(dispatcher.dispatch(event('p', 'KeyP', true)).kind).toBe('winner');
    expect(service.chordFor(commandPaletteCommand.id)).toBe('Shift+Meta+P');
    expect(service.snapshotForMenu()[0]?.accelerator).toBe('Shift+Command+P');

    const claim = buildBrowserClaims({ commandPalette: 'Meta+Shift+P' }, { os: 'mac' }).find(
      (entry) => entry.commandId === commandPaletteCommand.id
    );
    expect(claim?.chord).toBe('Shift+Meta+P');
    expect(
      claim &&
        matchesElectronInput(
          {
            type: 'keyDown',
            key: 'P',
            code: 'KeyP',
            meta: true,
            shift: true,
          },
          claim.chord,
          { os: 'mac' }
        )
    ).toBe(true);
    expect(execute).toHaveBeenCalledOnce();
    runtime.dispose();
  });
});
