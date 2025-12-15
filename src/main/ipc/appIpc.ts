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
        const quotedPosix = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;
        const quotedWin = (p: string) => `"${p.replace(/"/g, '""')}"`;

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
              command = `open ${quotedPosix(target)}`;
              break;
            case 'cursor':
              // Prefer CLI when available to ensure the folder opens in-app
              command = `command -v cursor >/dev/null 2>&1 && cursor ${quotedPosix(target)} || open -a "Cursor" ${quotedPosix(target)}`;
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
              command = `open -a Terminal ${quotedPosix(target)}`;
              break;
            case 'iterm2':
              // iTerm2 by bundle id, then by app name
              command = [
                `open -b com.googlecode.iterm2 ${quotedPosix(target)}`,
                `open -a "iTerm" ${quotedPosix(target)}`,
                `open -a "iTerm2" ${quotedPosix(target)}`,
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
              command = `command -v zed >/dev/null 2>&1 && zed ${quotedPosix(target)} || open -a "Zed" ${quotedPosix(target)}`;
              break;
          }
        } else if (platform === 'win32') {
          switch (which) {
            case 'finder':
              command = `explorer ${quotedWin(target)}`;
              break;
            case 'cursor':
              command = `start "" cursor ${quotedWin(target)}`;
              break;
            case 'vscode':
              command = `start "" code ${quotedWin(target)} || start "" code-insiders ${quotedWin(target)}`;
              break;
            case 'terminal':
              command = `wt -d ${quotedWin(target)} || start cmd /K "cd /d ${quotedWin(target)}"`;
              break;
            case 'ghostty':
            case 'zed':
              return { success: false, error: `${which} is not supported on Windows` } as any;
          }
        } else {
          // Linux: use proper quoting for shell commands
          switch (which) {
            case 'finder':
              command = `xdg-open ${quotedPosix(target)}`;
              break;
            case 'cursor':
              command = `cursor ${quotedPosix(target)}`;
              break;
            case 'vscode':
              command = `code ${quotedPosix(target)} || code-insiders ${quotedPosix(target)}`;
              break;
            case 'terminal':
              command = `x-terminal-emulator --working-directory=${quotedPosix(target)} || gnome-terminal --working-directory=${quotedPosix(target)} || konsole --workdir ${quotedPosix(target)}`;
              break;
            case 'ghostty':
              command = `ghostty --working-directory=${quoted(target)} || x-terminal-emulator --working-directory=${quoted(target)}`;
              break;
            case 'zed':
              command = `zed ${quotedPosix(target)} || xdg-open ${quotedPosix(target)}`;
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
      const readVersion = (packageJsonPath: string) => {
        try {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
          if (packageJson.name === 'emdash' && packageJson.version) {
            return packageJson.version as string;
          }
        } catch {
          // ignore parse/fs errors and continue
        }
        return null;
      };

      // Walk upward from a base directory to find package.json (helps in dev where the
      // compiled code lives in dist/main/main/**).
      const collectCandidates = (base: string | undefined, maxDepth = 6) => {
        if (!base) return [];
        const paths: string[] = [];
        let current = base;
        for (let i = 0; i < maxDepth; i++) {
          paths.push(join(current, 'package.json'));
          const parent = join(current, '..');
          if (parent === current) break;
          current = parent;
        }
        return paths;
      };

      const possiblePaths = [
        ...collectCandidates(__dirname),
        ...collectCandidates(app.getAppPath()),
        join(process.cwd(), 'package.json'),
      ];

      for (const packageJsonPath of possiblePaths) {
        const version = readVersion(packageJsonPath);
        if (version) return version;
      }
      return app.getVersion();
    } catch {
      return app.getVersion();
    }
  });
  ipcMain.handle('app:getElectronVersion', () => process.versions.electron);
  ipcMain.handle('app:getPlatform', () => process.platform);
}
