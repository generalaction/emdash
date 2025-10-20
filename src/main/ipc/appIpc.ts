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
    async (_event, args: { app: 'finder' | 'cursor' | 'vscode' | 'terminal'; path: string }) => {
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
              command = `command -v code >/dev/null 2>&1 && code ${quoted(target)} || open -a "Visual Studio Code" ${quoted(target)}`;
              break;
            case 'terminal':
              // Open Terminal app at the target directory
              // This should open a new tab/window with CWD set to target
              command = `open -a Terminal ${quoted(target)}`;
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
              command = `start "" code ${quoted(target)}`;
              break;
            case 'terminal':
              // Prefer Windows Terminal if available, fallback to cmd
              command = `wt -d ${quoted(target)} || start cmd /K "cd /d ${target}"`;
              break;
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
              command = `code ${quoted(target)}`;
              break;
            case 'terminal':
              // Try x-terminal-emulator as a generic launcher
              command = `x-terminal-emulator --working-directory=${quoted(target)} || gnome-terminal --working-directory=${quoted(target)} || konsole --workdir ${quoted(target)}`;
              break;
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
        return { success: false, error: error instanceof Error ? error.message : String(error) };
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
