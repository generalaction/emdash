import { app, ipcMain, shell } from 'electron';
import { exec } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ensureProjectPrepared } from '../services/ProjectPrep';
import { getAppSettings } from '../settings';

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
      }
    ) => {
      const target = args?.path;
      const which = args?.app;
      if (!target || typeof target !== 'string' || !which) {
        return { success: false, error: 'Invalid arguments' };
      }
      try {
        const platform = process.platform;
        const quoted = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;

        if (which === 'warp') {
          const urls = [
            `warp://action/new_window?path=${encodeURIComponent(target)}`,
            `warppreview://action/new_window?path=${encodeURIComponent(target)}`,
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
              command = `open ${quoted(target)}`;
              break;
            case 'cursor':
              // Prefer CLI when available to ensure the folder opens in-app
              command = `command -v cursor >/dev/null 2>&1 && cursor ${quoted(target)} || open -a "Cursor" ${quoted(target)}`;
              break;
            case 'vscode':
              command = [
                `open -b com.microsoft.VSCode --args ${quoted(target)}`,
                `open -b com.microsoft.VSCodeInsiders --args ${quoted(target)}`,
                `open -a "Visual Studio Code" ${quoted(target)}`,
              ].join(' || ');
              break;
            case 'terminal':
              // Open Terminal app at the target directory
              // This should open a new tab/window with CWD set to target
              command = `open -a Terminal ${quoted(target)}`;
              break;
            case 'iterm2':
              // iTerm2 by bundle id, then by app name
              command = [
                `open -b com.googlecode.iterm2 ${quoted(target)}`,
                `open -a "iTerm" ${quoted(target)}`,
                `open -a "iTerm2" ${quoted(target)}`,
              ].join(' || ');
              break;
            case 'ghostty':
              // On macOS, Ghostty's `working-directory` config can be overridden by
              // existing windows/tabs; opening the folder directly is the most reliable.
              command = [
                `open -b com.mitchellh.ghostty ${quoted(target)}`,
                `open -a "Ghostty" ${quoted(target)}`,
              ].join(' || ');
              break;
            case 'zed':
              command = `command -v zed >/dev/null 2>&1 && zed ${quoted(target)} || open -a "Zed" ${quoted(target)}`;
              break;
          }
        } else if (platform === 'win32') {
          switch (which) {
            case 'finder':
              command = `explorer ${quoted(target)}`;
              break;
            case 'cursor':
              command = `start "" cursor ${quoted(target)}`;
              break;
            case 'vscode':
              command = `start "" code ${quoted(target)} || start "" code-insiders ${quoted(target)}`;
              break;
            case 'terminal':
              command = `wt -d ${quoted(target)} || start cmd /K "cd /d ${target}"`;
              break;
            case 'ghostty':
            case 'zed':
              return { success: false, error: `${which} is not supported on Windows` } as any;
          }
        } else {
          switch (which) {
            case 'finder':
              command = `xdg-open ${quoted(target)}`;
              break;
            case 'cursor':
              command = `cursor ${quoted(target)}`;
              break;
            case 'vscode':
              command = `code ${quoted(target)} || code-insiders ${quoted(target)}`;
              break;
            case 'terminal':
              command = `x-terminal-emulator --working-directory=${quoted(target)} || gnome-terminal --working-directory=${quoted(target)} || konsole --workdir ${quoted(target)}`;
              break;
            case 'ghostty':
              command = `ghostty --working-directory=${quoted(target)} || x-terminal-emulator --working-directory=${quoted(target)}`;
              break;
            case 'zed':
              command = `zed ${quoted(target)} || xdg-open ${quoted(target)}`;
              break;
            case 'iterm2':
              return { success: false, error: 'iTerm2 is only available on macOS' } as any;
          }
        }

        if (!command) {
          return { success: false, error: 'Unsupported platform or app' };
        }

        if (which === 'cursor' || which === 'vscode' || which === 'zed') {
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
