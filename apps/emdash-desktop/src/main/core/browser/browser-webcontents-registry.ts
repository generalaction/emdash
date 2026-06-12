import {
  clipboard,
  Menu,
  session,
  type BrowserWindow,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import { events } from '@main/lib/events';
import { normalizeBrowserUrl } from '@shared/browser';
import type { AppSettings } from '@shared/core/app-settings';
import { browserLinkCopiedChannel, browserOpenInNewTabChannel } from '@shared/events/browserEvents';
import { APP_SHORTCUTS, resolveDefaultHotkey } from '@shared/shortcuts';

type RegisteredBrowserSession = {
  browserId: string;
  partition: string;
};

export class BrowserWebContentsRegistry {
  private readonly sessionsByBrowserId = new Map<string, RegisteredBrowserSession>();
  private readonly browserIdByPartition = new Map<string, string>();
  private readonly webContentsByBrowserId = new Map<string, WebContents>();
  private activeBrowserId: string | null = null;
  private copyBrowserUrlShortcut = getBrowserCopyUrlShortcut();

  registerSession(input: RegisteredBrowserSession): void {
    this.sessionsByBrowserId.set(input.browserId, input);
    this.browserIdByPartition.set(input.partition, input.browserId);
  }

  unregisterSession(browserId: string): void {
    const registered = this.sessionsByBrowserId.get(browserId);
    if (registered) {
      this.browserIdByPartition.delete(registered.partition);
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
    return new Set(this.browserIdByPartition.keys());
  }

  getBrowserIdForPartition(partition: string): string | undefined {
    return this.browserIdByPartition.get(partition);
  }

  getBrowserIdForWebContents(webContents: WebContents): string | undefined {
    for (const registered of this.sessionsByBrowserId.values()) {
      if (session.fromPartition(registered.partition) === webContents.session) {
        return registered.browserId;
      }
    }
    return undefined;
  }

  attachWebContents(browserId: string, webContents: WebContents, ownerWindow: BrowserWindow): void {
    if (!this.sessionsByBrowserId.has(browserId)) return;

    this.webContentsByBrowserId.set(browserId, webContents);
    this.activeBrowserId = browserId;

    webContents.setWindowOpenHandler(({ url }) => {
      if (isExternalHttpUrl(url)) {
        events.emit(browserOpenInNewTabChannel, { sourceBrowserId: browserId, url });
      }
      return { action: 'deny' };
    });

    webContents.on('before-input-event', (event, input) => {
      if (!isCopyBrowserUrlShortcut(input, this.copyBrowserUrlShortcut)) return;

      const url = webContents.getURL();
      if (!url) return;
      event.preventDefault();
      clipboard.writeText(url);
      events.emit(browserLinkCopiedChannel, { kind: 'url', url });
    });

    webContents.on('will-navigate', (event, url) => {
      if (!isSupportedBrowserNavigationUrl(url)) {
        event.preventDefault();
      }
    });

    webContents.on('context-menu', (event, params) => {
      event.preventDefault();
      clearWebviewSelection(webContents);

      const target = getBrowserContextTarget(params);
      const template: MenuItemConstructorOptions[] = [
        {
          label: target?.kind === 'image' ? 'Copy Image URL' : 'Copy Link',
          enabled: target !== null,
          click: () => {
            if (!target) return;
            clipboard.writeText(target.url);
            events.emit(browserLinkCopiedChannel, { kind: 'link', url: target.url });
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
            if (target) {
              events.emit(browserOpenInNewTabChannel, {
                sourceBrowserId: browserId,
                url: target.url,
              });
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Reload',
          click: () => webContents.reload(),
        },
      ];

      Menu.buildFromTemplate(template).popup({
        window: ownerWindow,
        x: params.x,
        y: params.y,
      });
    });

    webContents.once('destroyed', () => {
      if (this.webContentsByBrowserId.get(browserId)?.id === webContents.id) {
        this.webContentsByBrowserId.delete(browserId);
      }
      if (this.activeBrowserId === browserId) {
        this.activeBrowserId = null;
      }
    });
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

  async clearStorage(browserId: string): Promise<boolean> {
    const registered = this.sessionsByBrowserId.get(browserId);
    if (!registered) return false;
    await session.fromPartition(registered.partition).clearStorageData();
    return true;
  }
}

export const browserWebContentsRegistry = new BrowserWebContentsRegistry();

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
  return configured ?? resolveDefaultHotkey(APP_SHORTCUTS.browserCopyUrl) ?? null;
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

  const modifiers = {
    shift: false,
    alt: false,
    meta: false,
    control: false,
  };

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
        if (process.platform === 'darwin') {
          modifiers.meta = true;
        } else {
          modifiers.control = true;
        }
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
