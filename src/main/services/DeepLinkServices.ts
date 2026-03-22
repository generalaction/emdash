import { log } from '../lib/logger';
import { GitHubService } from './GitHubService';
import { databaseService } from './DatabaseService';
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { getAppSettings } from '../settings';

const PROTOCOL = 'emdash-github';

export class DeepLinkService {
  private githubService = new GitHubService();

  // parse quick link

  parseQuickLink(url: string): { owner: string; repo: string } | null {
    const match = url.match(new RegExp(`^${PROTOCOL}://([^/]+)/([^/]+?)(?:/.*)?$`));
    if (match) {
      return { owner: match[1], repo: match[2] };
    }

    return null;
  }

  buildGitHubUrl(owner: string, repo: string): string {
    return `https://github.com/${owner}/${repo}`;
  }

  // find whether the project already exist

  async findExistingProject(owner: string, repo: string): Promise<string | null> {
    try {
      const projects = await databaseService.getProjects();
      const githubUrl = this.buildGitHubUrl(owner, repo).toLowerCase();
      const project = projects.find((p) => {
        const remote = (p.gitInfo as any)?.remote || '';
        return remote.toLowerCase().replace(/\.git$/, '') === githubUrl;
      });
      return project?.path ?? null;
    } catch {
      return null;
    }
  }

  // handle quicklink

  async handleQuickLink(
    url: string
  ): Promise<{ success: boolean; projectPath?: string; error?: string }> {
    const parsed = this.parseQuickLink(url);
    if (!parsed) {
      return {
        success: false,
        error: 'Invalid quick link format. Expected: emdash-github://owner/repo',
      };
    }

    const { owner, repo } = parsed;
    const repoUrl = this.buildGitHubUrl(owner, repo);

    log.info(`[DeepLink] Opening ${owner}/${repo}...`);

    const existingPath = await this.findExistingProject(owner, repo);
    if (existingPath) {
      log.info(`[DeepLink] Repo already exists at ${existingPath}`);
      this.focusWindow();
      this.sendToRenderer('deep-link:open-project', { projectPath: existingPath });
      return { success: true, projectPath: existingPath };
    }

    this.focusWindow();
    this.sendToRenderer('deep-link:clone', { owner, repo, repoUrl });
    return { success: true };
  }

  async cloneAndOpenProject(
    owner: string,
    repo: string,
    repoUrl: string
  ): Promise<{ success: boolean; projectPath?: string; error?: string }> {
    const settings = getAppSettings();
    const projectDir =
      settings.projects?.defaultDirectory || path.join(app.getPath('home'), 'emdash-projects');
    const localPath = path.join(projectDir, repo);

    const cloneResult = await this.githubService.cloneRepository(repoUrl, localPath);
    if (!cloneResult.success) {
      return { success: false, error: cloneResult.error || 'Clone failed' };
    }

    this.sendToRenderer('deep-link:project-cloned', { projectPath: localPath });
    return { success: true, projectPath: localPath };
  }

  private focusWindow() {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  }

  private sendToRenderer(channel: string, data: any) {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, data);
    }
  }
}
