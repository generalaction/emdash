import type { WebContents } from 'electron';
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { events } from '@main/lib/events';
import { LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX } from '@shared/core/loops/loop-browser-contracts';
import { browserAppShortcutChannel, tabNavigationShortcutChannel } from '@shared/events/appEvents';
import { BrowserWebContentsRegistry } from './browser-webcontents-registry';

const sessionsByPartition = new Map<string, object>();

vi.mock('electron', () => ({
  clipboard: {
    writeImage: vi.fn(),
    writeText: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })),
  },
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
  currentUrl: string;
  currentTitle: string;
  destroy(): void;
  emitEvent(event: string, ...args: unknown[]): void;
};

let nextWebContentsId = 1;

function fakeWebContents(partition: string = PROFILE_PARTITION): FakeWebContents {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const fake = {
    id: nextWebContentsId++,
    session: sessionFor(partition),
    currentUrl: 'https://example.com',
    currentTitle: 'Preview',
    windowOpenHandler: null as FakeWebContents['windowOpenHandler'],
    close: vi.fn(),
    isDestroyed: () => false,
    getURL: () => fake.currentUrl,
    getTitle: () => fake.currentTitle,
    getUserAgent: () => 'base-ua',
    setUserAgent: vi.fn(),
    openDevTools: vi.fn(),
    loadURL: vi.fn(async (url: string) => {
      fake.currentUrl = url;
    }),
    executeJavaScript: vi.fn(async () => ({ matches: [], truncated: false })),
    sendInputEvent: vi.fn(),
    capturePage: vi.fn(async () => ({
      isEmpty: () => false,
      toPNG: () => Buffer.from('png'),
    })),
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

  it('updates a user browser registration atomically when its profile partition changes', () => {
    const registry = new BrowserWebContentsRegistry();
    registry.registerSession({ browserId: 'browser-1', partition: PROFILE_PARTITION });
    const attached = fakeWebContents(PROFILE_PARTITION);
    registry.handleWebviewAttached(attached);
    registry.bindWebContents('browser-1', attached);

    expect(
      registry.registerSession({
        browserId: 'browser-1',
        partition: 'persist:emdash-browser-profile-work',
      })
    ).toBe(true);
    expect(registry.openDevTools('browser-1')).toBe(false);
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
      control: process.platform !== 'darwin',
      shift: false,
      alt: false,
      meta: process.platform === 'darwin',
    });

    expect(keyEvent.preventDefault).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalledWith(browserAppShortcutChannel, {
      source: { kind: 'browser', browserId: 'browser-1' },
      shortcutKey: 'commandPalette',
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
    expect(events.emit).not.toHaveBeenCalledWith(browserAppShortcutChannel, expect.anything());
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
    expect(events.emit).not.toHaveBeenCalledWith(browserAppShortcutChannel, expect.anything());
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
    expect(events.emit).not.toHaveBeenCalledWith(browserAppShortcutChannel, expect.anything());
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

  describe('Loop verification ownership', () => {
    const lease = {
      verificationRunId: 'run-1',
      browserId: 'verification-browser-1',
      projectId: 'project-1',
      taskId: 'task-1',
      workspaceId: 'workspace-1',
      partition: `${LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX}run-1`,
      allowedPreviewOrigin: 'http://127.0.0.1:4173',
    } as const;

    it('rejects browser and partition collisions without downgrading verification ownership', () => {
      const registry = new BrowserWebContentsRegistry();

      expect(
        registry.registerSession({ browserId: 'browser-1', partition: PROFILE_PARTITION })
      ).toBe(true);
      expect(
        registry.registerSession({
          browserId: 'browser-1',
          partition: 'persist:emdash-browser-profile-work',
        })
      ).toBe(true);
      expect(
        registry.registerSession({ browserId: 'forged-normal', partition: lease.partition })
      ).toBe(false);

      expect(registry.registerVerificationSession(lease)).toBe(true);
      expect(registry.registerVerificationSession(lease)).toBe(true);
      expect(
        registry.registerVerificationSession({ ...lease, browserId: 'verification-browser-2' })
      ).toBe(false);
      expect(
        registry.registerSession({ browserId: lease.browserId, partition: lease.partition })
      ).toBe(false);
    });

    it('binds only the exact origin-owned verification webContents and denies popup escape', () => {
      const registry = new BrowserWebContentsRegistry();
      expect(registry.registerVerificationSession(lease)).toBe(true);

      const external = fakeWebContents(lease.partition);
      external.currentUrl = 'https://example.com/';
      expect(registry.handleWebviewAttached(external)).toBe(true);
      expect(registry.bindWebContents(lease.browserId, external)).toBe(false);

      const webContents = fakeWebContents(lease.partition);
      webContents.currentUrl = 'http://127.0.0.1:4173/settings';
      expect(registry.handleWebviewAttached(webContents)).toBe(true);
      expect(registry.bindWebContents(lease.browserId, webContents)).toBe(true);

      expect(
        webContents.windowOpenHandler?.({
          url: 'https://github.com/login/oauth/authorize',
          disposition: 'new-window',
        } as Parameters<NonNullable<FakeWebContents['windowOpenHandler']>>[0])
      ).toEqual({ action: 'deny' });

      const navigation = { preventDefault: vi.fn() };
      webContents.emitEvent('will-navigate', navigation, 'https://example.com/escape');
      expect(navigation.preventDefault).toHaveBeenCalledOnce();
    });

    it('closes pending guests on revoke and rejects guests attached after revocation', () => {
      const registry = new BrowserWebContentsRegistry();
      expect(registry.registerVerificationSession(lease)).toBe(true);
      const pending = fakeWebContents(lease.partition);
      pending.currentUrl = 'http://127.0.0.1:4173/';

      expect(registry.handleWebviewAttached(pending)).toBe(true);
      expect(registry.revokeVerificationSession(lease)).toBe(true);
      expect(pending.close).toHaveBeenCalledOnce();

      const late = fakeWebContents(lease.partition);
      late.currentUrl = 'http://127.0.0.1:4173/';
      expect(registry.handleWebviewAttached(late)).toBe(false);
      expect(late.close).toHaveBeenCalledOnce();
    });

    it('attests ready only for the exact bound lease URL', () => {
      const registry = new BrowserWebContentsRegistry();
      registry.registerVerificationSession(lease);
      const webContents = fakeWebContents(lease.partition);
      webContents.currentUrl = 'http://127.0.0.1:4173/settings';

      expect(registry.isVerificationSessionReady(lease, webContents.currentUrl)).toBe(false);
      registry.handleWebviewAttached(webContents);
      registry.bindWebContents(lease.browserId, webContents);
      expect(registry.isVerificationSessionReady(lease, webContents.currentUrl)).toBe(true);
      expect(registry.isVerificationSessionReady(lease, 'http://127.0.0.1:4173/other')).toBe(false);
      expect(
        registry.isVerificationSessionReady(
          { ...lease, workspaceId: 'forged-workspace' },
          webContents.currentUrl
        )
      ).toBe(false);
    });

    it('runs audited actions, returns screenshot bytes without clipboard, and revokes atomically', async () => {
      const registry = new BrowserWebContentsRegistry();
      registry.registerVerificationSession(lease);
      const webContents = fakeWebContents(lease.partition);
      webContents.currentUrl = 'http://127.0.0.1:4173/';
      registry.handleWebviewAttached(webContents);
      registry.bindWebContents(lease.browserId, webContents);

      const navigation = await registry.performVerificationAction(lease, {
        kind: 'navigate',
        url: 'http://127.0.0.1:4173/settings',
      });
      expect(navigation.result).toEqual({
        ok: true,
        observation: {
          kind: 'navigation',
          currentUrl: 'http://127.0.0.1:4173/settings',
          title: 'Preview',
        },
      });
      expect(webContents.loadURL).toHaveBeenCalledWith('http://127.0.0.1:4173/settings');

      const rejected = await registry.performVerificationAction(lease, {
        kind: 'navigate',
        url: 'https://example.com/',
      });
      expect(rejected.result).toMatchObject({
        ok: false,
        error: { kind: 'origin-rejected' },
      });

      webContents.currentUrl = 'http://user:password@127.0.0.1:4173/settings';
      const credentialsRejected = await registry.performVerificationAction(lease, {
        kind: 'keypress',
        key: 'Enter',
      });
      expect(credentialsRejected.result).toMatchObject({
        ok: false,
        error: { kind: 'origin-rejected' },
      });
      expect(JSON.stringify(credentialsRejected.result)).not.toContain('password');
      webContents.currentUrl = 'http://127.0.0.1:4173/settings';

      const screenshot = await registry.performVerificationAction(lease, {
        kind: 'screenshot',
        label: 'settings',
      });
      expect(screenshot.result).toMatchObject({
        ok: true,
        observation: {
          kind: 'screenshot',
          artifact: { mimeType: 'image/png', byteLength: 3 },
        },
      });
      expect(screenshot.screenshot?.data).toEqual(Buffer.from('png'));

      expect(registry.revokeVerificationSession(lease)).toBe(true);
      expect(webContents.close).toHaveBeenCalledOnce();
      await expect(
        registry.performVerificationAction(lease, { kind: 'accessibility-snapshot' })
      ).resolves.toMatchObject({
        result: { ok: false, error: { kind: 'lease-closed' } },
      });
    });

    it('never reads or fills password field values through fixed accessibility scripts', async () => {
      const registry = new BrowserWebContentsRegistry();
      registry.registerVerificationSession(lease);
      const webContents = fakeWebContents(lease.partition);
      webContents.currentUrl = 'http://127.0.0.1:4173/';
      registry.handleWebviewAttached(webContents);
      registry.bindWebContents(lease.browserId, webContents);
      const dom = new JSDOM(
        '<body><label>Password<input type="password" aria-label="Password" value="super-secret"></label></body>',
        { url: webContents.currentUrl, runScripts: 'outside-only' }
      );
      vi.mocked(webContents.executeJavaScript).mockImplementation(async (script) =>
        dom.window.eval(script)
      );

      const snapshot = await registry.performVerificationAction(lease, {
        kind: 'accessibility-snapshot',
      });
      expect(snapshot.result).toMatchObject({
        ok: true,
        observation: { kind: 'accessibility-snapshot' },
      });
      expect(JSON.stringify(snapshot.result)).not.toContain('super-secret');

      const query = await registry.performVerificationAction(lease, {
        kind: 'accessibility-query',
        target: { role: 'input', name: 'Password' },
        limit: 20,
      });
      expect(query.result).toMatchObject({
        ok: true,
        observation: {
          kind: 'accessibility-query',
          matches: [expect.not.objectContaining({ value: 'super-secret' })],
        },
      });

      const fill = await registry.performVerificationAction(lease, {
        kind: 'fill',
        target: { role: 'input', name: 'Password' },
        value: 'replacement-secret',
      });
      expect(fill.result).toMatchObject({
        ok: false,
        error: { kind: 'target-not-found' },
      });
      expect(dom.window.document.querySelector<HTMLInputElement>('input')?.value).toBe(
        'super-secret'
      );
      dom.window.close();
    });

    it('redacts accessibility observations before they cross the browser boundary', async () => {
      const registry = new BrowserWebContentsRegistry();
      registry.registerVerificationSession(lease);
      const webContents = fakeWebContents(lease.partition);
      webContents.currentUrl = 'http://127.0.0.1:4173/';
      webContents.currentTitle = 'Preview token=super-secret';
      registry.handleWebviewAttached(webContents);
      registry.bindWebContents(lease.browserId, webContents);

      vi.mocked(webContents.executeJavaScript)
        .mockResolvedValueOnce({ snapshot: 'status token=super-secret', truncated: false })
        .mockResolvedValueOnce({
          matches: [
            {
              nodeId: 'api_key=secret-node',
              role: 'input',
              name: 'token=secret-name',
              value: 'password=secret-value',
            },
          ],
          truncated: false,
        });

      const snapshot = await registry.performVerificationAction(lease, {
        kind: 'accessibility-snapshot',
      });
      const query = await registry.performVerificationAction(lease, {
        kind: 'accessibility-query',
        target: { role: 'input' },
        limit: 20,
      });

      expect(JSON.stringify(snapshot.result)).not.toContain('super-secret');
      expect(JSON.stringify(snapshot.result)).toContain('[REDACTED]');
      expect(JSON.stringify(query.result)).not.toContain('secret-node');
      expect(JSON.stringify(query.result)).not.toContain('secret-name');
      expect(JSON.stringify(query.result)).not.toContain('secret-value');
      expect(JSON.stringify(query.result)).toContain('[REDACTED]');

      const navigation = await registry.performVerificationAction(lease, {
        kind: 'navigate',
        url: 'http://127.0.0.1:4173/settings?token=super-secret#access_token=secret-fragment',
      });
      expect(JSON.stringify(navigation.result)).not.toContain('super-secret');
      expect(JSON.stringify(navigation.result)).not.toContain('secret-fragment');
      expect(JSON.stringify(navigation.result)).toContain('[REDACTED]');
      expect(navigation.result).toMatchObject({
        ok: true,
        observation: { currentUrl: 'http://127.0.0.1:4173/settings' },
      });

      webContents.currentUrl =
        'http://127.0.0.1:4173/callback?code=super-secret#access_token=secret-fragment';
      const keypress = await registry.performVerificationAction(lease, {
        kind: 'keypress',
        key: 'Enter',
      });
      expect(JSON.stringify(keypress.result)).not.toContain('super-secret');
      expect(JSON.stringify(keypress.result)).not.toContain('secret-fragment');
      expect(keypress.result).toMatchObject({
        ok: true,
        observation: { currentUrl: 'http://127.0.0.1:4173/callback' },
      });
    });

    it('fills controlled inputs through the native value setter', async () => {
      const registry = new BrowserWebContentsRegistry();
      registry.registerVerificationSession(lease);
      const webContents = fakeWebContents(lease.partition);
      webContents.currentUrl = 'http://127.0.0.1:4173/';
      registry.handleWebviewAttached(webContents);
      registry.bindWebContents(lease.browserId, webContents);
      const dom = new JSDOM('<body><input aria-label="Name" value="before"></body>', {
        url: webContents.currentUrl,
        runScripts: 'outside-only',
      });
      vi.mocked(webContents.executeJavaScript).mockImplementation(async (script) =>
        dom.window.eval(script)
      );
      const input = dom.window.document.querySelector<HTMLInputElement>('input')!;
      const ownSetter = vi.fn();
      Object.defineProperty(input, 'value', {
        configurable: true,
        get: () => 'tracked',
        set: ownSetter,
      });

      const fill = await registry.performVerificationAction(lease, {
        kind: 'fill',
        target: { role: 'input', name: 'Name' },
        value: 'after',
      });

      expect(fill.result).toMatchObject({ ok: true });
      expect(ownSetter).not.toHaveBeenCalled();
      Reflect.deleteProperty(input, 'value');
      expect(input.value).toBe('after');
      dom.window.close();
    });

    it('blocks all normal renderer browser operations for verification-owned sessions', async () => {
      const registry = new BrowserWebContentsRegistry();
      registry.registerVerificationSession(lease);
      const webContents = fakeWebContents(lease.partition);
      webContents.currentUrl = 'http://127.0.0.1:4173/';
      registry.handleWebviewAttached(webContents);
      registry.bindWebContents(lease.browserId, webContents);

      registry.setActiveBrowser(lease.browserId);
      expect(registry.getActiveBrowser()).toBeNull();
      expect(registry.openDevTools(lease.browserId)).toBe(false);
      await expect(registry.captureScreenshotToClipboard(lease.browserId)).resolves.toBe(false);
      await expect(registry.clearData(lease.browserId, 'storage')).resolves.toBe(false);
      expect(registry.unregisterSession(lease.browserId)).toBe(false);

      await expect(
        registry.performVerificationAction(lease, { kind: 'accessibility-snapshot' })
      ).resolves.toMatchObject({ result: { ok: true } });
    });

    it('bounds and redacts verification diagnostics without exposing request data', async () => {
      const registry = new BrowserWebContentsRegistry();
      registry.registerVerificationSession(lease);
      const webContents = fakeWebContents(lease.partition);
      webContents.currentUrl = 'http://127.0.0.1:4173/';
      registry.handleWebviewAttached(webContents);
      registry.bindWebContents(lease.browserId, webContents);

      for (let index = 0; index < 60; index += 1) {
        webContents.emitEvent(
          'console-message',
          {},
          3,
          `request failed token=super-secret-${index} ${'x'.repeat(100_000)}`
        );
      }
      const diagnostics = await registry.performVerificationAction(lease, {
        kind: 'diagnostics',
        limit: 20,
      });

      expect(diagnostics.result).toMatchObject({
        ok: true,
        observation: { kind: 'diagnostics', truncated: true },
      });
      if (!diagnostics.result.ok || diagnostics.result.observation.kind !== 'diagnostics') return;
      expect(diagnostics.result.observation.entries).toHaveLength(20);
      for (const entry of diagnostics.result.observation.entries) {
        expect(entry.redacted).toBe(true);
        expect(entry.message).not.toContain('super-secret');
        expect(entry.message.length).toBeLessThanOrEqual(2048);
        expect(Object.keys(entry).sort()).toEqual(['level', 'message', 'redacted', 'source']);
      }
    });

    it('refuses cleanup for forged normal-profile leases', async () => {
      const registry = new BrowserWebContentsRegistry();
      const result = await registry.forceCleanupVerificationSession({
        ...lease,
        partition: PROFILE_PARTITION,
      });

      expect(result).toEqual({
        partitionDataCleared: false,
        cleanupError: 'Invalid browser verification lease',
      });
      expect(sessionsByPartition.has(PROFILE_PARTITION)).toBe(false);
    });

    it('refuses cleanup when another verification lease owns the partition', async () => {
      const registry = new BrowserWebContentsRegistry();
      registry.registerVerificationSession(lease);
      const partitionSession = sessionFor(lease.partition) as {
        clearData: ReturnType<typeof vi.fn>;
      };

      const result = await registry.forceCleanupVerificationSession({
        ...lease,
        verificationRunId: 'forged-run',
        browserId: 'forged-browser',
      });

      expect(result).toEqual({
        partitionDataCleared: false,
        cleanupError: 'Browser verification partition belongs to another lease',
      });
      expect(partitionSession.clearData).not.toHaveBeenCalled();
      expect(
        await registry.performVerificationAction(lease, { kind: 'accessibility-snapshot' })
      ).toMatchObject({ result: { ok: false, error: { kind: 'not-ready' } } });
    });

    it('allows exact orphan partition cleanup for restart recovery', async () => {
      const registry = new BrowserWebContentsRegistry();
      const partitionSession = sessionFor(lease.partition) as {
        clearData: ReturnType<typeof vi.fn>;
      };

      await expect(registry.forceCleanupVerificationSession(lease)).resolves.toEqual({
        partitionDataCleared: true,
      });
      expect(partitionSession.clearData).toHaveBeenCalledOnce();
    });
  });
});
