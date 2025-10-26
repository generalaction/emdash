import { app, ipcMain, shell } from 'electron';
import { exec } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

export function registerAppIpc() {
  // Open external links in default browser
  ipcMain.handle('app:openExternal', async (_event, url: string) => {
    try {
      if (!url || typeof url !== 'string') throw new Error('Invalid URL');
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Open a filesystem path in a specific application (Finder/Cursor/VS Code/Terminal)
  ipcMain.handle(
    'app:openIn',
    async (
      _event,
      args: {
        app: 'finder' | 'cursor' | 'vscode' | 'terminal' | 'ghostty' | 'zed' | 'iterm2';
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
              // Try CLI first, then open by bundle id (handles non-standard app name/locations),
              // then fall back to app name, and finally VS Code Insiders.
              command = [
                `command -v code >/dev/null 2>&1 && code ${quoted(target)}`,
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
              // Prefer ghostty CLI when available; otherwise use open -a with args
              command = `command -v ghostty >/dev/null 2>&1 && ghostty --working-directory ${quoted(target)} || open -a "Ghostty" --args --working-directory ${quoted(target)}`;
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
              // Cursor installer usually adds to PATH; fallback to app path is omitted
              command = `start "" cursor ${quoted(target)}`;
              break;
            case 'vscode':
              // Try stable CLI, then Insiders CLI
              command = `start "" code ${quoted(target)} || start "" code-insiders ${quoted(target)}`;
              break;
            case 'terminal':
              // Prefer Windows Terminal if available, fallback to cmd
              command = `wt -d ${quoted(target)} || start cmd /K "cd /d ${target}"`;
              break;
            case 'ghostty':
            case 'zed':
              return { success: false, error: `${which} is not supported on Windows` } as any;
          }
        } else {
          // linux and others
          switch (which) {
            case 'finder':
              command = `xdg-open ${quoted(target)}`;
              break;
            case 'cursor':
              command = `cursor ${quoted(target)}`;
              break;
            case 'vscode':
              // Try stable CLI, then Insiders CLI
              command = `code ${quoted(target)} || code-insiders ${quoted(target)}`;
              break;
            case 'terminal':
              // Try x-terminal-emulator as a generic launcher
              command = `x-terminal-emulator --working-directory=${quoted(target)} || gnome-terminal --working-directory=${quoted(target)} || konsole --workdir ${quoted(target)}`;
              break;
            case 'ghostty':
              command = `ghostty --working-directory ${quoted(target)} || x-terminal-emulator --working-directory=${quoted(target)}`;
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
                : which.toString();
        // Return short, friendly copy instead of the full command output
        let msg = `Unable to open in ${pretty}`;
        if (which === 'ghostty')
          msg = 'Ghostty is not installed or not available on this platform.';
        if (which === 'zed') msg = 'Zed is not installed or not available on this platform.';
        if (which === 'iterm2') msg = 'iTerm2 is not installed or not available on this platform.';
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
