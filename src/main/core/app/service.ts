import { exec } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { clipboard, dialog, shell } from 'electron';
import { appPasteChannel, appRedoChannel, appUndoChannel } from '@shared/events/appEvents';
import {
  getAppById,
  getResolvedLabel,
  OPEN_IN_APPS,
  type OpenInAppId,
  type PlatformConfig,
  type PlatformKey,
} from '@shared/openInApps';
import { getMainWindow } from '@main/app/window';
import { db } from '@main/db/client';
import { sshConnections } from '@main/db/schema';
import { events } from '@main/lib/events';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { buildExternalToolEnv } from '@main/utils/childProcessEnv';
import {
  buildRemoteEditorUrl,
  buildRemoteSshCommand,
  buildRemoteTerminalExecArgs,
} from '@main/utils/remoteOpenIn';
import {
  checkCommand,
  checkMacApp,
  checkMacAppByName,
  escapeAppleScriptString,
  execFileCommand,
  listInstalledFontsAll,
  resolveAppVersion,
} from './utils';

const FONT_CACHE_TTL_MS = 5 * 60 * 1_000;

type RemoteTerminalLaunchAttempt = {
  file: string;
  args: string[];
};

class AppService implements IInitializable, IDisposable {
  private cachedAppVersion: string | null = null;
  private cachedAppVersionPromise: Promise<string> | null = null;
  private cachedInstalledFonts: { fonts: string[]; fetchedAt: number } | null = null;
  private _unsubscribes: Array<() => void> = [];

  initialize(): void {
    void this.getCachedAppVersion();

    this._unsubscribes = [
      events.on(appUndoChannel, () => {
        getMainWindow()?.webContents.undo();
      }),
      events.on(appRedoChannel, () => {
        getMainWindow()?.webContents.redo();
      }),
      events.on(appPasteChannel, () => {
        getMainWindow()?.webContents.paste();
      }),
    ];
  }

  dispose(): void {
    for (const unsub of this._unsubscribes) unsub();
    this._unsubscribes = [];
  }

  getCachedAppVersion(): Promise<string> {
    if (this.cachedAppVersion) return Promise.resolve(this.cachedAppVersion);
    if (!this.cachedAppVersionPromise) {
      this.cachedAppVersionPromise = resolveAppVersion().then((version) => {
        this.cachedAppVersion = version;
        return version;
      });
    }
    return this.cachedAppVersionPromise;
  }

  async listInstalledFonts(
    refresh?: boolean
  ): Promise<{ fonts: string[]; cached: boolean; error?: string }> {
    const now = Date.now();
    if (
      !refresh &&
      this.cachedInstalledFonts &&
      now - this.cachedInstalledFonts.fetchedAt < FONT_CACHE_TTL_MS
    ) {
      return { fonts: this.cachedInstalledFonts.fonts, cached: true };
    }
    try {
      const fonts = await listInstalledFontsAll();
      this.cachedInstalledFonts = { fonts, fetchedAt: now };
      return { fonts, cached: false };
    } catch (error) {
      return {
        fonts: this.cachedInstalledFonts?.fonts ?? [],
        cached: Boolean(this.cachedInstalledFonts),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async checkInstalledApps(): Promise<Record<string, boolean>> {
    const platform = process.platform as PlatformKey;
    const availability: Record<string, boolean> = {};

    for (const openInApp of Object.values(OPEN_IN_APPS)) {
      const platformConfig = openInApp.platforms[platform];
      if (!platformConfig && !openInApp.alwaysAvailable) {
        availability[openInApp.id] = false;
        continue;
      }
      if (openInApp.alwaysAvailable) {
        availability[openInApp.id] = true;
        continue;
      }
      try {
        let isAvailable = false;
        if (platformConfig?.bundleIds) {
          for (const bundleId of platformConfig.bundleIds) {
            if (await checkMacApp(bundleId)) {
              isAvailable = true;
              break;
            }
          }
        }
        if (!isAvailable && platformConfig?.appNames) {
          for (const appName of platformConfig.appNames) {
            if (await checkMacAppByName(appName)) {
              isAvailable = true;
              break;
            }
          }
        }
        if (!isAvailable && platformConfig?.checkCommands) {
          for (const cmd of platformConfig.checkCommands) {
            if (await checkCommand(cmd)) {
              isAvailable = true;
              break;
            }
          }
        }
        availability[openInApp.id] = isAvailable;
      } catch (error) {
        log.error(`Error checking installed app ${openInApp.id}:`, error);
        availability[openInApp.id] = false;
      }
    }

    return availability;
  }

  async openExternal(url: string): Promise<void> {
    if (!url || typeof url !== 'string') throw new Error('Invalid URL');
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('Invalid URL format');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error(
        `Protocol "${parsedUrl.protocol}" is not allowed. Only http and https URLs are permitted.`
      );
    }
    await shell.openExternal(url);
  }

  clipboardWriteText(text: string): void {
    if (typeof text !== 'string') throw new Error('Invalid clipboard text');
    clipboard.writeText(text);
  }

  async openIn(args: {
    app: OpenInAppId;
    path: string;
    isRemote?: boolean;
    sshConnectionId?: string | null;
  }): Promise<void> {
    const { path: target, app: appId, isRemote = false, sshConnectionId } = args;

    if (!target || typeof target !== 'string' || !appId) {
      throw new Error('Invalid arguments');
    }

    const platform = process.platform as PlatformKey;
    const appConfig = getAppById(appId);
    if (!appConfig) throw new Error('Invalid app ID');

    const platformConfig = appConfig.platforms?.[platform];
    const label = getResolvedLabel(appConfig, platform);

    if (!platformConfig && !appConfig.alwaysAvailable) {
      throw new Error(`${label} is not available on this platform.`);
    }

    if (isRemote && sshConnectionId) {
      await this.openInRemote({ appId, appConfig, label, target, platform, sshConnectionId });
      return;
    }

    await this.openInLocal({ label, target, platformConfig });
  }

  private async openInRemote(args: {
    appId: OpenInAppId;
    appConfig: ReturnType<typeof getAppById>;
    label: string;
    target: string;
    platform: PlatformKey;
    sshConnectionId: string;
  }): Promise<void> {
    const { appId, appConfig, label, target, platform, sshConnectionId } = args;

    const [connection] = await db
      .select()
      .from(sshConnections)
      .where(eq(sshConnections.id, sshConnectionId))
      .limit(1);

    if (!connection) throw new Error('SSH connection not found');

    const { host, username, port } = connection;

    if (appId === 'vscode' || appId === 'cursor') {
      await shell.openExternal(buildRemoteEditorUrl(appId, host, username, target));
      return;
    }

    if ((appId === 'terminal' || appId === 'iterm2') && platform === 'darwin') {
      const sshCommand = buildRemoteSshCommand({ host, username, port, targetPath: target });
      const escapedCommand = escapeAppleScriptString(sshCommand);
      const appName = appId === 'terminal' ? 'Terminal' : 'iTerm';
      const script =
        appId === 'terminal'
          ? `tell application "${appName}" to do script "${escapedCommand}"`
          : `tell application "${appName}" to create window with default profile command "${escapedCommand}"`;
      await execFileCommand('osascript', [
        '-e',
        script,
        '-e',
        `tell application "${appName}" to activate`,
      ]);
      return;
    }

    if (appId === 'warp' && platform === 'darwin') {
      const sshCommand = buildRemoteSshCommand({ host, username, port, targetPath: target });
      await shell.openExternal(`warp://action/new_window?cmd=${encodeURIComponent(sshCommand)}`);
      return;
    }

    if (appId === 'ghostty') {
      const remoteExecArgs = buildRemoteTerminalExecArgs({
        host,
        username,
        port,
        targetPath: target,
      });
      const attempts =
        platform === 'darwin'
          ? [
              {
                file: 'open',
                args: ['-n', '-b', 'com.mitchellh.ghostty', '--args', '-e', ...remoteExecArgs],
              },
              { file: 'open', args: ['-na', 'Ghostty', '--args', '-e', ...remoteExecArgs] },
              { file: 'ghostty', args: ['-e', ...remoteExecArgs] },
            ]
          : [{ file: 'ghostty', args: ['-e', ...remoteExecArgs] }];

      await this.launchRemoteTerminal('Ghostty', attempts);
      return;
    }

    if (appId === 'kitty') {
      const remoteExecArgs = buildRemoteTerminalExecArgs({
        host,
        username,
        port,
        targetPath: target,
      });
      const attempts =
        platform === 'darwin'
          ? [
              {
                file: 'open',
                args: ['-n', '-b', 'net.kovidgoyal.kitty', '--args', ...remoteExecArgs],
              },
              { file: 'open', args: ['-na', 'kitty', '--args', ...remoteExecArgs] },
              { file: 'kitty', args: remoteExecArgs },
            ]
          : [{ file: 'kitty', args: remoteExecArgs }];

      await this.launchRemoteTerminal('Kitty', attempts);
      return;
    }

    if (appConfig?.supportsRemote) {
      throw new Error(`Remote SSH not yet implemented for ${label}`);
    }
  }

  private async launchRemoteTerminal(
    label: string,
    attempts: RemoteTerminalLaunchAttempt[]
  ): Promise<void> {
    let lastError: unknown = null;
    for (const attempt of attempts) {
      try {
        await execFileCommand(attempt.file, attempt.args);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error(`Unable to launch ${label}`);
  }

  private async openInLocal(args: {
    label: string;
    target: string;
    platformConfig: PlatformConfig | undefined;
  }): Promise<void> {
    const { label, target, platformConfig } = args;

    if (platformConfig?.openUrls) {
      for (const urlTemplate of platformConfig.openUrls) {
        const url = urlTemplate
          .replace('{{path_url}}', encodeURIComponent(target))
          .replace('{{path}}', target);
        try {
          await shell.openExternal(url);
          return;
        } catch {
          // try next URL
        }
      }
      throw new Error(
        `${label} is not installed or its URI scheme is not registered on this platform.`
      );
    }

    const quoted = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;
    const commands: string[] = platformConfig?.openCommands ?? [];
    const command = commands
      .map((cmd) => cmd.replace('{{path}}', quoted(target)).replace('{{path_raw}}', target))
      .join(' || ');

    if (!command) throw new Error('Unsupported platform or app');

    await new Promise<void>((resolve, reject) => {
      exec(command, { cwd: target, env: buildExternalToolEnv() }, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }

  async openSelectDirectoryDialog(args: {
    title: string;
    message: string;
  }): Promise<string | undefined> {
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: args.title,
      properties: ['openDirectory'],
      message: args.message,
    });
    if (result.canceled) return undefined;
    return result.filePaths[0];
  }
}

export const appService = new AppService();
