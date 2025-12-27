import { app, ipcMain, shell } from 'electron';
import { exec } from 'child_process';
import { readFileSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import { ensureProjectPrepared } from '../services/ProjectPrep';
import { getAppSettings } from '../settings';
import { log } from '../lib/logger';

interface ErrnoException extends Error {
  code?: string;
}

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
        app: 'finder' | 'cursor' | 'vscode' | 'terminal' | 'ghostty' | 'zed' | 'iterm2' | 'warp';
        path: string;
        ensureDir?: boolean;
      }
    ) => {
      const target = args?.path;
      const which = args?.app;
      if (!target || typeof target !== 'string' || !which) {
        return { success: false, error: 'Invalid arguments' };
      }

      const resolveHomePath = (value: string) => {
        if (!value.startsWith('~')) return value;
        if (value === '~') return homedir();
        const withoutTilde = value.slice(1).replace(/^[/\\\\]+/, '');
        return join(homedir(), withoutTilde);
      };
      const resolvedTarget = resolve(resolveHomePath(target));
      const ensureDir = args?.ensureDir ?? false;
      try {
        if (ensureDir) {
          try {
            const stats = await fsPromises.stat(resolvedTarget);
            if (!stats.isDirectory()) {
              return {
                success: false,
                error: 'Target exists but is not a directory.',
              };
            }
          } catch (error: unknown) {
            if (error instanceof Error && (error as ErrnoException).code === 'ENOENT') {
              await fsPromises.mkdir(resolvedTarget, { recursive: true });
            } else {
              throw error;
            }
          }
        }

        const platform = process.platform;
        const quoted = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;
        const windowsQuote = (p: string): string => {
          // For cmd.exe, wrap in double quotes and escape internal quotes by doubling
          const escaped = p.replace(/"/g, '""');
          return `"${escaped}"`;
        };

        if (which === 'warp') {
          const urls = [
            `warp://action/new_window?path=${encodeURIComponent(resolvedTarget)}`,
            `warppreview://action/new_window?path=${encodeURIComponent(resolvedTarget)}`,
          ];
          for (const url of urls) {
            try {
              await shell.openExternal(url);
              return { success: true };
            } catch (error) {
              void error;
            }
          }
          return {
            success: false,
            error: 'Warp is not installed or its URI scheme is not registered on this platform.',
          };
        }

        let command = '';
        if (platform === 'darwin') {
          switch (which) {
            case 'finder':
              // Open directory in Finder
              command = `open ${quoted(resolvedTarget)}`;
              break;
            case 'cursor':
              // Prefer CLI when available to ensure the folder opens in-app
              command = `command -v cursor >/dev/null 2>&1 && cursor ${quoted(resolvedTarget)} || open -a "Cursor" ${quoted(resolvedTarget)}`;
              break;
            case 'vscode':
              command = [
                `open -b com.microsoft.VSCode --args ${quoted(resolvedTarget)}`,
                `open -b com.microsoft.VSCodeInsiders --args ${quoted(resolvedTarget)}`,
                `open -a "Visual Studio Code" ${quoted(resolvedTarget)}`,
              ].join(' || ');
              break;
            case 'terminal':
              // Open Terminal app at the target directory
              // This should open a new tab/window with CWD set to target
              command = `open -a Terminal ${quoted(resolvedTarget)}`;
              break;
            case 'iterm2':
              // iTerm2 by bundle id, then by app name
              command = [
                `open -b com.googlecode.iterm2 ${quoted(resolvedTarget)}`,
                `open -a "iTerm" ${quoted(resolvedTarget)}`,
                `open -a "iTerm2" ${quoted(resolvedTarget)}`,
              ].join(' || ');
              break;
            case 'ghostty':
              // On macOS, Ghostty's `working-directory` config can be overridden by
              // existing windows/tabs; opening the folder directly is the most reliable.
              command = [
                `open -b com.mitchellh.ghostty ${quoted(resolvedTarget)}`,
                `open -a "Ghostty" ${quoted(resolvedTarget)}`,
              ].join(' || ');
              break;
            case 'zed':
              command = `command -v zed >/dev/null 2>&1 && zed ${quoted(resolvedTarget)} || open -a "Zed" ${quoted(resolvedTarget)}`;
              break;
          }
        } else if (platform === 'win32') {
          switch (which) {
            case 'finder':
              command = `explorer ${windowsQuote(resolvedTarget)}`;
              break;
            case 'cursor':
              command = `start "" cursor ${windowsQuote(resolvedTarget)}`;
              break;
            case 'vscode':
              command = `start "" code ${windowsQuote(resolvedTarget)} || start "" code-insiders ${windowsQuote(resolvedTarget)}`;
              break;
            case 'terminal':
              command = `wt -d ${windowsQuote(resolvedTarget)} || start "" cmd /K "cd /d ${windowsQuote(resolvedTarget)}"`;
              break;
            case 'ghostty':
            case 'zed':
              return { success: false, error: `${which} is not supported on Windows` };
          }
        } else {
          switch (which) {
            case 'finder':
              command = `xdg-open ${quoted(resolvedTarget)}`;
              break;
            case 'cursor':
              command = `cursor ${quoted(resolvedTarget)}`;
              break;
            case 'vscode':
              command = `code ${quoted(resolvedTarget)} || code-insiders ${quoted(resolvedTarget)}`;
              break;
            case 'terminal':
              command = `x-terminal-emulator --working-directory=${quoted(resolvedTarget)} || gnome-terminal --working-directory=${quoted(resolvedTarget)} || konsole --workdir ${quoted(resolvedTarget)}`;
              break;
            case 'ghostty':
              command = `ghostty --working-directory=${quoted(resolvedTarget)} || x-terminal-emulator --working-directory=${quoted(resolvedTarget)}`;
              break;
            case 'zed':
              command = `zed ${quoted(resolvedTarget)} || xdg-open ${quoted(resolvedTarget)}`;
              break;
            case 'iterm2':
              return { success: false, error: 'iTerm2 is only available on macOS' };
          }
        }

        if (!command) {
          return { success: false, error: 'Unsupported platform or app' };
        }

        if (which === 'cursor' || which === 'vscode' || which === 'zed') {
          try {
            const settings = getAppSettings();
            if (settings?.projectPrep?.autoInstallOnOpenInEditor) {
              void ensureProjectPrepared(resolvedTarget).catch(() => {});
            }
          } catch (error) {
            log.error('Failed to check autoInstallOnOpenInEditor setting', error);
          }
        }

        await new Promise<void>((resolve, reject) => {
          exec(command, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
        return { success: true };
      } catch (error) {
        const pretty =
          which === 'ghostty'
            ? 'Ghostty'
            : which === 'zed'
              ? 'Zed'
              : which === 'iterm2'
                ? 'iTerm2'
                : which === 'warp'
                  ? 'Warp'
                  : which.toString();
        // Return short, friendly copy instead of the full command output
        let msg = `Unable to open in ${pretty}`;
        if (which === 'ghostty')
          msg = 'Ghostty is not installed or not available on this platform.';
        if (which === 'zed') msg = 'Zed is not installed or not available on this platform.';
        if (which === 'iterm2') msg = 'iTerm2 is not installed or not available on this platform.';
        if (which === 'warp')
          msg = 'Warp is not installed or its URI scheme is not registered on this platform.';
        return { success: false, error: msg };
      }
    }
  );

  // App metadata
  ipcMain.handle('app:getAppVersion', () => {
    try {
      // Try multiple possible paths for package.json
      const possiblePaths = [
        join(__dirname, '../../package.json'), // from dist/main/ipc
        join(__dirname, '../../../package.json'), // alternative path
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
      return app.getVersion();
    } catch {
      return app.getVersion();
    }
  });
  ipcMain.handle('app:getElectronVersion', () => process.versions.electron);
  ipcMain.handle('app:getPlatform', () => process.platform);
}
