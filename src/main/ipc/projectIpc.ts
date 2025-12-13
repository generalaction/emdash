import { app, ipcMain, dialog } from 'electron';
import { join } from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getMainWindow } from '../app/window';

const execAsync = promisify(exec);
const DEFAULT_REMOTE = 'origin';
const DEFAULT_BRANCH = 'main';

const normalizeRemoteName = (remote?: string | null) => {
  if (!remote) return DEFAULT_REMOTE;
  const trimmed = remote.trim();
  if (!trimmed) return DEFAULT_REMOTE;
  if (/^[A-Za-z0-9._-]+$/.test(trimmed) && !trimmed.includes('://')) {
    return trimmed;
  }
  return DEFAULT_REMOTE;
};

const computeBaseRef = (remote?: string | null, branch?: string | null) => {
  const remoteName = normalizeRemoteName(remote);
  if (branch && branch.trim().length > 0) {
    const trimmed = branch.trim();
    if (trimmed.includes('/')) return trimmed;
    return `${remoteName}/${trimmed}`;
  }
  return `${remoteName}/${DEFAULT_BRANCH}`;
};

const detectDefaultBranch = async (projectPath: string, remote?: string | null) => {
  const remoteName = normalizeRemoteName(remote);
  try {
    const { stdout } = await execAsync(`git remote show ${remoteName}`, {
      cwd: projectPath,
    });
    const match = stdout.match(/HEAD branch:\s*(\S+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
};

export function registerProjectIpc() {
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

  ipcMain.handle('project:clone', async (_, repoUrl: string, repoName?: string, customDestination?: string) => {
    try {
      const defaultCloneDir = join(app.getPath('home'), 'Emdash');
      const parentDir = customDestination || defaultCloneDir;

      // Ensure the emdash directory exists
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      const clonePath = join(parentDir, repoName || repoUrl.split('/').pop()?.replace('.git', '') || 'repository');

      // Clone the repository directly
      await execAsync(`git clone "${repoUrl}" "${clonePath}"`);

      return { success: true, path: clonePath };
    } catch (error) {
      console.error('Failed to clone project:', error);
      return { success: false, error: 'Failed to clone repository' };
    }
  });

  ipcMain.handle('project:selectCloneDestination', async () => {
    try {
      const result = await dialog.showOpenDialog(getMainWindow()!, {
        title: 'Select Clone Destination',
        properties: ['openDirectory', 'createDirectory'],
        message: 'Select where to clone the repository',
        defaultPath: join(app.getPath('home'), 'Emdash'),
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
      }

      return { success: true, path: result.filePaths[0] };
    } catch (error) {
      console.error('Failed to select clone destination:', error);
      return { success: false, error: 'Failed to select directory' };
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
        const { stdout } = await execAsync('git remote get-url origin', {
          cwd: resolvedProjectPath,
        });
        remote = stdout.trim();
      } catch {}

      // Get current branch
      let branch: string | null = null;
      try {
        const { stdout } = await execAsync('git branch --show-current', {
          cwd: resolvedProjectPath,
        });
        branch = stdout.trim();
      } catch {}

      let defaultBranch: string | null = null;
      if (!branch) {
        defaultBranch = await detectDefaultBranch(resolvedProjectPath, remote);
      }

      let upstream: string | null = null;
      let aheadCount: number | null = null;
      let behindCount: number | null = null;
      try {
        const { stdout } = await execAsync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', {
          cwd: resolvedProjectPath,
        });
        upstream = stdout.trim();
      } catch {}

      if (upstream) {
        try {
          const { stdout } = await execAsync('git rev-list --left-right --count HEAD...@{u}', {
            cwd: resolvedProjectPath,
          });
          const [ahead, behind] = stdout.trim().split(/\s+/);
          aheadCount = Number.parseInt(ahead, 10);
          behindCount = Number.parseInt(behind, 10);
        } catch {}
      }

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

      const baseRef = computeBaseRef(remote, branch || defaultBranch);

      const safeAhead =
        typeof aheadCount === 'number' && Number.isFinite(aheadCount) ? aheadCount : undefined;
      const safeBehind =
        typeof behindCount === 'number' && Number.isFinite(behindCount) ? behindCount : undefined;

      return {
        isGitRepo: true,
        remote,
        branch,
        baseRef,
        upstream,
        aheadCount: safeAhead,
        behindCount: safeBehind,
        path: resolvedProjectPath,
        rootPath: rootPath || resolvedProjectPath,
      };
    } catch (error) {
      console.error('Failed to get Git info:', error);
      return { isGitRepo: false, error: 'Failed to read Git information', path: projectPath };
    }
  });
}
