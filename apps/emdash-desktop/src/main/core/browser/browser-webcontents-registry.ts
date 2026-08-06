import { randomUUID } from 'node:crypto';
import { redactAll } from '@emdash/shared/logger';
import {
  clipboard,
  Menu,
  session,
  type BrowserWindow,
  type BrowserWindowConstructorOptions,
  type ClearDataOptions,
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
  type BrowsingDataKind,
} from '@shared/browser';
import type { AppSettings } from '@shared/core/app-settings';
import {
  LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX,
  loopBrowserActionSchema,
  loopBrowserLeaseSchema,
  type LoopBrowserAction,
  type LoopBrowserActionResult,
  type LoopBrowserLease,
} from '@shared/core/loops/loop-browser-contracts';
import { browserAppShortcutChannel, tabNavigationShortcutChannel } from '@shared/events/appEvents';
import { browserLinkCopiedChannel, browserOpenInNewTabChannel } from '@shared/events/browserEvents';
import {
  APP_SHORTCUTS,
  getElectronTabNavigationDirection,
  resolveDefaultHotkey,
  type ShortcutSettingsKey,
} from '@shared/shortcuts';
import { releaseBrowserVerificationSession } from './browser-profile-session';
import { isGoogleAuthUrl, userAgentForBrowserUrl } from './browser-user-agent';

type RegisteredBrowserSession = {
  browserId: string;
  partition: string;
  owner:
    | { kind: 'user' }
    | {
        kind: 'loop-verification';
        lease: LoopBrowserLease;
        revoked: boolean;
        diagnostics: VerificationDiagnostic[];
      };
};

type VerificationDiagnostic = {
  level: 'info' | 'warning' | 'error';
  source: 'console' | 'navigation' | 'network';
  message: string;
  redacted: true;
};

export type VerificationScreenshot = {
  artifactId: string;
  mimeType: 'image/png';
  data: Buffer;
};

export type VerificationActionExecution = {
  result: LoopBrowserActionResult;
  screenshot?: VerificationScreenshot;
};

export type VerificationCleanupResult = {
  partitionDataCleared: boolean;
  cleanupError?: string;
};

export const VERIFICATION_SCREENSHOT_TIMEOUT_MS = 15_000;

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

// Electron's type union lags Chromium's supported `clearData` values.
const SITE_DATA_CLEAR_DATA_TYPES = [
  'backgroundFetch',
  'cacheStorage',
  'fileSystems',
  'indexedDB',
  'localStorage',
  'serviceWorkers',
  'webSQL',
] as unknown as NonNullable<ClearDataOptions['dataTypes']>;

export class BrowserWebContentsRegistry {
  private readonly sessionsByBrowserId = new Map<string, RegisteredBrowserSession>();
  private readonly webContentsByBrowserId = new Map<string, WebContents>();
  private readonly browserIdByWebContentsId = new Map<number, string>();
  private readonly pendingWebContentsById = new Map<number, WebContents>();
  private activeBrowserId: string | null = null;
  private browserShortcuts = getBrowserShortcuts();

  registerSession(input: { browserId: string; partition: string }): boolean {
    if (input.partition.startsWith(LOOP_BROWSER_DISPOSABLE_PARTITION_PREFIX)) return false;
    const existing = this.sessionsByBrowserId.get(input.browserId);
    if (existing) {
      if (existing.owner.kind !== 'user') return false;
      if (existing.partition === input.partition) return true;
      const webContents = this.webContentsByBrowserId.get(input.browserId);
      if (webContents) this.browserIdByWebContentsId.delete(webContents.id);
      this.webContentsByBrowserId.delete(input.browserId);
      if (this.activeBrowserId === input.browserId) this.activeBrowserId = null;
      this.sessionsByBrowserId.set(input.browserId, { ...input, owner: { kind: 'user' } });
      return true;
    }
    this.sessionsByBrowserId.set(input.browserId, { ...input, owner: { kind: 'user' } });
    return true;
  }

  registerVerificationSession(lease: LoopBrowserLease): boolean {
    const parsed = loopBrowserLeaseSchema.safeParse(lease);
    if (!parsed.success) return false;

    const existing = this.sessionsByBrowserId.get(parsed.data.browserId);
    if (existing) return isExactVerificationSession(existing, parsed.data);
    for (const session of this.sessionsByBrowserId.values()) {
      if (session.partition === parsed.data.partition) return false;
    }

    this.sessionsByBrowserId.set(parsed.data.browserId, {
      browserId: parsed.data.browserId,
      partition: parsed.data.partition,
      owner: {
        kind: 'loop-verification',
        lease: parsed.data,
        revoked: false,
        diagnostics: [],
      },
    });
    return true;
  }

  unregisterSession(browserId: string): boolean {
    const registered = this.sessionsByBrowserId.get(browserId);
    if (!registered || registered.owner.kind === 'loop-verification') return false;
    this.removeSession(browserId);
    return true;
  }

  private removeSession(browserId: string): void {
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
    this.browserShortcuts = getBrowserShortcuts(keyboard);
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
    const registered = this.registeredSessionForWebContents(webContents);
    if (!registered) {
      webContents.close();
      return false;
    }
    if (registered.owner.kind === 'loop-verification' && registered.owner.revoked) {
      webContents.close();
      return false;
    }

    const webContentsId = webContents.id;
    this.pendingWebContentsById.set(webContentsId, webContents);
    if (registered.owner.kind === 'loop-verification') {
      this.hardenVerificationWebContents(webContents, registered.owner);
    } else {
      this.hardenBrowserWebContents(webContents);
    }

    webContents.once('destroyed', () => {
      this.pendingWebContentsById.delete(webContentsId);
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
    if (registered.owner.kind === 'loop-verification' && registered.owner.revoked) return false;
    if (webContents.session !== session.fromPartition(registered.partition)) return false;
    if (
      registered.owner.kind === 'loop-verification' &&
      !urlMatchesOrigin(webContents.getURL(), registered.owner.lease.allowedPreviewOrigin)
    ) {
      return false;
    }
    const alreadyBoundTo = this.browserIdByWebContentsId.get(webContents.id);
    if (alreadyBoundTo === browserId) return true;
    if (alreadyBoundTo !== undefined || !this.pendingWebContentsById.has(webContents.id)) {
      return false;
    }

    this.pendingWebContentsById.delete(webContents.id);
    const previous = this.webContentsByBrowserId.get(browserId);
    if (previous && previous.id !== webContents.id) {
      if (registered.owner.kind === 'loop-verification' && !previous.isDestroyed()) return false;
      this.browserIdByWebContentsId.delete(previous.id);
    }
    this.webContentsByBrowserId.set(browserId, webContents);
    this.browserIdByWebContentsId.set(webContents.id, browserId);
    if (registered.owner.kind === 'user') this.activeBrowserId = browserId;
    return true;
  }

  setActiveBrowser(browserId: string | null): void {
    if (browserId !== null) {
      const registered = this.sessionsByBrowserId.get(browserId);
      if (!registered || registered.owner.kind === 'loop-verification') return;
    }
    this.activeBrowserId = browserId;
  }

  getActiveBrowser(): string | null {
    return this.activeBrowserId;
  }

  openDevTools(browserId: string): boolean {
    if (this.sessionsByBrowserId.get(browserId)?.owner.kind !== 'user') return false;
    const webContents = this.webContentsByBrowserId.get(browserId);
    if (!webContents || webContents.isDestroyed()) return false;
    webContents.openDevTools({ mode: 'detach' });
    return true;
  }

  async captureScreenshotToClipboard(browserId: string): Promise<boolean> {
    if (this.sessionsByBrowserId.get(browserId)?.owner.kind !== 'user') return false;
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

  revokeVerificationSession(lease: LoopBrowserLease): boolean {
    const registered = this.sessionsByBrowserId.get(lease.browserId);
    if (!registered || !isExactVerificationSession(registered, lease)) return false;
    registered.owner.revoked = true;
    const partitionSession = session.fromPartition(lease.partition);
    for (const [webContentsId, pending] of this.pendingWebContentsById) {
      if (pending.session !== partitionSession) continue;
      this.pendingWebContentsById.delete(webContentsId);
      if (!pending.isDestroyed()) pending.close();
    }
    const webContents = this.webContentsByBrowserId.get(lease.browserId);
    if (webContents && !webContents.isDestroyed()) webContents.close();
    if (webContents) this.browserIdByWebContentsId.delete(webContents.id);
    this.webContentsByBrowserId.delete(lease.browserId);
    if (this.activeBrowserId === lease.browserId) this.activeBrowserId = null;
    return true;
  }

  isVerificationSessionReady(lease: LoopBrowserLease, currentUrl: string): boolean {
    const parsed = loopBrowserLeaseSchema.safeParse(lease);
    if (!parsed.success) return false;
    const registered = this.sessionsByBrowserId.get(parsed.data.browserId);
    if (
      !registered ||
      !isExactVerificationSession(registered, parsed.data) ||
      registered.owner.revoked
    ) {
      return false;
    }
    const webContents = this.webContentsByBrowserId.get(parsed.data.browserId);
    return (
      webContents !== undefined &&
      !webContents.isDestroyed() &&
      webContents.getURL() === currentUrl &&
      urlMatchesOrigin(currentUrl, parsed.data.allowedPreviewOrigin)
    );
  }

  async performVerificationAction(
    lease: LoopBrowserLease,
    action: LoopBrowserAction
  ): Promise<VerificationActionExecution> {
    const registered = this.sessionsByBrowserId.get(lease.browserId);
    if (!registered) return actionFailure('lease-closed', 'Browser verification lease is closed');
    if (!isExactVerificationSession(registered, lease)) {
      return actionFailure(
        'identity-mismatch',
        'Browser verification lease identity does not match'
      );
    }
    if (registered.owner.revoked) {
      return actionFailure('lease-closed', 'Browser verification lease is closed');
    }
    const parsedAction = loopBrowserActionSchema.safeParse(action);
    if (!parsedAction.success) {
      return actionFailure('invalid-action', 'Browser action is not in the audited allowlist');
    }
    const webContents = this.webContentsByBrowserId.get(lease.browserId);
    if (!webContents || webContents.isDestroyed()) {
      return actionFailure('not-ready', 'Browser verification webview is not ready');
    }
    if (!urlMatchesOrigin(webContents.getURL(), lease.allowedPreviewOrigin)) {
      return actionFailure('origin-rejected', 'Browser left the allowed preview origin');
    }

    try {
      return await this.runVerificationAction(
        webContents,
        registered.owner.diagnostics,
        lease,
        parsedAction.data
      );
    } catch {
      return actionFailure('action-failed', 'Browser action failed');
    }
  }

  async forceCleanupVerificationSession(
    lease: LoopBrowserLease
  ): Promise<VerificationCleanupResult> {
    const parsed = loopBrowserLeaseSchema.safeParse(lease);
    if (!parsed.success) {
      return {
        partitionDataCleared: false,
        cleanupError: 'Invalid browser verification lease',
      };
    }

    const registered = this.sessionsByBrowserId.get(parsed.data.browserId);
    const partitionOwner = [...this.sessionsByBrowserId.values()].find(
      (candidate) => candidate.partition === parsed.data.partition
    );
    if (
      (registered && !isExactVerificationSession(registered, parsed.data)) ||
      (partitionOwner && !isExactVerificationSession(partitionOwner, parsed.data))
    ) {
      return {
        partitionDataCleared: false,
        cleanupError: 'Browser verification partition belongs to another lease',
      };
    }
    const ownsVerificationSession =
      (registered !== undefined && isExactVerificationSession(registered, parsed.data)) ||
      (partitionOwner !== undefined && isExactVerificationSession(partitionOwner, parsed.data));
    if (ownsVerificationSession) {
      this.revokeVerificationSession(parsed.data);
      this.removeSession(parsed.data.browserId);
    }

    try {
      await session.fromPartition(parsed.data.partition).clearData();
      return { partitionDataCleared: true };
    } catch {
      return {
        partitionDataCleared: false,
        cleanupError: 'Browser partition cleanup failed',
      };
    } finally {
      releaseBrowserVerificationSession(parsed.data.partition, parsed.data.allowedPreviewOrigin);
    }
  }

  async clearData(browserId: string, kind: BrowserDataClearKind = 'storage'): Promise<boolean> {
    const registered = this.sessionsByBrowserId.get(browserId);
    if (!registered || registered.owner.kind !== 'user') return false;
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

  /**
   * Clears a category of browsing data across the given partitions. Used by the
   * global "Browsing data" settings controls, which target every browser
   * profile rather than a single open tab.
   */
  async clearBrowsingData(kind: BrowsingDataKind, partitions: readonly string[]): Promise<boolean> {
    await Promise.all(partitions.map((partition) => clearPartitionBrowsingData(partition, kind)));
    return true;
  }

  private registeredSessionForWebContents(
    webContents: WebContents
  ): RegisteredBrowserSession | undefined {
    for (const registered of this.sessionsByBrowserId.values()) {
      if (session.fromPartition(registered.partition) === webContents.session) return registered;
    }
    return undefined;
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

      const shortcutKey = getBrowserShortcutKey(input, this.browserShortcuts);
      if (shortcutKey === null) return;

      if (shortcutKey !== 'browserCopyUrl') {
        const browserId = this.browserIdByWebContentsId.get(webContents.id);
        if (!browserId) return;
        event.preventDefault();
        events.emit(browserAppShortcutChannel, {
          source: { kind: 'browser', browserId },
          shortcutKey,
        });
        return;
      }

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

  private hardenVerificationWebContents(
    webContents: WebContents,
    owner: Extract<RegisteredBrowserSession['owner'], { kind: 'loop-verification' }>
  ): void {
    const { lease, diagnostics } = owner;
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    webContents.on('did-create-window', (window) => window.close());
    webContents.on('context-menu', (event) => event.preventDefault());

    const enforceOrigin = (event: Electron.Event, url: string) => {
      if (urlMatchesOrigin(url, lease.allowedPreviewOrigin)) return;
      event.preventDefault();
      appendVerificationDiagnostic(diagnostics, {
        level: 'warning',
        source: 'navigation',
        message: 'Blocked navigation outside the allowed preview origin',
      });
    };
    webContents.on('will-navigate', enforceOrigin);
    webContents.on('will-redirect', enforceOrigin);
    webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      if (errorCode === -3) return;
      appendVerificationDiagnostic(diagnostics, {
        level: 'error',
        source: 'navigation',
        message: errorDescription,
      });
    });
    webContents.on('console-message', (_event, level, message) => {
      appendVerificationDiagnostic(diagnostics, {
        level: level >= 3 ? 'error' : level === 2 ? 'warning' : 'info',
        source: 'console',
        message,
      });
    });
    installBrowserUserAgentSwitch(webContents);
  }

  private async runVerificationAction(
    webContents: WebContents,
    diagnostics: VerificationDiagnostic[],
    lease: LoopBrowserLease,
    action: LoopBrowserAction
  ): Promise<VerificationActionExecution> {
    switch (action.kind) {
      case 'navigate': {
        if (!urlMatchesOrigin(action.url, lease.allowedPreviewOrigin)) {
          return actionFailure(
            'origin-rejected',
            'Navigation is outside the allowed preview origin'
          );
        }
        await webContents.loadURL(action.url);
        if (!urlMatchesOrigin(webContents.getURL(), lease.allowedPreviewOrigin)) {
          return actionFailure('origin-rejected', 'Navigation left the allowed preview origin');
        }
        return {
          result: {
            ok: true,
            observation: {
              kind: 'navigation',
              currentUrl: observedUrl(webContents.getURL(), lease.allowedPreviewOrigin),
              title: redactBoundedString(webContents.getTitle(), 512) || undefined,
            },
          },
        };
      }
      case 'accessibility-snapshot': {
        const raw = await webContents.executeJavaScript(ACCESSIBILITY_SNAPSHOT_SCRIPT, true);
        const snapshot = accessibilitySnapshotResult(raw);
        return {
          result: { ok: true, observation: { kind: 'accessibility-snapshot', ...snapshot } },
        };
      }
      case 'accessibility-query': {
        const raw = await webContents.executeJavaScript(
          targetScript(ACCESSIBILITY_QUERY_FUNCTION, {
            target: action.target,
            limit: action.limit,
          }),
          true
        );
        return {
          result: {
            ok: true,
            observation: { kind: 'accessibility-query', ...accessibilityQueryResult(raw) },
          },
        };
      }
      case 'click':
      case 'fill': {
        const raw = await webContents.executeJavaScript(
          targetScript(INTERACTION_FUNCTION, {
            kind: action.kind,
            target: action.target,
            value: action.kind === 'fill' ? action.value : undefined,
          }),
          true
        );
        if (!isFoundResult(raw)) {
          return actionFailure('target-not-found', 'Accessibility target was not found');
        }
        const currentUrl = webContents.getURL();
        if (!urlMatchesOrigin(currentUrl, lease.allowedPreviewOrigin)) {
          return actionFailure('origin-rejected', 'Interaction left the allowed preview origin');
        }
        return {
          result: {
            ok: true,
            observation: {
              kind: 'interaction',
              currentUrl: observedUrl(currentUrl, lease.allowedPreviewOrigin),
            },
          },
        };
      }
      case 'keypress': {
        const input = keyInput(action.key);
        webContents.sendInputEvent({ type: 'keyDown', keyCode: input });
        if (input.length === 1) webContents.sendInputEvent({ type: 'char', keyCode: input });
        webContents.sendInputEvent({ type: 'keyUp', keyCode: input });
        const currentUrl = webContents.getURL();
        if (!urlMatchesOrigin(currentUrl, lease.allowedPreviewOrigin)) {
          return actionFailure('origin-rejected', 'Keypress left the allowed preview origin');
        }
        return {
          result: {
            ok: true,
            observation: {
              kind: 'interaction',
              currentUrl: observedUrl(currentUrl, lease.allowedPreviewOrigin),
            },
          },
        };
      }
      case 'screenshot': {
        const timeoutMarker = Symbol('verification-screenshot-timeout');
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const image = await Promise.race([
          webContents.capturePage(),
          new Promise<typeof timeoutMarker>((resolvePromise) => {
            timeout = setTimeout(
              () => resolvePromise(timeoutMarker),
              VERIFICATION_SCREENSHOT_TIMEOUT_MS
            );
          }),
        ]).finally(() => {
          if (timeout !== undefined) clearTimeout(timeout);
        });
        if (image === timeoutMarker) {
          return actionFailure('artifact-failed', 'Browser screenshot capture timed out');
        }
        if (image.isEmpty())
          return actionFailure('artifact-failed', 'Browser screenshot was empty');
        const data = image.toPNG();
        if (data.byteLength > 100 * 1024 * 1024) {
          return actionFailure('artifact-failed', 'Browser screenshot exceeded the artifact limit');
        }
        const screenshot: VerificationScreenshot = {
          artifactId: randomUUID(),
          mimeType: 'image/png',
          data,
        };
        return {
          result: {
            ok: true,
            observation: {
              kind: 'screenshot',
              artifact: {
                artifactId: screenshot.artifactId,
                mimeType: screenshot.mimeType,
                byteLength: screenshot.data.byteLength,
              },
            },
          },
          screenshot,
        };
      }
      case 'diagnostics': {
        const entries = diagnostics.slice(-action.limit);
        return {
          result: {
            ok: true,
            observation: {
              kind: 'diagnostics',
              entries,
              truncated: diagnostics.length > entries.length,
            },
          },
        };
      }
    }
  }
}

export const browserWebContentsRegistry = new BrowserWebContentsRegistry();

function isExactVerificationSession(
  registered: RegisteredBrowserSession,
  lease: LoopBrowserLease
): registered is RegisteredBrowserSession & {
  owner: Extract<RegisteredBrowserSession['owner'], { kind: 'loop-verification' }>;
} {
  if (registered.owner.kind !== 'loop-verification') return false;
  const expected = registered.owner.lease;
  return (
    expected.verificationRunId === lease.verificationRunId &&
    expected.browserId === lease.browserId &&
    expected.projectId === lease.projectId &&
    expected.taskId === lease.taskId &&
    expected.workspaceId === lease.workspaceId &&
    expected.partition === lease.partition &&
    expected.allowedPreviewOrigin === lease.allowedPreviewOrigin
  );
}

function urlMatchesOrigin(url: string, allowedOrigin: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      parsed.origin === allowedOrigin
    );
  } catch {
    return false;
  }
}

function observedUrl(value: string, allowedOrigin: string): string {
  try {
    const url = new URL(value);
    if (url.username.length > 0 || url.password.length > 0 || url.origin !== allowedOrigin) {
      return allowedOrigin;
    }
    url.search = '';
    url.hash = '';
    return boundedString(url.toString(), 2048);
  } catch {
    return allowedOrigin;
  }
}

function actionFailure(
  kind: Extract<LoopBrowserActionResult, { ok: false }>['error']['kind'],
  message: string
): VerificationActionExecution {
  return { result: { ok: false, error: { kind, message } } };
}

function appendVerificationDiagnostic(
  diagnostics: VerificationDiagnostic[],
  entry: Omit<VerificationDiagnostic, 'message' | 'redacted'> & { message: string }
): void {
  diagnostics.push({
    ...entry,
    message: redactBoundedString(entry.message, 2048, 8192),
    redacted: true,
  });
  if (diagnostics.length > 200) diagnostics.splice(0, diagnostics.length - 200);
}

function boundedString(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

function redactBoundedString(value: unknown, limit: number, inputLimit = limit * 4): string {
  return boundedString(redactAll(boundedString(value, inputLimit)), limit);
}

function accessibilitySnapshotResult(raw: unknown): { snapshot: string; truncated: boolean } {
  if (typeof raw !== 'object' || raw === null) return { snapshot: '', truncated: false };
  const value = raw as { snapshot?: unknown; truncated?: unknown };
  const snapshot = typeof value.snapshot === 'string' ? value.snapshot : '';
  const bounded = boundedString(snapshot, 131_072);
  const redacted = redactAll(bounded);
  return {
    snapshot: boundedString(redacted, 65_536),
    truncated: Boolean(value.truncated) || snapshot.length > 65_536 || redacted.length > 65_536,
  };
}

type AccessibilityMatch = {
  nodeId: string;
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
};

function accessibilityQueryResult(raw: unknown): {
  matches: AccessibilityMatch[];
  truncated: boolean;
} {
  if (typeof raw !== 'object' || raw === null) return { matches: [], truncated: false };
  const value = raw as { matches?: unknown; truncated?: unknown };
  const matches = Array.isArray(value.matches)
    ? value.matches.slice(0, 50).flatMap((candidate): AccessibilityMatch[] => {
        if (typeof candidate !== 'object' || candidate === null) return [];
        const item = candidate as Record<string, unknown>;
        if (typeof item.nodeId !== 'string') return [];
        return [
          {
            nodeId: redactBoundedString(item.nodeId, 256),
            role: boundedString(item.role, 64),
            name: redactBoundedString(item.name, 512),
            ...(typeof item.value === 'string'
              ? { value: redactBoundedString(item.value, 2048) }
              : {}),
            ...(typeof item.disabled === 'boolean' ? { disabled: item.disabled } : {}),
          },
        ];
      })
    : [];
  return { matches, truncated: Boolean(value.truncated) || matches.length >= 50 };
}

function isFoundResult(raw: unknown): boolean {
  return typeof raw === 'object' && raw !== null && (raw as { found?: unknown }).found === true;
}

function keyInput(key: Extract<LoopBrowserAction, { kind: 'keypress' }>['key']): string {
  return key === 'Space' ? ' ' : key;
}

function targetScript(source: string, input: unknown): string {
  return `(${source})(${JSON.stringify(input)})`;
}

const ACCESSIBILITY_SNAPSHOT_SCRIPT = `(() => {
  const nodes = Array.from(document.querySelectorAll('body *'));
  const lines = [];
  let size = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const element = nodes[index];
    const role = element.getAttribute('role') || element.tagName.toLowerCase();
    const name = element.getAttribute('aria-label') || element.getAttribute('name') || element.textContent?.trim() || '';
    if (!name && !element.getAttribute('data-testid')) continue;
    const line = [role, name.slice(0, 512), element.getAttribute('data-testid') || ''].join(' | ');
    if (size + line.length + 1 > 65536) return { snapshot: lines.join('\\n'), truncated: true };
    lines.push(line);
    size += line.length + 1;
  }
  return { snapshot: lines.join('\\n'), truncated: false };
})()`;

const ACCESSIBILITY_QUERY_FUNCTION = `(input) => {
  const nodes = Array.from(document.querySelectorAll('body *'));
  const matches = [];
  let total = 0;
  const target = input.target;
  for (let index = 0; index < nodes.length; index += 1) {
    const element = nodes[index];
    const role = element.getAttribute('role') || element.tagName.toLowerCase();
    const name = element.getAttribute('aria-label') || element.getAttribute('name') || element.textContent?.trim() || '';
    const testId = element.getAttribute('data-testid') || '';
    if (target.role !== undefined && role !== target.role) continue;
    if (target.name !== undefined && name !== target.name) continue;
    if (target.testId !== undefined && testId !== target.testId) continue;
    total += 1;
    if (matches.length >= input.limit) continue;
    matches.push({
      nodeId: testId || 'node-' + index,
      role: role.slice(0, 64),
      name: name.slice(0, 512),
      value: element instanceof HTMLInputElement && element.type === 'password'
        ? undefined
        : typeof element.value === 'string'
          ? element.value.slice(0, 2048)
          : undefined,
      disabled: element.disabled === true || element.getAttribute('aria-disabled') === 'true' || undefined,
    });
  }
  return { matches, truncated: total > matches.length };
}`;

const INTERACTION_FUNCTION = `(input) => {
  const nodes = Array.from(document.querySelectorAll('body *'));
  const target = input.target;
  const element = nodes.find((candidate) => {
    const role = candidate.getAttribute('role') || candidate.tagName.toLowerCase();
    const name = candidate.getAttribute('aria-label') || candidate.getAttribute('name') || candidate.textContent?.trim() || '';
    const testId = candidate.getAttribute('data-testid') || '';
    return (target.role === undefined || role === target.role) &&
      (target.name === undefined || name === target.name) &&
      (target.testId === undefined || testId === target.testId);
  });
  if (!element) return { found: false };
  if (input.kind === 'click') element.click();
  if (input.kind === 'fill') {
    if (element instanceof HTMLInputElement && element.type === 'password') {
      return { found: false };
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const prototype = element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (!setter) return { found: false };
      setter.call(element, input.value);
    } else if (element.isContentEditable) element.textContent = input.value;
    else return { found: false };
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { found: true };
}`;

async function clearPartitionBrowsingData(
  partition: string,
  kind: BrowsingDataKind
): Promise<void> {
  const partitionSession = session.fromPartition(partition);
  switch (kind) {
    case 'all':
      // No options clears every data type, more thoroughly than clearStorageData.
      await partitionSession.clearData();
      return;
    case 'cookies':
      await partitionSession.clearData({ dataTypes: ['cookies'] });
      return;
    case 'siteData':
      await partitionSession.clearData({
        dataTypes: SITE_DATA_CLEAR_DATA_TYPES,
      });
      return;
    case 'cache':
      await partitionSession.clearData({ dataTypes: ['cache'] });
      return;
  }
}

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

type ParsedShortcut = {
  key: string;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  control: boolean;
};

function getBrowserShortcuts(
  keyboard?: AppSettings['keyboard']
): Map<ShortcutSettingsKey, ParsedShortcut> {
  const shortcuts = new Map<ShortcutSettingsKey, ParsedShortcut>();
  for (const shortcutKey of Object.keys(APP_SHORTCUTS) as ShortcutSettingsKey[]) {
    if (shortcutKey === 'closeModal' || APP_SHORTCUTS[shortcutKey].ignoreWhenBrowserFocused) {
      continue;
    }

    const configured = keyboard?.[shortcutKey];
    if (configured === null) continue;

    const fallback = resolveDefaultHotkey(APP_SHORTCUTS[shortcutKey]) ?? null;
    const hotkey = configured ?? fallback;
    if (hotkey === null) continue;

    const parsed = parseShortcut(hotkey);
    if (parsed) {
      shortcuts.set(shortcutKey, parsed);
      continue;
    }

    if (configured) {
      const parsedFallback = fallback ? parseShortcut(fallback) : null;
      if (parsedFallback) shortcuts.set(shortcutKey, parsedFallback);
      log.warn('Invalid browser app shortcut, falling back to default', {
        shortcutKey,
        shortcut: configured,
      });
    }
  }
  return shortcuts;
}

function getBrowserShortcutKey(
  input: Electron.Input,
  shortcuts: ReadonlyMap<ShortcutSettingsKey, ParsedShortcut>
): ShortcutSettingsKey | null {
  if (input.type !== 'keyDown') return null;
  for (const [shortcutKey, parsed] of shortcuts) {
    if (
      normalizeInputKey(input.key) === parsed.key &&
      Boolean(input.shift) === parsed.shift &&
      Boolean(input.alt) === parsed.alt &&
      Boolean(input.meta) === parsed.meta &&
      Boolean(input.control) === parsed.control
    ) {
      return shortcutKey;
    }
  }
  return null;
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
