import { clipboard, session, type WebContents } from 'electron';
import { events } from '@main/lib/events';
import { normalizeBrowserUrl } from '@shared/browser';
import { browserOpenInNewTabChannel } from '@shared/events/browserEvents';

type RegisteredBrowserSession = {
  browserId: string;
  partition: string;
};

export class BrowserWebContentsRegistry {
  private readonly sessionsByBrowserId = new Map<string, RegisteredBrowserSession>();
  private readonly browserIdByPartition = new Map<string, string>();
  private readonly webContentsByBrowserId = new Map<string, WebContents>();
  private activeBrowserId: string | null = null;

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

  attachWebContents(browserId: string, webContents: WebContents): void {
    if (!this.sessionsByBrowserId.has(browserId)) return;

    this.webContentsByBrowserId.set(browserId, webContents);
    this.activeBrowserId = browserId;

    webContents.setWindowOpenHandler(({ url }) => {
      if (isExternalHttpUrl(url)) {
        events.emit(browserOpenInNewTabChannel, { sourceBrowserId: browserId, url });
      }
      return { action: 'deny' };
    });

    webContents.on('will-navigate', (event, url) => {
      if (!isSupportedBrowserNavigationUrl(url)) {
        event.preventDefault();
      }
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
