import { app, ipcMain, shell } from 'electron';
import { exec } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ensureProjectPrepared } from '../services/ProjectPrep';
import { getAppSettings } from '../settings';
import { OPEN_IN_APPS, type OpenInAppId, type PlatformKey } from '../../shared/openInApps';

export function registerAppIpc() {
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
      }
    ) => {
      const target = args?.path;
      const appId = args?.app;
      if (!target || typeof target !== 'string' || !appId) {
        return { success: false, error: 'Invalid arguments' };
      }
      try {
        const platform = process.platform as PlatformKey;
        const appConfig = OPEN_IN_APPS.find((a) => a.id === appId);
        if (!appConfig) {
          return { success: false, error: 'Invalid app ID' };
        }

        const platformConfig = appConfig.platforms[platform];
        if (!platformConfig && !appConfig.alwaysAvailable) {
          return { success: false, error: `${appConfig.label} is not available on this platform.` };
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
            .map((cmd) => {
              const cmdWithQuotedPath = cmd.replace('{{path}}', quoted(target));
              const cmdWithRawPath = cmd.replace('{{path_raw}}', target);
              return cmdWithQuotedPath !== cmdWithRawPath ? cmdWithQuotedPath : cmdWithRawPath;
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
        const appConfig = OPEN_IN_APPS.find((a) => a.id === appId);
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
  ipcMain.handle('app:getAppVersion', () => {
    try {
      // In development, we need to look for package.json in the project root
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
        try {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
          if (packageJson.name === 'emdash' && packageJson.version) {
            return packageJson.version;
          }
        } catch {
          continue;
        }
      }

      // In dev, never use app.getVersion() as it returns Electron version
      if (isDev) {
        return '0.3.46';
      }

      return app.getVersion();
    } catch {
      return '0.3.46'; // Safe fallback
    }
  });
  ipcMain.handle('app:getElectronVersion', () => process.versions.electron);
  ipcMain.handle('app:getPlatform', () => process.platform);
}
