import {
  clipboard,
  Menu,
  session,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import {
  browserProfilePartition,
  isNamedBrowserProfileId,
  normalizeBrowserUrl,
  type BrowserDataClearKind,
} from '@shared/browser';
import type { AppSettings } from '@shared/core/app-settings';
import { tabNavigationShortcutChannel } from '@shared/events/appEvents';
import { browserLinkCopiedChannel, browserOpenInNewTabChannel } from '@shared/events/browserEvents';
import {
  APP_SHORTCUTS,
  getElectronTabNavigationDirection,
  resolveDefaultHotkey,
} from '@shared/shortcuts';
import { isGoogleAuthUrl, userAgentForBrowserUrl } from './browser-user-agent';

type RegisteredBrowserSession = {
  browserId: string;
  partition: string;
};

// OAuth popups become real child windows sharing the browser partition; they
// must stay as locked down as the webview that opened them.
const BROWSER_POPUP_WINDOW_OPTIONS: BrowserWindowConstructorOptions = {
  autoHideMenuBar: true,
  webPreferences: {
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    sandbox: true,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
  },
};

export class BrowserWebContentsRegistry {
  private readonly sessionsByBrowserId = new Map<string, RegisteredBrowserSession>();
  private readonly webContentsByBrowserId = new Map<string, WebContents>();
  private readonly browserIdByWebContentsId = new Map<number, string>();
  private readonly pendingWebContentsIds = new Set<number>();
  private activeBrowserId: string | null = null;
  private copyBrowserUrlShortcut = getBrowserCopyUrlShortcut();

  registerSession(input: RegisteredBrowserSession): void {
    this.sessionsByBrowserId.set(input.browserId, input);
  }

  unregisterSession(browserId: string): void {
    const webContents = this.webContentsByBrowserId.get(browserId);
    if (webContents) {
      this.browserIdByWebContentsId.delete(webContents.id);
    }
    this.sessionsByBrowserId.delete(browserId);
    this.webContentsByBrowserId.delete(browserId);
    if (this.activeBrowserId === browserId) {
      this.activeBrowserId = null;
    }
  }

  setKeyboardSettings(keyboard: AppSettings['keyboard']): void {
    this.copyBrowserUrlShortcut = getBrowserCopyUrlShortcut(keyboard);
  }

  get registeredPartitions(): ReadonlySet<string> {
    const partitions = new Set<string>();
    for (const registered of this.sessionsByBrowserId.values()) {
      partitions.add(registered.partition);
    }
    return partitions;
  }

  /**
   * Hardens a webview's webContents as soon as it attaches to the main window
   * and closes it unless its session belongs to a registered browser partition.
   * Multiple browsers share one persistent profile partition, so the attached
   * webContents cannot be matched to a browserId here; the renderer binds it
   * via bindWebContents once the webview reports its webContents id.
   */
  handleWebviewAttached(webContents: WebContents): boolean {
    if (!this.isRegisteredPartitionSession(webContents)) {
      webContents.close();
      return false;
    }

    const webContentsId = webContents.id;
    this.pendingWebContentsIds.add(webContentsId);
    this.hardenBrowserWebContents(webContents);

    webContents.once('destroyed', () => {
      this.pendingWebContentsIds.delete(webContentsId);
      const boundBrowserId = this.browserIdByWebContentsId.get(webContentsId);
      if (boundBrowserId === undefined) return;
      this.browserIdByWebContentsId.delete(webContentsId);
      if (this.webContentsByBrowserId.get(boundBrowserId) === webContents) {
        this.webContentsByBrowserId.delete(boundBrowserId);
      }
      if (this.activeBrowserId === boundBrowserId) {
        this.activeBrowserId = null;
      }
    });

    return true;
  }

  bindWebContents(browserId: string, webContents: WebContents): boolean {
    const registered = this.sessionsByBrowserId.get(browserId);
    if (!registered) return false;
    if (webContents.session !== session.fromPartition(registered.partition)) return false;
    const alreadyBoundTo = this.browserIdByWebContentsId.get(webContents.id);
    if (alreadyBoundTo === browserId) return true;
    if (alreadyBoundTo !== undefined || !this.pendingWebContentsIds.has(webContents.id)) {
      return false;
    }

    this.pendingWebContentsIds.delete(webContents.id);
    const previous = this.webContentsByBrowserId.get(browserId);
    if (previous && previous.id !== webContents.id) {
      this.browserIdByWebContentsId.delete(previous.id);
    }
    this.webContentsByBrowserId.set(browserId, webContents);
    this.browserIdByWebContentsId.set(webContents.id, browserId);
    this.activeBrowserId = browserId;
    return true;
  }

  setActiveBrowser(browserId: string | null): void {
    if (browserId !== null && !this.sessionsByBrowserId.has(browserId)) return;
    this.activeBrowserId = browserId;
  }

  getActiveBrowser(): string | null {
    return this.activeBrowserId;
  }

  openDevTools(browserId: string): boolean {
    const webContents = this.webContentsByBrowserId.get(browserId);
    if (!webContents || webContents.isDestroyed()) return false;
    webContents.openDevTools({ mode: 'detach' });
    return true;
  }

  async captureScreenshotToClipboard(browserId: string): Promise<boolean> {
    const webContents = this.webContentsByBrowserId.get(browserId);
    if (!webContents || webContents.isDestroyed()) return false;
    try {
      const image = await webContents.capturePage();
      if (image.isEmpty()) return false;
      clipboard.writeImage(image);
      return true;
    } catch {
      return false;
    }
  }

  async clearData(browserId: string, kind: BrowserDataClearKind = 'storage'): Promise<boolean> {
    const registered = this.sessionsByBrowserId.get(browserId);
    if (!registered) return false;
    const partitionSession = session.fromPartition(registered.partition);
    switch (kind) {
      case 'storage':
        await partitionSession.clearStorageData();
        break;
      case 'cookies':
        await partitionSession.clearStorageData({ storages: ['cookies'] });
        break;
      case 'cache':
        await partitionSession.clearCache();
        break;
    }
    return true;
  }

  async clearProfileStorage(profileId: string): Promise<boolean> {
    if (!isNamedBrowserProfileId(profileId)) return false;
    await session.fromPartition(browserProfilePartition(profileId)).clearData();
    return true;
  }

  private isRegisteredPartitionSession(webContents: WebContents): boolean {
    for (const partition of this.registeredPartitions) {
      if (session.fromPartition(partition) === webContents.session) {
        return true;
      }
    }
    return false;
  }

  private hardenBrowserWebContents(webContents: WebContents): void {
    webContents.setWindowOpenHandler((details) => {
      if (!isSupportedBrowserNavigationUrl(details.url)) {
        return { action: 'deny' };
      }
      if (details.disposition === 'new-window' && isAllowedAuthPopupUrl(details.url)) {
        // window.open popups (OAuth sign-in flows) need a real child window in
        // the same partition so window.opener/postMessage keep working.
        return { action: 'allow', overrideBrowserWindowOptions: BROWSER_POPUP_WINDOW_OPTIONS };
      }
      const sourceBrowserId = this.browserIdByWebContentsId.get(webContents.id);
      if (sourceBrowserId && isExternalHttpUrl(details.url)) {
        events.emit(browserOpenInNewTabChannel, { sourceBrowserId, url: details.url });
      }
      return { action: 'deny' };
    });

    webContents.on('before-input-event', (event, input) => {
      const tabNavigationDirection = getElectronTabNavigationDirection(input);
      if (tabNavigationDirection) {
        const browserId = this.browserIdByWebContentsId.get(webContents.id);
        if (browserId) {
          event.preventDefault();
          events.emit(tabNavigationShortcutChannel, {
            source: { kind: 'browser', browserId },
            direction: tabNavigationDirection,
          });
          return;
        }
      }

      if (!isCopyBrowserUrlShortcut(input, this.copyBrowserUrlShortcut)) return;

      const normalized = normalizeBrowserUrl(webContents.getURL(), { allowSearchQueries: false });
      if (!normalized.ok || !isExternalHttpUrl(normalized.url)) return;
      event.preventDefault();
      clipboard.writeText(normalized.url);
      events.emit(browserLinkCopiedChannel, { kind: 'url', url: normalized.url });
    });

    webContents.on('context-menu', (event, params) => {
      event.preventDefault();
      const selectionText = (params.selectionText ?? '').trim();
      if (!selectionText) {
        clearWebviewSelection(webContents);
      }

      const target = getBrowserContextTarget(params);
      const template: MenuItemConstructorOptions[] = [
        ...(selectionText
          ? [
              {
                label: 'Copy',
                click: () => clipboard.writeText(selectionText),
              },
              { type: 'separator' as const },
            ]
          : []),
        {
          label: target?.kind === 'image' ? 'Copy Image URL' : 'Copy Link',
          enabled: target !== null,
          click: () => {
            if (!target) return;
            clipboard.writeText(target.url);
            events.emit(browserLinkCopiedChannel, { kind: target.kind, url: target.url });
          },
        },
        {
          label: target?.kind === 'image' ? 'Open Image' : 'Open Link',
          enabled: target !== null,
          click: () => {
            if (target) void webContents.loadURL(target.url);
          },
        },
        {
          label: target?.kind === 'image' ? 'Open Image in New Tab' : 'Open Link in New Tab',
          enabled: target !== null,
          click: () => {
            const sourceBrowserId = this.browserIdByWebContentsId.get(webContents.id);
            if (sourceBrowserId && target) {
              events.emit(browserOpenInNewTabChannel, { sourceBrowserId, url: target.url });
            }
          },
        },
        { type: 'separator' },
        { label: 'Reload', click: () => webContents.reload() },
      ];

      Menu.buildFromTemplate(template).popup({ x: params.x, y: params.y });
    });

    webContents.on('did-create-window', (window) => {
      hardenBrowserPopupWindow(window);
    });

    webContents.on('will-navigate', (event, url) => {
      if (!isSupportedBrowserNavigationUrl(url)) {
        event.preventDefault();
      }
    });

    installBrowserUserAgentSwitch(webContents);
  }
}

export const browserWebContentsRegistry = new BrowserWebContentsRegistry();

function hardenBrowserPopupWindow(window: BrowserWindow): void {
  const webContents = window.webContents;

  webContents.setWindowOpenHandler(({ url, disposition }) => {
    if (!isSupportedBrowserNavigationUrl(url)) {
      return { action: 'deny' };
    }
    if (disposition === 'new-window' && isAllowedAuthPopupUrl(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: BROWSER_POPUP_WINDOW_OPTIONS };
    }
    return { action: 'deny' };
  });

  webContents.on('did-create-window', (child) => {
    hardenBrowserPopupWindow(child);
  });

  webContents.on('will-navigate', (event, url) => {
    if (!isSupportedBrowserNavigationUrl(url)) {
      event.preventDefault();
    }
  });

  installBrowserUserAgentSwitch(webContents);
}

function installBrowserUserAgentSwitch(webContents: WebContents): void {
  // Google auth pages also probe navigator.userAgent, so the per-contents user
  // agent has to switch around auth navigations, not just the request header.
  webContents.on('did-start-navigation', (_event, url, _isInPlace, isMainFrame) => {
    if (!isMainFrame) return;
    const target = userAgentForBrowserUrl(url, webContents.session.getUserAgent());
    if (webContents.getUserAgent() !== target) {
      webContents.setUserAgent(target);
    }
  });
}

function isSupportedBrowserNavigationUrl(url: string): boolean {
  return normalizeBrowserUrl(url, { allowSearchQueries: false }).ok;
}

function isExternalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isAllowedAuthPopupUrl(url: string): boolean {
  if (isGoogleAuthUrl(url)) return true;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== 'github.com') return false;
    return parsed.pathname === '/login' || parsed.pathname === '/login/oauth/authorize';
  } catch {
    return false;
  }
}

function getBrowserContextTarget(
  params: Electron.ContextMenuParams
): { kind: 'link' | 'image'; url: string } | null {
  if (params.mediaType === 'image' && isExternalHttpUrl(params.srcURL)) {
    return { kind: 'image', url: params.srcURL };
  }
  if (isExternalHttpUrl(params.linkURL)) return { kind: 'link', url: params.linkURL };
  return null;
}

function getBrowserCopyUrlShortcut(keyboard?: AppSettings['keyboard']): string | null {
  const configured = keyboard?.browserCopyUrl;
  if (configured === null) return null;
  const fallback = resolveDefaultHotkey(APP_SHORTCUTS.browserCopyUrl) ?? null;
  if (configured && !parseShortcut(configured)) {
    log.warn('Invalid browser copy URL shortcut, falling back to default', {
      shortcut: configured,
    });
    return fallback;
  }
  return configured ?? fallback;
}

function isCopyBrowserUrlShortcut(input: Electron.Input, shortcut: string | null): boolean {
  if (shortcut === null) return false;
  const parsed = parseShortcut(shortcut);
  if (!parsed) return false;
  return (
    input.type === 'keyDown' &&
    normalizeInputKey(input.key) === parsed.key &&
    Boolean(input.shift) === parsed.shift &&
    Boolean(input.alt) === parsed.alt &&
    Boolean(input.meta) === parsed.meta &&
    Boolean(input.control) === parsed.control
  );
}

function parseShortcut(shortcut: string): {
  key: string;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  control: boolean;
} | null {
  const parts = shortcut
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  const modifiers = { shift: false, alt: false, meta: false, control: false };
  for (const part of parts) {
    switch (part.toLowerCase()) {
      case 'shift':
        modifiers.shift = true;
        break;
      case 'alt':
      case 'option':
        modifiers.alt = true;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
        modifiers.meta = true;
        break;
      case 'ctrl':
      case 'control':
        modifiers.control = true;
        break;
      case 'mod':
        if (process.platform === 'darwin') modifiers.meta = true;
        else modifiers.control = true;
        break;
      default:
        return null;
    }
  }
  return { key: normalizeInputKey(key), ...modifiers };
}

function normalizeInputKey(key: string): string {
  return key.toLowerCase();
}

function clearWebviewSelection(webContents: WebContents): void {
  if (webContents.isDestroyed()) return;
  void webContents
    .executeJavaScript('window.getSelection()?.removeAllRanges();', true)
    .catch(() => {});
}
