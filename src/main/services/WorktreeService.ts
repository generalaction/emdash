import { execFile } from 'child_process';
import { log } from '../lib/logger';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { projectSettingsService } from './ProjectSettingsService';

type BaseRefInfo = { remote: string; branch: string; fullRef: string };

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  id: string;
  name: string;
  branch: string;
  path: string;
  projectId: string;
  status: 'active' | 'paused' | 'completed' | 'error';
  createdAt: string;
  lastActivity?: string;
}

export class WorktreeService {
  private worktrees = new Map<string, WorktreeInfo>();

  /**
   * Slugify workspace name to make it shell-safe
   */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Generate a stable ID from the absolute worktree path.
   */
  private stableIdFromPath(worktreePath: string): string {
    const abs = path.resolve(worktreePath);
    const h = crypto.createHash('sha1').update(abs).digest('hex').slice(0, 12);
    return `wt-${h}`;
  }

  /**
   * Create a new Git worktree for an agent workspace
   */
  async createWorktree(
    projectPath: string,
    workspaceName: string,
    projectId: string
  ): Promise<WorktreeInfo> {
    try {
      const sluggedName = this.slugify(workspaceName);
      const timestamp = Date.now();
      const { getAppSettings } = await import('../settings');
      const settings = getAppSettings();
      const template = settings?.repository?.branchTemplate || 'agent/{slug}-{timestamp}';
      const branchName = this.renderBranchNameTemplate(template, {
        slug: sluggedName,
        timestamp: String(timestamp),
      });
      const worktreePath = path.join(projectPath, '..', `worktrees/${sluggedName}-${timestamp}`);
      const worktreeId = this.stableIdFromPath(worktreePath);

      log.info(`Creating worktree: ${branchName} -> ${worktreePath}`);

      // Check if worktree path already exists
      if (fs.existsSync(worktreePath)) {
        throw new Error(`Worktree directory already exists: ${worktreePath}`);
      }

      // Ensure worktrees directory exists
      const worktreesDir = path.dirname(worktreePath);
      if (!fs.existsSync(worktreesDir)) {
        fs.mkdirSync(worktreesDir, { recursive: true });
      }

      const baseRefInfo = await this.resolveProjectBaseRef(projectPath, projectId);
      const fetchedBaseRef = await this.fetchBaseRefWithFallback(
        projectPath,
        projectId,
        baseRefInfo
      );

      // Create the worktree
      const { stdout, stderr } = await execFileAsync(
        'git',
        ['worktree', 'add', '-b', branchName, worktreePath, fetchedBaseRef.fullRef],
        { cwd: projectPath }
      );

      log.debug('Git worktree stdout:', stdout);
      log.debug('Git worktree stderr:', stderr);

      // Verify the worktree was actually created
      if (!fs.existsSync(worktreePath)) {
        throw new Error(`Worktree directory was not created: ${worktreePath}`);
      }

      // Ensure codex logs are ignored in this worktree
      this.ensureCodexLogIgnored(worktreePath);

      const worktreeInfo: WorktreeInfo = {
        id: worktreeId,
        name: workspaceName,
        branch: branchName,
        path: worktreePath,
        projectId,
        status: 'active',
        createdAt: new Date().toISOString(),
      };

      this.worktrees.set(worktreeInfo.id, worktreeInfo);

      log.info(`Created worktree: ${workspaceName} -> ${branchName}`);

      // Push the new branch to origin and set upstream so PRs work out of the box
      if (settings?.repository?.pushOnCreate !== false) {
        try {
          await execFileAsync('git', ['push', '--set-upstream', 'origin', branchName], {
            cwd: worktreePath,
          });
          log.info(`Pushed branch ${branchName} to origin with upstream tracking`);
        } catch (pushErr) {
          log.warn('Initial push of worktree branch failed:', pushErr as any);
          // Don't fail worktree creation if push fails - user can push manually later
        }
      }

      return worktreeInfo;
    } catch (error) {
      log.error('Failed to create worktree:', error);
      throw new Error(`Failed to create worktree: ${error}`);
    }
  }

  async fetchLatestBaseRef(projectPath: string, projectId: string): Promise<BaseRefInfo> {
    const baseRefInfo = await this.resolveProjectBaseRef(projectPath, projectId);
    const fetched = await this.fetchBaseRefWithFallback(projectPath, projectId, baseRefInfo);
    return fetched;
  }

  /**
   * List all worktrees for a project
   */
  async listWorktrees(projectPath: string): Promise<WorktreeInfo[]> {
    try {
      const { stdout } = await execFileAsync('git', ['worktree', 'list'], {
        cwd: projectPath,
      });

      const worktrees: WorktreeInfo[] = [];
      const lines = stdout.trim().split('\n');
      // Compute managed prefixes based on configured template
      let managedPrefixes: string[] = ['agent', 'pr', 'orch'];
      try {
        const { getAppSettings } = await import('../settings');
        const settings = getAppSettings();
        const p = this.extractTemplatePrefix(settings?.repository?.branchTemplate);
        if (p) managedPrefixes = Array.from(new Set([p, ...managedPrefixes]));
      } catch {}

      for (const line of lines) {
        if (line.includes('[') && line.includes(']')) {
          const parts = line.split(/\s+/);
          const worktreePath = parts[0];
          const branchMatch = line.match(/\[([^\]]+)\]/);
          const branch = branchMatch ? branchMatch[1] : 'unknown';

          const managedBranch = managedPrefixes.some((pf) => {
            return (
              branch.startsWith(pf + '/') ||
              branch.startsWith(pf + '-') ||
              branch.startsWith(pf + '_') ||
              branch.startsWith(pf + '.') ||
              branch === pf
            );
          });

          if (!managedBranch) {
            const tracked = Array.from(this.worktrees.values()).find(
              (wt) => wt.path === worktreePath
            );
            if (!tracked) continue;
          }

          const existing = Array.from(this.worktrees.values()).find(
            (wt) => wt.path === worktreePath
          );

          worktrees.push(
            existing ?? {
              id: this.stableIdFromPath(worktreePath),
              name: path.basename(worktreePath),
              branch,
              path: worktreePath,
              projectId: path.basename(projectPath),
              status: 'active',
              createdAt: new Date().toISOString(),
            }
          );
        }
      }

      return worktrees;
    } catch (error) {
      log.error('Failed to list worktrees:', error);
      return [];
    }
  }

  /**
   * Render a branch name from a user-configurable template.
   * Supported placeholders: {slug}, {timestamp}
   */
  private renderBranchNameTemplate(
    template: string,
    ctx: { slug: string; timestamp: string }
  ): string {
    const replaced = template
      .replace(/\{slug\}/g, ctx.slug)
      .replace(/\{timestamp\}/g, ctx.timestamp);
    return this.sanitizeBranchName(replaced);
  }

  /**
   * Best-effort sanitization to ensure the branch name is a valid ref.
   */
  private sanitizeBranchName(name: string): string {
    // Disallow illegal characters for Git refs, keep common allowed set including '/','-','_','.'
    let n = name
      .replace(/\s+/g, '-')
      .replace(/[^A-Za-z0-9._\/-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/\/+/g, '/');
    // No leading or trailing separators or dots
    n = n.replace(/^[./-]+/, '').replace(/[./-]+$/, '');
    // Avoid reserved ref names
    if (!n || n === 'HEAD') {
      n = `agent/${this.slugify('workspace')}-${Date.now()}`;
    }
    return n;
  }

  /**
   * Extract a stable prefix from the user template, if any, prior to the first placeholder.
   * E.g. 'agent/{slug}-{timestamp}' -> 'agent'
   */
  private extractTemplatePrefix(template?: string): string | null {
    if (!template || typeof template !== 'string') return null;
    const idx = template.indexOf('{');
    const head = (idx >= 0 ? template.slice(0, idx) : template).trim();
    const cleaned = head.replace(/\s+/g, '');
    if (!cleaned) return null;
    // If there's a slash in the head, take the segment before the first slash
    const seg = cleaned
      .split('/')[0]
      ?.replace(/^[./-]+/, '')
      .replace(/[./-]+$/, '');
    return seg || null;
  }

  /**
   * Remove a worktree
   */
  async removeWorktree(
    projectPath: string,
    worktreeId: string,
    worktreePath?: string,
    branch?: string
  ): Promise<void> {
    try {
      let worktree = this.worktrees.get(worktreeId);

      let pathToRemove = worktree?.path ?? worktreePath;
      let branchToDelete = worktree?.branch ?? branch;

      if (!pathToRemove) {
        throw new Error('Worktree path not provided');
      }

      // Remove the worktree directory via git first
      try {
        // Use --force to remove even when there are untracked/modified files
        await execFileAsync('git', ['worktree', 'remove', '--force', pathToRemove], {
          cwd: projectPath,
        });
      } catch (gitError) {
        console.warn('git worktree remove failed, attempting filesystem cleanup', gitError);
      }

      // Best-effort prune to clear any stale worktree metadata that can keep a branch "checked out"
      try {
        await execFileAsync('git', ['worktree', 'prune', '--verbose'], { cwd: projectPath });
      } catch (pruneErr) {
        console.warn('git worktree prune failed (continuing):', pruneErr);
      }

      // Ensure directory is removed even if git command failed
      if (fs.existsSync(pathToRemove)) {
        try {
          await fs.promises.rm(pathToRemove, { recursive: true, force: true });
        } catch (rmErr: any) {
          // Handle permission issues by making files writable, then retry
          if (rmErr && (rmErr.code === 'EACCES' || rmErr.code === 'EPERM')) {
            try {
              if (process.platform === 'win32') {
                // Remove read-only attribute recursively on Windows
                await execFileAsync('cmd', [
                  '/c',
                  'attrib',
                  '-R',
                  '/S',
                  '/D',
                  pathToRemove + '\\*',
                ]);
              } else {
                // Make everything writable on POSIX
                await execFileAsync('chmod', ['-R', 'u+w', pathToRemove]);
              }
            } catch (permErr) {
              console.warn('Failed to adjust permissions for worktree cleanup:', permErr);
            }
            // Retry removal once after permissions adjusted
            await fs.promises.rm(pathToRemove, { recursive: true, force: true });
          } else {
            throw rmErr;
          }
        }
      }

      if (branchToDelete) {
        const tryDeleteBranch = async () =>
          await execFileAsync('git', ['branch', '-D', branchToDelete!], { cwd: projectPath });
        try {
          await tryDeleteBranch();
        } catch (branchError: any) {
          const msg = String(branchError?.stderr || branchError?.message || branchError);
          // If git thinks the branch is still checked out in a (now removed) worktree,
          // prune and retry once more.
          if (/checked out at /.test(msg)) {
            try {
              await execFileAsync('git', ['worktree', 'prune', '--verbose'], { cwd: projectPath });
              await tryDeleteBranch();
            } catch (retryErr) {
              console.warn(`Failed to delete branch ${branchToDelete} after prune:`, retryErr);
            }
          } else {
            console.warn(`Failed to delete branch ${branchToDelete}:`, branchError);
          }
        }
      }

      if (worktree) {
        this.worktrees.delete(worktreeId);
        log.info(`Removed worktree: ${worktree.name}`);
      } else {
        log.info(`Removed worktree ${worktreeId}`);
      }
    } catch (error) {
      log.error('Failed to remove worktree:', error);
      throw new Error(`Failed to remove worktree: ${error}`);
    }
  }

  /**
   * Get worktree status and changes
   */
  async getWorktreeStatus(worktreePath: string): Promise<{
    hasChanges: boolean;
    stagedFiles: string[];
    unstagedFiles: string[];
    untrackedFiles: string[];
  }> {
    try {
      const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], {
        cwd: worktreePath,
      });

      const stagedFiles: string[] = [];
      const unstagedFiles: string[] = [];
      const untrackedFiles: string[] = [];

      const lines = status
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);

      for (const line of lines) {
        const status = line.substring(0, 2);
        const file = line.substring(3);

        if (status.includes('A') || status.includes('M') || status.includes('D')) {
          stagedFiles.push(file);
        }
        if (status.includes('M') || status.includes('D')) {
          unstagedFiles.push(file);
        }
        if (status.includes('??')) {
          untrackedFiles.push(file);
        }
      }

      return {
        hasChanges: stagedFiles.length > 0 || unstagedFiles.length > 0 || untrackedFiles.length > 0,
        stagedFiles,
        unstagedFiles,
        untrackedFiles,
      };
    } catch (error) {
      log.error('Failed to get worktree status:', error);
      return {
        hasChanges: false,
        stagedFiles: [],
        unstagedFiles: [],
        untrackedFiles: [],
      };
    }
  }

  /**
   * Get the default branch of a repository
   */
  private async getDefaultBranch(projectPath: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync('git', ['remote', 'show', 'origin'], {
        cwd: projectPath,
      });
      const match = stdout.match(/HEAD branch:\s*(\S+)/);
      return match ? match[1] : 'main';
    } catch {
      return 'main';
    }
  }

  private parseBaseRef(ref?: string | null): BaseRefInfo | null {
    if (!ref) return null;
    const cleaned = ref
      .trim()
      .replace(/^refs\/remotes\//, '')
      .replace(/^remotes\//, '');
    if (!cleaned) return null;
    const [remote, ...rest] = cleaned.split('/');
    if (!remote || rest.length === 0) return null;
    const branch = rest.join('/');
    if (!branch) return null;
    return { remote, branch, fullRef: `${remote}/${branch}` };
  }

  private async resolveProjectBaseRef(projectPath: string, projectId: string): Promise<BaseRefInfo> {
    const settings = await projectSettingsService.getProjectSettings(projectId);
    if (!settings) {
      throw new Error(
        'Project settings not found. Please re-open the project in emdash and try again.'
      );
    }

    const parsed = this.parseBaseRef(settings.baseRef);
    if (parsed) {
      return parsed;
    }

    const fallbackRemote = 'origin';
    const fallbackBranch =
      settings.gitBranch?.trim() && !settings.gitBranch.includes(' ')
        ? settings.gitBranch.trim()
        : await this.getDefaultBranch(projectPath);
    const branch = fallbackBranch || 'main';
    return {
      remote: fallbackRemote,
      branch,
      fullRef: `${fallbackRemote}/${branch}`,
    };
  }

  private async buildDefaultBaseRef(projectPath: string): Promise<BaseRefInfo> {
    const remote = 'origin';
    const branch = await this.getDefaultBranch(projectPath);
    const cleanBranch = branch?.trim() || 'main';
    return { remote, branch: cleanBranch, fullRef: `${remote}/${cleanBranch}` };
  }

  private extractErrorMessage(error: any): string {
    if (!error) return '';
    const parts: Array<string | undefined> = [];
    if (typeof error.message === 'string') parts.push(error.message);
    if (typeof error.stderr === 'string') parts.push(error.stderr);
    if (typeof error.stdout === 'string') parts.push(error.stdout);
    return parts
      .filter(Boolean)
      .join(' ')
      .trim();
  }

  private isMissingRemoteRefError(error: any): boolean {
    const msg = this.extractErrorMessage(error).toLowerCase();
    if (!msg) return false;
    return (
      msg.includes("couldn't find remote ref") ||
      msg.includes('could not find remote ref') ||
      msg.includes('remote ref does not exist') ||
      msg.includes('fatal: the remote end hung up unexpectedly') ||
      msg.includes('no such ref was fetched')
    );
  }

  private async fetchBaseRefWithFallback(
    projectPath: string,
    projectId: string,
    target: BaseRefInfo
  ): Promise<BaseRefInfo> {
    try {
      await execFileAsync('git', ['fetch', target.remote, target.branch], {
        cwd: projectPath,
      });
      log.info(`Fetched latest ${target.fullRef} for worktree creation`);
      return target;
    } catch (error) {
      log.warn(`Failed to fetch ${target.fullRef}`, error);
      if (!this.isMissingRemoteRefError(error)) {
        const message = this.extractErrorMessage(error) || 'Unknown git fetch error';
        throw new Error(`Failed to fetch ${target.fullRef}: ${message}`);
      }

      // Attempt fallback to default branch
      const fallback = await this.buildDefaultBaseRef(projectPath);
      if (fallback.fullRef === target.fullRef) {
        const message = this.extractErrorMessage(error) || 'Unknown git fetch error';
        throw new Error(`Failed to fetch ${target.fullRef}: ${message}`);
      }

      try {
        await execFileAsync('git', ['fetch', fallback.remote, fallback.branch], {
          cwd: projectPath,
        });
        log.info(`Fetched fallback ${fallback.fullRef} after missing base ref`);

        try {
          await projectSettingsService.updateProjectSettings(projectId, {
            baseRef: fallback.fullRef,
          });
          log.info(`Updated project ${projectId} baseRef to fallback ${fallback.fullRef}`);
        } catch (persistError) {
          log.warn('Failed to persist fallback baseRef', persistError);
        }

        return fallback;
      } catch (fallbackError) {
        const msg = this.extractErrorMessage(fallbackError) || 'Unknown git fetch error';
        throw new Error(
          `Failed to fetch base branch. Tried ${target.fullRef} and ${fallback.fullRef}. ${msg} Please verify the branch exists on the remote.`
        );
      }
    }
  }

  /**
   * Merge worktree changes back to main branch
   */
  async mergeWorktreeChanges(projectPath: string, worktreeId: string): Promise<void> {
    try {
      const worktree = this.worktrees.get(worktreeId);
      if (!worktree) {
        throw new Error('Worktree not found');
      }

      const defaultBranch = await this.getDefaultBranch(projectPath);

      // Switch to default branch
      await execFileAsync('git', ['checkout', defaultBranch], { cwd: projectPath });

      // Merge the worktree branch
      await execFileAsync('git', ['merge', worktree.branch], { cwd: projectPath });

      // Remove the worktree
      await this.removeWorktree(projectPath, worktreeId);

      log.info(`Merged worktree changes: ${worktree.name}`);
    } catch (error) {
      log.error('Failed to merge worktree changes:', error);
      throw new Error(`Failed to merge worktree changes: ${error}`);
    }
  }

  /**
   * Get worktree by ID
   */
  getWorktree(worktreeId: string): WorktreeInfo | undefined {
    return this.worktrees.get(worktreeId);
  }

  /**
   * Get all worktrees
   */
  getAllWorktrees(): WorktreeInfo[] {
    return Array.from(this.worktrees.values());
  }

  private ensureCodexLogIgnored(worktreePath: string) {
    try {
      const gitMeta = path.join(worktreePath, '.git');
      let gitDir = gitMeta;
      if (fs.existsSync(gitMeta) && fs.statSync(gitMeta).isFile()) {
        try {
          const content = fs.readFileSync(gitMeta, 'utf8');
          const m = content.match(/gitdir:\s*(.*)\s*$/i);
          if (m && m[1]) {
            gitDir = path.resolve(worktreePath, m[1].trim());
          }
        } catch {}
      }
      const excludePath = path.join(gitDir, 'info', 'exclude');
      try {
        const dir = path.dirname(excludePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        let current = '';
        try {
          current = fs.readFileSync(excludePath, 'utf8');
        } catch {}
        if (!current.includes('codex-stream.log')) {
          fs.appendFileSync(
            excludePath,
            (current.endsWith('\n') || current === '' ? '' : '\n') + 'codex-stream.log\n'
          );
        }
      } catch {}
    } catch {}
  }

  async createWorktreeFromBranch(
    projectPath: string,
    workspaceName: string,
    branchName: string,
    projectId: string,
    options?: { worktreePath?: string }
  ): Promise<WorktreeInfo> {
    const normalizedName = workspaceName || branchName.replace(/\//g, '-');
    const sluggedName = this.slugify(normalizedName) || 'workspace';
    const targetPath =
      options?.worktreePath ||
      path.join(projectPath, '..', `worktrees/${sluggedName}-${Date.now()}`);
    const worktreePath = path.resolve(targetPath);

    if (fs.existsSync(worktreePath)) {
      throw new Error(`Worktree directory already exists: ${worktreePath}`);
    }

    const worktreesDir = path.dirname(worktreePath);
    if (!fs.existsSync(worktreesDir)) {
      fs.mkdirSync(worktreesDir, { recursive: true });
    }

    try {
      await execFileAsync('git', ['worktree', 'add', worktreePath, branchName], {
        cwd: projectPath,
      });
    } catch (error) {
      throw new Error(
        `Failed to create worktree for branch ${branchName}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!fs.existsSync(worktreePath)) {
      throw new Error(`Worktree directory was not created: ${worktreePath}`);
    }

    this.ensureCodexLogIgnored(worktreePath);

    const worktreeInfo: WorktreeInfo = {
      id: this.stableIdFromPath(worktreePath),
      name: normalizedName,
      branch: branchName,
      path: worktreePath,
      projectId,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    this.worktrees.set(worktreeInfo.id, worktreeInfo);

    return worktreeInfo;
  }
}

export const worktreeService = new WorktreeService();
