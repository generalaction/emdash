import { app, ipcMain, shell } from 'electron';
import { exec } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { ensureProjectPrepared } from '../services/ProjectPrep';
import { getAppSettings } from '../settings';
import { getAppById, OPEN_IN_APPS, type OpenInAppId, type PlatformKey } from '@shared/openInApps';
import { databaseService } from '../services/DatabaseService';

const UNKNOWN_VERSION = 'unknown';

let cachedAppVersion: string | null = null;
let cachedAppVersionPromise: Promise<string> | null = null;

const readPackageVersion = async (packageJsonPath: string): Promise<string | null> => {
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
    if (packageJson.name === 'emdash' && packageJson.version) {
      return packageJson.version;
    }
  } catch {
    // Ignore missing or malformed package.json; try the next path.
  }
  return null;
};

const resolveAppVersion = async (): Promise<string> => {
  // In development, we need to look for package.json in the project root.
  const isDev = !app.isPackaged || process.env.NODE_ENV === 'development';

  const possiblePaths = isDev
    ? [
        join(__dirname, '../../../../package.json'), // from dist/main/main/ipc in dev
        join(__dirname, '../../../package.json'), // alternative dev path
        join(process.cwd(), 'package.json'), // current working directory
      ]
    : [
        join(__dirname, '../../package.json'), // from dist/main/ipc in production
        join(app.getAppPath(), 'package.json'), // production build
      ];

  for (const packageJsonPath of possiblePaths) {
    const version = await readPackageVersion(packageJsonPath);
    if (version) {
      return version;
    }
  }

  // In dev, never use app.getVersion() as it returns Electron version.
  if (isDev) {
    return UNKNOWN_VERSION;
  }

  try {
    return app.getVersion();
  } catch (error) {
    void error;
    return UNKNOWN_VERSION;
  }
};

const getCachedAppVersion = (): Promise<string> => {
  if (cachedAppVersion) {
    return Promise.resolve(cachedAppVersion);
  }

  if (!cachedAppVersionPromise) {
    cachedAppVersionPromise = resolveAppVersion().then((version) => {
      cachedAppVersion = version;
      return version;
    });
  }

  return cachedAppVersionPromise;
};

export function registerAppIpc() {
  void getCachedAppVersion();

  ipcMain.handle('app:openExternal', async (_event, url: string) => {
    try {
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    'app:openIn',
    async (
      _event,
      args: {
        app: OpenInAppId;
        path: string;
        isRemote?: boolean;
        sshConnectionId?: string | null;
      }
    ) => {
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
        if (!appConfig) {
          return { success: false, error: 'Invalid app ID' };
        }

        const platformConfig = appConfig.platforms?.[platform];
        if (!platformConfig && !appConfig.alwaysAvailable) {
          return { success: false, error: `${appConfig.label} is not available on this platform.` };
        }

        // Handle remote SSH connections for supported editors and terminals
        if (isRemote && sshConnectionId) {
          try {
            const connection = await databaseService.getSshConnection(sshConnectionId);
            if (!connection) {
              return { success: false, error: 'SSH connection not found' };
            }

            // Construct remote SSH URL or command based on the app
            if (appId === 'vscode') {
              // VS Code Remote SSH URL format: vscode://vscode-remote/ssh-remote+hostname/path
              const remoteUrl = `vscode://vscode-remote/ssh-remote+${connection.host}${target}`;
              await shell.openExternal(remoteUrl);
              return { success: true };
            } else if (appId === 'cursor') {
              // Cursor uses its own URL scheme for remote SSH
              const remoteUrl = `cursor://vscode-remote/ssh-remote+${connection.host}${target}`;
              await shell.openExternal(remoteUrl);
              return { success: true };
            } else if (appId === 'terminal' && platform === 'darwin') {
              // macOS Terminal.app - execute SSH command
              const sshCommand = `ssh ${connection.username}@${connection.host} -p ${connection.port} -t "cd ${target} && exec \\$SHELL"`;
              // Properly escape for AppleScript
              const escapedCommand = sshCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
              const terminalCommand = `osascript -e 'tell application "Terminal" to do script "${escapedCommand}"' -e 'tell application "Terminal" to activate'`;

              await new Promise<void>((resolve, reject) => {
                exec(terminalCommand, (err) => {
                  if (err) return reject(err);
                  resolve();
                });
              });
              return { success: true };
            } else if (appId === 'iterm2' && platform === 'darwin') {
              // iTerm2 - execute SSH command
              const sshCommand = `ssh ${connection.username}@${connection.host} -p ${connection.port} -t "cd ${target} && exec \\$SHELL"`;
              const escapedCommand = sshCommand.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
              const terminalCommand = `osascript -e 'tell application "iTerm" to create window with default profile command "${escapedCommand}"'`;

              await new Promise<void>((resolve, reject) => {
                exec(terminalCommand, (err) => {
                  if (err) return reject(err);
                  resolve();
                });
              });
              return { success: true };
            } else if (appId === 'warp' && platform === 'darwin') {
              // Warp - use URL scheme with SSH command
              const sshCommand = `ssh ${connection.username}@${connection.host} -p ${connection.port} -t "cd ${target} && exec \\$SHELL"`;
              await shell.openExternal(
                `warp://action/new_window?cmd=${encodeURIComponent(sshCommand)}`
              );
              return { success: true };
            } else if (appId === 'ghostty') {
              // Ghostty - execute SSH command directly
              const sshCommand = `ssh ${connection.username}@${connection.host} -p ${connection.port} -t "cd ${target} && exec \\$SHELL"`;
              const quoted = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;
              const terminalCommand = `ghostty -e ${quoted(sshCommand)}`;

              await new Promise<void>((resolve, reject) => {
                exec(terminalCommand, (err) => {
                  if (err) return reject(err);
                  resolve();
                });
              });
              return { success: true };
            } else if (appConfig.supportsRemote) {
              // App claims to support remote but we don't have a handler
              return {
                success: false,
                error: `Remote SSH not yet implemented for ${appConfig.label}`,
              };
            }
          } catch (error) {
            return {
              success: false,
              error: `Failed to open remote connection: ${error instanceof Error ? error.message : String(error)}`,
            };
          }
        }

        const quoted = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;

        // Handle URL-based apps (like Warp)
        if (platformConfig?.openUrls) {
          for (const urlTemplate of platformConfig.openUrls) {
            const url = urlTemplate
              .replace('{{path_url}}', encodeURIComponent(target))
              .replace('{{path}}', target);
            try {
              await shell.openExternal(url);
              return { success: true };
            } catch (error) {
              void error;
            }
          }
          return {
            success: false,
            error: `${appConfig.label} is not installed or its URI scheme is not registered on this platform.`,
          };
        }

        // Handle command-based apps
        const commands = platformConfig?.openCommands || [];
        let command = '';

        if (commands.length > 0) {
          command = commands
            .map((cmd: string) => {
              // Chain both replacements: first {{path}}, then {{path_raw}}
              return cmd.replace('{{path}}', quoted(target)).replace('{{path_raw}}', target);
            })
            .join(' || ');
        }

        if (!command) {
          return { success: false, error: 'Unsupported platform or app' };
        }

        if (appConfig.autoInstall) {
          try {
            const settings = getAppSettings();
            if (settings?.projectPrep?.autoInstallOnOpenInEditor) {
              void ensureProjectPrepared(target).catch(() => {});
            }
          } catch {}
        }

        await new Promise<void>((resolve, reject) => {
          exec(command, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
        return { success: true };
      } catch (error) {
        const appConfig = getAppById(appId);
        const label = appConfig?.label || appId;
        return { success: false, error: `Unable to open in ${label}` };
      }
    }
  );

  ipcMain.handle('app:checkInstalledApps', async () => {
    const platform = process.platform as PlatformKey;
    const availability: Record<string, boolean> = {};

    // Helper to check if a command exists
    const checkCommand = (cmd: string): Promise<boolean> => {
      return new Promise((resolve) => {
        exec(`command -v ${cmd} >/dev/null 2>&1`, (error) => {
          resolve(!error);
        });
      });
    };

    // Helper to check if macOS app exists by bundle ID
    const checkMacApp = (bundleId: string): Promise<boolean> => {
      return new Promise((resolve) => {
        exec(`mdfind "kMDItemCFBundleIdentifier == '${bundleId}'"`, (error, stdout) => {
          resolve(!error && stdout.trim().length > 0);
        });
      });
    };

    // Helper to check if macOS app exists by name
    const checkMacAppByName = (appName: string): Promise<boolean> => {
      return new Promise((resolve) => {
        exec(`osascript -e 'id of application "${appName}"' 2>/dev/null`, (error) => {
          resolve(!error);
        });
      });
    };

    for (const app of OPEN_IN_APPS) {
      // Skip apps that don't have platform-specific config
      const platformConfig = app.platforms[platform];
      if (!platformConfig && !app.alwaysAvailable) {
        availability[app.id] = false;
        continue;
      }

      // Always available apps are set to true by default
      if (app.alwaysAvailable) {
        availability[app.id] = true;
        continue;
      }

      try {
        let isAvailable = false;

        // Check via bundle IDs (macOS)
        if (platformConfig?.bundleIds) {
          for (const bundleId of platformConfig.bundleIds) {
            if (await checkMacApp(bundleId)) {
              isAvailable = true;
              break;
            }
          }
        }

        // Check via app names (macOS)
        if (!isAvailable && platformConfig?.appNames) {
          for (const appName of platformConfig.appNames) {
            if (await checkMacAppByName(appName)) {
              isAvailable = true;
              break;
            }
          }
        }

        // Check via CLI commands (all platforms)
        if (!isAvailable && platformConfig?.checkCommands) {
          for (const cmd of platformConfig.checkCommands) {
            if (await checkCommand(cmd)) {
              isAvailable = true;
              break;
            }
          }
        }

        availability[app.id] = isAvailable;
      } catch (error) {
        console.error(`Error checking installed app ${app.id}:`, error);
        availability[app.id] = false;
      }
    }

    return availability;
  });

  // App metadata
  ipcMain.handle('app:getAppVersion', () => getCachedAppVersion());
  ipcMain.handle('app:getElectronVersion', () => process.versions.electron);
  ipcMain.handle('app:getPlatform', () => process.platform);
}
