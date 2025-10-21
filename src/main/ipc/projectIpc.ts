import { ipcMain, dialog } from 'electron';
import { join } from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getMainWindow } from '../app/window';

const execAsync = promisify(exec);

export function registerProjectIpc() {
  // Project management
  ipcMain.handle('project:open', async () => {
    try {
      const result = await dialog.showOpenDialog(getMainWindow()!, {
        title: 'Open Project',
        properties: ['openDirectory'],
        message: 'Select a project directory to open',
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, error: 'No directory selected' };
      }

      const projectPath = result.filePaths[0];
      return { success: true, path: projectPath };
    } catch (error) {
      console.error('Failed to open project:', error);
      return { success: false, error: 'Failed to open project directory' };
    }
  });

  ipcMain.handle('git:getInfo', async (_, projectPath: string) => {
    try {
      const resolveRealPath = async (target: string) => {
        try {
          return await fs.promises.realpath(target);
        } catch {
          return target;
        }
      };

      const resolvedProjectPath = await resolveRealPath(projectPath);
      const gitPath = join(resolvedProjectPath, '.git');
      const isGitRepo = fs.existsSync(gitPath);

      if (!isGitRepo) {
        return { isGitRepo: false, path: resolvedProjectPath };
      }

      // Get remote URL
      let remote: string | null = null;
      try {
        const { stdout } = await execAsync('git remote get-url origin', { cwd: resolvedProjectPath });
        remote = stdout.trim();
      } catch {}

      // Get current branch
      let branch: string | null = null;
      try {
        const { stdout } = await execAsync('git branch --show-current', { cwd: resolvedProjectPath });
        branch = stdout.trim();
      } catch {}

      let rootPath: string | null = null;
      try {
        const { stdout } = await execAsync('git rev-parse --show-toplevel', {
          cwd: resolvedProjectPath,
        });
        const trimmed = stdout.trim();
        if (trimmed) {
          rootPath = await resolveRealPath(trimmed);
        }
      } catch {}

      return {
        isGitRepo: true,
        remote,
        branch,
        path: resolvedProjectPath,
        rootPath: rootPath || resolvedProjectPath,
      };
    } catch (error) {
      console.error('Failed to get Git info:', error);
      return { isGitRepo: false, error: 'Failed to read Git information', path: projectPath };
    }
  });
}
