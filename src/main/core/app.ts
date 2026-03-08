import { exec, execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { app, clipboard, shell } from 'electron';
import { appPasteChannel, appRedoChannel, appUndoChannel } from '@shared/events/appEvents';
import {
  getAppById,
  getResolvedLabel,
  OPEN_IN_APPS,
  type OpenInAppId,
  type PlatformKey,
} from '@shared/openInApps';
import { createRPCController } from '../../shared/ipc/rpc';
import { getMainWindow } from '../app/window';
import { db } from '../db/client';
import { sshConnections } from '../db/schema';
import { events } from '../lib/events';
import { buildExternalToolEnv } from '../utils/childProcessEnv';
import {
  buildGhosttyRemoteExecArgs,
  buildRemoteEditorUrl,
  buildRemoteSshCommand,
} from '../utils/remoteOpenIn';

const UNKNOWN_VERSION = 'unknown';

let cachedAppVersion: string | null = null;
let cachedAppVersionPromise: Promise<string> | null = null;
const FONT_CACHE_TTL_MS = 5 * 60 * 1000;
let cachedInstalledFonts: { fonts: string[]; fetchedAt: number } | null = null;

const execCommand = (
  command: string,
  opts?: { maxBuffer?: number; timeout?: number }
): Promise<string> => {
  return new Promise((resolve, reject) => {
    exec(
      command,
      {
        maxBuffer: opts?.maxBuffer ?? 8 * 1024 * 1024,
        timeout: opts?.timeout ?? 30000,
        env: buildExternalToolEnv(),
      },
      (error, stdout) => {
        if (error) return reject(error);
        resolve(stdout ?? '');
      }
    );
  });
};

const execFileCommand = (
  file: string,
  args: string[],
  opts?: { timeout?: number }
): Promise<void> => {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: opts?.timeout ?? 30000,
        env: buildExternalToolEnv(),
      },
      (error) => {
        if (error) return reject(error);
        resolve();
      }
    );
  });
};

const escapeAppleScriptString = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const dedupeAndSortFonts = (fonts: string[]): string[] => {
  const unique = Array.from(new Set(fonts.map((font) => font.trim()).filter(Boolean)));
  return unique.sort((a, b) => a.localeCompare(b));
};

const listInstalledFontsMac = async (): Promise<string[]> => {
  const stdout = await execCommand('system_profiler SPFontsDataType -json', {
    maxBuffer: 24 * 1024 * 1024,
    timeout: 60000,
  });
  const parsed = JSON.parse(stdout) as {
    SPFontsDataType?: Array<{
      typefaces?: Array<{ family?: string; fullname?: string }>;
      _name?: string;
    }>;
  };
  const fonts: string[] = [];
  for (const item of parsed.SPFontsDataType ?? []) {
    for (const typeface of item.typefaces ?? []) {
      if (typeface.family) fonts.push(typeface.family);
    }
  }
  return dedupeAndSortFonts(fonts);
};

const listInstalledFontsLinux = async (): Promise<string[]> => {
  const stdout = await execCommand('fc-list : family', { timeout: 30000 });
  const fonts = stdout
    .split('\n')
    .flatMap((line) => line.split(','))
    .map((font) => font.trim())
    .filter(Boolean);
  return dedupeAndSortFonts(fonts);
};

const listInstalledFontsWindows = async (): Promise<string[]> => {
  const script =
    "$fonts = Get-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts';" +
    "$props = $fonts.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' };" +
    "$props | ForEach-Object { ($_.Name -replace '\\s*\\(.*\\)$','').Trim() }";
  const stdout = await execCommand(`powershell -NoProfile -Command "${script}"`, {
    timeout: 30000,
  });
  const fonts = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return dedupeAndSortFonts(fonts);
};

const listInstalledFontsAll = async (): Promise<string[]> => {
  switch (process.platform) {
    case 'darwin':
      return listInstalledFontsMac();
    case 'linux':
      return listInstalledFontsLinux();
    case 'win32':
      return listInstalledFontsWindows();
    default:
      return [];
  }
};

const readPackageVersion = async (packageJsonPath: string): Promise<string | null> => {
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
    if (packageJson.name === 'emdash' && packageJson.version) {
      return packageJson.version as string;
    }
  } catch {
    // Ignore missing or malformed package.json; try the next path.
  }
  return null;
};

const resolveAppVersion = async (): Promise<string> => {
  try {
    const version = app.getVersion();
    if (version && version !== '0.0.0') return version;
  } catch {
    // fall through
  }

  const possiblePaths = [
    join(__dirname, '../../package.json'),
    join(process.cwd(), 'package.json'),
    join(app.getAppPath(), 'package.json'),
  ];

  for (const packageJsonPath of possiblePaths) {
    const version = await readPackageVersion(packageJsonPath);
    if (version) return version;
  }

  try {
    return app.getVersion();
  } catch {
    return UNKNOWN_VERSION;
  }
};

const getCachedAppVersion = (): Promise<string> => {
  if (cachedAppVersion) return Promise.resolve(cachedAppVersion);
  if (!cachedAppVersionPromise) {
    cachedAppVersionPromise = resolveAppVersion().then((version) => {
      cachedAppVersion = version;
      return version;
    });
  }
  return cachedAppVersionPromise;
};

export const appController = createRPCController({
  openExternal: async (url: string) => {
    try {
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');
      const ALLOWED_PROTOCOLS = ['http:', 'https:'];
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new Error('Invalid URL format');
      }
      if (!ALLOWED_PROTOCOLS.includes(parsedUrl.protocol)) {
        throw new Error(
          `Protocol "${parsedUrl.protocol}" is not allowed. Only http and https URLs are permitted.`
        );
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  clipboardWriteText: async (text: string) => {
    try {
      if (typeof text !== 'string') throw new Error('Invalid clipboard text');
      clipboard.writeText(text);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  openIn: async (args: {
    app: OpenInAppId;
    path: string;
    isRemote?: boolean;
    sshConnectionId?: string | null;
  }) => {
    const target = args?.path;
    const appId = args?.app;
    const isRemote = args?.isRemote || false;
    const sshConnectionId = args?.sshConnectionId;

    if (!target || typeof target !== 'string' || !appId) {
      return { success: false, error: 'Invalid arguments' };
    }
    try {
      const platform = process.platform as PlatformKey;
      const appConfig = getAppById(appId);
      if (!appConfig) return { success: false, error: 'Invalid app ID' };

      const platformConfig = appConfig.platforms?.[platform];
      const label = getResolvedLabel(appConfig, platform);
      if (!platformConfig && !appConfig.alwaysAvailable) {
        return { success: false, error: `${label} is not available on this platform.` };
      }

      if (isRemote && sshConnectionId) {
        try {
          const rows = await db
            .select()
            .from(sshConnections)
            .where(eq(sshConnections.id, sshConnectionId))
            .limit(1);
          const connection = rows[0];
          if (!connection) return { success: false, error: 'SSH connection not found' };

          if (appId === 'vscode') {
            const remoteUrl = buildRemoteEditorUrl(
              'vscode',
              connection.host,
              connection.username,
              target
            );
            await shell.openExternal(remoteUrl);
            return { success: true };
          } else if (appId === 'cursor') {
            const remoteUrl = buildRemoteEditorUrl(
              'cursor',
              connection.host,
              connection.username,
              target
            );
            await shell.openExternal(remoteUrl);
            return { success: true };
          } else if (appId === 'terminal' && platform === 'darwin') {
            const sshCommand = buildRemoteSshCommand({
              host: connection.host,
              username: connection.username,
              port: connection.port,
              targetPath: target,
            });
            const escapedCommand = escapeAppleScriptString(sshCommand);
            await execFileCommand('osascript', [
              '-e',
              `tell application "Terminal" to do script "${escapedCommand}"`,
              '-e',
              'tell application "Terminal" to activate',
            ]);
            return { success: true };
          } else if (appId === 'iterm2' && platform === 'darwin') {
            const sshCommand = buildRemoteSshCommand({
              host: connection.host,
              username: connection.username,
              port: connection.port,
              targetPath: target,
            });
            const escapedCommand = escapeAppleScriptString(sshCommand);
            await execFileCommand('osascript', [
              '-e',
              `tell application "iTerm" to create window with default profile command "${escapedCommand}"`,
              '-e',
              'tell application "iTerm" to activate',
            ]);
            return { success: true };
          } else if (appId === 'warp' && platform === 'darwin') {
            const sshCommand = buildRemoteSshCommand({
              host: connection.host,
              username: connection.username,
              port: connection.port,
              targetPath: target,
            });
            await shell.openExternal(
              `warp://action/new_window?cmd=${encodeURIComponent(sshCommand)}`
            );
            return { success: true };
          } else if (appId === 'ghostty') {
            const ghosttyExecArgs = buildGhosttyRemoteExecArgs({
              host: connection.host,
              username: connection.username,
              port: connection.port,
              targetPath: target,
            });
            const attempts =
              platform === 'darwin'
                ? [
                    {
                      file: 'open',
                      args: [
                        '-n',
                        '-b',
                        'com.mitchellh.ghostty',
                        '--args',
                        '-e',
                        ...ghosttyExecArgs,
                      ],
                    },
                    {
                      file: 'open',
                      args: ['-na', 'Ghostty', '--args', '-e', ...ghosttyExecArgs],
                    },
                    { file: 'ghostty', args: ['-e', ...ghosttyExecArgs] },
                  ]
                : [{ file: 'ghostty', args: ['-e', ...ghosttyExecArgs] }];

            let lastError: unknown = null;
            for (const attempt of attempts) {
              try {
                await execFileCommand(attempt.file, attempt.args);
                return { success: true };
              } catch (error) {
                lastError = error;
              }
            }
            if (lastError instanceof Error) throw lastError;
            throw new Error('Unable to launch Ghostty');
          } else if (appConfig.supportsRemote) {
            return { success: false, error: `Remote SSH not yet implemented for ${label}` };
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to open remote connection: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      const quoted = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;

      if (platformConfig?.openUrls) {
        for (const urlTemplate of platformConfig.openUrls) {
          const url = urlTemplate
            .replace('{{path_url}}', encodeURIComponent(target))
            .replace('{{path}}', target);
          try {
            await shell.openExternal(url);
            return { success: true };
          } catch {
            // try next URL
          }
        }
        return {
          success: false,
          error: `${label} is not installed or its URI scheme is not registered on this platform.`,
        };
      }

      const commands = platformConfig?.openCommands || [];
      let command = '';
      if (commands.length > 0) {
        command = commands
          .map((cmd: string) =>
            cmd.replace('{{path}}', quoted(target)).replace('{{path_raw}}', target)
          )
          .join(' || ');
      }

      if (!command) return { success: false, error: 'Unsupported platform or app' };

      // if (appConfig.autoInstall) {
      //   try {
      //     const settings = getAppSettings();
      //     if (settings?.projectPrep?.autoInstallOnOpenInEditor) {
      //       void ensureProjectPrepared(target).catch(() => {});
      //     }
      //   } catch {
      //     // ignore
      //   }
      // }

      await new Promise<void>((resolve, reject) => {
        exec(command, { cwd: target, env: buildExternalToolEnv() }, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
      return { success: true };
    } catch (error) {
      const appConfig = getAppById(appId);
      const catchLabel = appConfig
        ? getResolvedLabel(appConfig, process.platform as PlatformKey)
        : appId;
      return { success: false, error: `Unable to open in ${catchLabel}` };
    }
  },

  checkInstalledApps: async () => {
    const platform = process.platform as PlatformKey;
    const availability: Record<string, boolean> = {};

    const checkCommand = (cmd: string): Promise<boolean> =>
      new Promise((resolve) => {
        exec(`command -v ${cmd} >/dev/null 2>&1`, { env: buildExternalToolEnv() }, (error) => {
          resolve(!error);
        });
      });

    const checkMacApp = (bundleId: string): Promise<boolean> =>
      new Promise((resolve) => {
        exec(
          `mdfind "kMDItemCFBundleIdentifier == '${bundleId}'"`,
          { env: buildExternalToolEnv() },
          (error, stdout) => {
            resolve(!error && stdout.trim().length > 0);
          }
        );
      });

    const checkMacAppByName = (appName: string): Promise<boolean> =>
      new Promise((resolve) => {
        exec(
          `osascript -e 'id of application "${appName}"' 2>/dev/null`,
          { env: buildExternalToolEnv() },
          (error) => {
            resolve(!error);
          }
        );
      });

    for (const openInApp of OPEN_IN_APPS) {
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
        console.error(`Error checking installed app ${openInApp.id}:`, error);
        availability[openInApp.id] = false;
      }
    }
    return availability;
  },

  listInstalledFonts: async (args?: { refresh?: boolean }) => {
    const refresh = Boolean(args?.refresh);
    const now = Date.now();
    if (
      !refresh &&
      cachedInstalledFonts &&
      now - cachedInstalledFonts.fetchedAt < FONT_CACHE_TTL_MS
    ) {
      return { success: true, fonts: cachedInstalledFonts.fonts, cached: true };
    }
    try {
      const fonts = await listInstalledFontsAll();
      cachedInstalledFonts = { fonts, fetchedAt: now };
      return { success: true, fonts, cached: false };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        fonts: cachedInstalledFonts?.fonts ?? [],
        cached: Boolean(cachedInstalledFonts),
      };
    }
  },

  getAppVersion: () => getCachedAppVersion(),
  getElectronVersion: () => process.versions.electron,
  getPlatform: () => process.platform,
});

export function registerAppIpc(): void {
  void getCachedAppVersion();

  events.on(appUndoChannel, () => {
    getMainWindow()?.webContents.undo();
  });

  events.on(appRedoChannel, () => {
    getMainWindow()?.webContents.redo();
  });

  events.on(appPasteChannel, () => {
    getMainWindow()?.webContents.paste();
  });
}
