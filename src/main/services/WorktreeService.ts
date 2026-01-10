import { execFile } from 'child_process';
import { log } from '../lib/logger';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { projectSettingsService } from './ProjectSettingsService';
import { minimatch } from 'minimatch';

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

export interface PreserveResult {
  copied: string[];
  skipped: string[];
}

/** Default patterns for files to preserve when creating worktrees */
const DEFAULT_PRESERVE_PATTERNS = [
  '.env',
  '.env.keys',
  '.env.local',
  '.env.*.local',
  '.envrc',
  'docker-compose.override.yml',
];

/** Default path segments to exclude from preservation */
const DEFAULT_EXCLUDE_PATTERNS = [
  'node_modules',
  '.git',
  'vendor',
  '.cache',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '__pycache__',
  '.venv',
  'venv',
];

/** Project-level config stored in .emdash.json */
interface EmdashConfig {
  preservePatterns?: string[];
}

export class WorktreeService {
  private worktrees = new Map<string, WorktreeInfo>();

  /**
   * Read .emdash.json config from project root
   */
  private readProjectConfig(projectPath: string): EmdashConfig | null {
    try {
      const configPath = path.join(projectPath, '.emdash.json');
      if (!fs.existsSync(configPath)) {
        return null;
      }
      const content = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(content) as EmdashConfig;
    } catch {
      return null;
    }
  }

  /**
   * Get preserve patterns for a project (config or defaults)
   */
  private getPreservePatterns(projectPath: string): string[] {
    const config = this.readProjectConfig(projectPath);
    if (config?.preservePatterns && Array.isArray(config.preservePatterns)) {
      return config.preservePatterns;
    }
    return DEFAULT_PRESERVE_PATTERNS;
  }

  /**
   * Slugify task name to make it shell-safe
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
   * Create a new Git worktree for an agent task
   */
  async createWorktree(
    projectPath: string,
    taskName: string,
    projectId: string,
    autoApprove?: boolean
  ): Promise<WorktreeInfo> {
    try {
      const sluggedName = this.slugify(taskName);
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

      // Preserve .env and other gitignored config files from source to worktree
      try {
        const patterns = this.getPreservePatterns(projectPath);
        await this.preserveFilesToWorktree(projectPath, worktreePath, patterns);
      } catch (preserveErr) {
        log.warn('Failed to preserve files to worktree (continuing):', preserveErr);
      }

      // Setup Claude Code settings if auto-approve is enabled
      if (autoApprove) {
        this.ensureClaudeAutoApprove(worktreePath);
      }

      await this.logWorktreeSyncStatus(projectPath, worktreePath, fetchedBaseRef);

      const worktreeInfo: WorktreeInfo = {
        id: worktreeId,
        name: taskName,
        branch: branchName,
        path: worktreePath,
        projectId,
        status: 'active',
        createdAt: new Date().toISOString(),
      };

      this.worktrees.set(worktreeInfo.id, worktreeInfo);

      log.info(`Created worktree: ${taskName} -> ${branchName}`);

      // Push the new branch to origin and set upstream so PRs work out of the box
      // Only if a remote exists
      if (settings?.repository?.pushOnCreate !== false && fetchedBaseRef.remote) {
        try {
          await execFileAsync(
            'git',
            ['push', '--set-upstream', fetchedBaseRef.remote, branchName],
            {
              cwd: worktreePath,
            }
          );
          log.info(
            `Pushed branch ${branchName} to ${fetchedBaseRef.remote} with upstream tracking`
          );
        } catch (pushErr) {
          log.warn('Initial push of worktree branch failed:', pushErr as any);
          // Don't fail worktree creation if push fails - user can push manually later
        }
      } else if (!fetchedBaseRef.remote) {
        log.info(
          `Skipping push for worktree branch ${branchName} - no remote configured (local-only repo)`
        );
      }

      return worktreeInfo;
    } catch (error) {
      log.error('Failed to create worktree:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message || 'Failed to create worktree');
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
      n = `agent/${this.slugify('task')}-${Date.now()}`;
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
      const worktree = this.worktrees.get(worktreeId);

      const pathToRemove = worktree?.path ?? worktreePath;
      const branchToDelete = worktree?.branch ?? branch;

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

        // Only try to delete remote branch if a remote exists
        const remoteAlias = 'origin';
        const hasRemote = await this.hasRemote(projectPath, remoteAlias);
        if (hasRemote) {
          let remoteBranchName = branchToDelete;
          if (branchToDelete.startsWith('origin/')) {
            remoteBranchName = branchToDelete.replace(/^origin\//, '');
          }
          try {
            await execFileAsync('git', ['push', remoteAlias, '--delete', remoteBranchName], {
              cwd: projectPath,
            });
            log.info(`Deleted remote branch ${remoteAlias}/${remoteBranchName}`);
          } catch (remoteError: any) {
            const msg = String(remoteError?.stderr || remoteError?.message || remoteError);
            if (
              /remote ref does not exist/i.test(msg) ||
              /unknown revision/i.test(msg) ||
              /not found/i.test(msg)
            ) {
              log.info(`Remote branch ${remoteAlias}/${remoteBranchName} already absent`);
            } else {
              log.warn(
                `Failed to delete remote branch ${remoteAlias}/${remoteBranchName}:`,
                remoteError
              );
            }
          }
        } else {
          log.info(`Skipping remote branch deletion - no remote configured (local-only repo)`);
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
      const { stdout: status } = await execFileAsync(
        'git',
        ['status', '--porcelain', '--untracked-files=all'],
        {
          cwd: worktreePath,
        }
      );

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
    // Check if origin remote exists first
    const hasOrigin = await this.hasRemote(projectPath, 'origin');
    if (!hasOrigin) {
      // No remote - try to get current branch
      try {
        const { stdout } = await execFileAsync('git', ['branch', '--show-current'], {
          cwd: projectPath,
        });
        const current = stdout.trim();
        if (current) return current;
      } catch {
        // Fallback to 'main'
      }
      return 'main';
    }

    // Has remote - try to get its default branch
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

  private async parseBaseRef(
    ref?: string | null,
    projectPath?: string
  ): Promise<BaseRefInfo | null> {
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

    // If projectPath is provided, verify that 'remote' is actually a valid git remote
    // If not, treat the entire string as a local branch name
    if (projectPath) {
      try {
        const { stdout } = await execFileAsync('git', ['remote'], { cwd: projectPath });
        const remotes = (stdout || '').trim().split('\n').filter(Boolean);
        if (!remotes.includes(remote)) {
          // 'remote' is not a valid git remote, treat entire string as local branch
          return null;
        }
      } catch {
        // If we can't check remotes, fall back to original behavior
      }
    }

    return { remote, branch, fullRef: `${remote}/${branch}` };
  }

  private async resolveProjectBaseRef(
    projectPath: string,
    projectId: string
  ): Promise<BaseRefInfo> {
    const settings = await projectSettingsService.getProjectSettings(projectId);
    if (!settings) {
      throw new Error(
        'Project settings not found. Please re-open the project in Emdash and try again.'
      );
    }

    const parsed = await this.parseBaseRef(settings.baseRef, projectPath);
    if (parsed) {
      return parsed;
    }

    // If parseBaseRef returned null, it might be a local branch name
    // Check if the baseRef exists as a local branch
    if (settings.baseRef) {
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['rev-parse', '--verify', `refs/heads/${settings.baseRef}`],
          { cwd: projectPath }
        );
        if (stdout?.trim()) {
          // It's a valid local branch - check if we have a remote
          const hasOrigin = await this.hasRemote(projectPath, 'origin');
          if (hasOrigin) {
            return {
              remote: 'origin',
              branch: settings.baseRef,
              fullRef: `origin/${settings.baseRef}`,
            };
          } else {
            // Local-only repo
            return {
              remote: '',
              branch: settings.baseRef,
              fullRef: settings.baseRef,
            };
          }
        }
      } catch {
        // Not a local branch, continue to fallback
      }
    }

    // Check if we have a remote
    const hasOrigin = await this.hasRemote(projectPath, 'origin');
    const fallbackBranch =
      settings.gitBranch?.trim() && !settings.gitBranch.includes(' ')
        ? settings.gitBranch.trim()
        : await this.getDefaultBranch(projectPath);
    const branch = fallbackBranch || 'main';

    if (hasOrigin) {
      return {
        remote: 'origin',
        branch,
        fullRef: `origin/${branch}`,
      };
    } else {
      // Local-only repo
      return {
        remote: '',
        branch,
        fullRef: branch,
      };
    }
  }

  private async buildDefaultBaseRef(projectPath: string): Promise<BaseRefInfo> {
    const hasOrigin = await this.hasRemote(projectPath, 'origin');
    const branch = await this.getDefaultBranch(projectPath);
    const cleanBranch = branch?.trim() || 'main';

    if (hasOrigin) {
      return { remote: 'origin', branch: cleanBranch, fullRef: `origin/${cleanBranch}` };
    } else {
      // Local-only repo
      return { remote: '', branch: cleanBranch, fullRef: cleanBranch };
    }
  }

  private extractErrorMessage(error: any): string {
    if (!error) return '';
    const parts: Array<string | undefined> = [];
    if (typeof error.message === 'string') parts.push(error.message);
    if (typeof error.stderr === 'string') parts.push(error.stderr);
    if (typeof error.stdout === 'string') parts.push(error.stdout);
    return parts.filter(Boolean).join(' ').trim();
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
    // Check if remote exists - if not, this is a local-only repo
    const hasRemote = await this.hasRemote(projectPath, target.remote);

    if (!hasRemote) {
      log.info(`No remote '${target.remote}' found, using local branch ${target.branch}`);
      // Verify the local branch exists
      try {
        await execFileAsync('git', ['rev-parse', '--verify', target.branch], {
          cwd: projectPath,
        });
        // Return target with just the branch name (no remote prefix)
        return {
          remote: '',
          branch: target.branch,
          fullRef: target.branch,
        };
      } catch (error) {
        throw new Error(`Local branch '${target.branch}' does not exist. Please create it first.`);
      }
    }

    // Remote exists, proceed with fetch
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

      // Check if fallback remote exists before fetching
      const hasFallbackRemote = await this.hasRemote(projectPath, fallback.remote);
      if (!hasFallbackRemote) {
        throw new Error(
          `Failed to fetch ${target.fullRef} and fallback remote '${fallback.remote}' does not exist`
        );
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
   * Check if a git remote exists in the repository
   */
  private async hasRemote(projectPath: string, remoteName: string): Promise<boolean> {
    if (!remoteName) return false;
    try {
      await execFileAsync('git', ['remote', 'get-url', remoteName], {
        cwd: projectPath,
      });
      return true;
    } catch {
      return false;
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

  /**
   * Get list of gitignored files in a directory using git ls-files
   */
  private async getIgnoredFiles(dir: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['ls-files', '--others', '--ignored', '--exclude-standard'],
        { cwd: dir }
      );

      if (!stdout || !stdout.trim()) {
        return [];
      }

      return stdout
        .trim()
        .split('\n')
        .filter((line) => line.length > 0);
    } catch (error) {
      log.debug('Failed to list ignored files:', error);
      return [];
    }
  }

  /**
   * Check if a file path matches any of the preserve patterns
   */
  private matchesPreservePattern(filePath: string, patterns: string[]): boolean {
    const fileName = path.basename(filePath);

    for (const pattern of patterns) {
      // Match against filename
      if (minimatch(fileName, pattern, { dot: true })) {
        return true;
      }
      // Match against full path
      if (minimatch(filePath, pattern, { dot: true })) {
        return true;
      }
      // Match against full path with ** prefix for nested matches
      if (minimatch(filePath, `**/${pattern}`, { dot: true })) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a file path contains any excluded path segments
   */
  private isExcludedPath(filePath: string, excludePatterns: string[]): boolean {
    if (excludePatterns.length === 0) {
      return false;
    }

    // git ls-files always returns paths with forward slashes regardless of OS
    const parts = filePath.split('/');
    for (const part of parts) {
      if (excludePatterns.includes(part)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Copy a file safely, skipping if destination already exists
   */
  private async copyFileExclusive(
    sourcePath: string,
    destPath: string
  ): Promise<'copied' | 'skipped' | 'error'> {
    try {
      // Check if destination already exists
      if (fs.existsSync(destPath)) {
        return 'skipped';
      }

      // Ensure destination directory exists
      const destDir = path.dirname(destPath);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
      }

      // Copy file preserving mode
      const content = fs.readFileSync(sourcePath);
      const stat = fs.statSync(sourcePath);
      fs.writeFileSync(destPath, content, { mode: stat.mode });

      return 'copied';
    } catch (error) {
      log.debug(`Failed to copy ${sourcePath} to ${destPath}:`, error);
      return 'error';
    }
  }

  /**
   * Preserve gitignored files (like .env) from source to destination worktree.
   * Only copies files that match the preserve patterns and don't exist in destination.
   */
  async preserveFilesToWorktree(
    sourceDir: string,
    destDir: string,
    patterns: string[] = DEFAULT_PRESERVE_PATTERNS,
    excludePatterns: string[] = DEFAULT_EXCLUDE_PATTERNS
  ): Promise<PreserveResult> {
    const result: PreserveResult = { copied: [], skipped: [] };

    if (patterns.length === 0) {
      return result;
    }

    // Get all gitignored files from source directory
    const ignoredFiles = await this.getIgnoredFiles(sourceDir);

    if (ignoredFiles.length === 0) {
      log.debug('No ignored files found in source directory');
      return result;
    }

    // Filter files that match patterns and aren't excluded
    const filesToCopy: string[] = [];
    for (const file of ignoredFiles) {
      if (this.isExcludedPath(file, excludePatterns)) {
        continue;
      }

      if (this.matchesPreservePattern(file, patterns)) {
        filesToCopy.push(file);
      }
    }

    if (filesToCopy.length === 0) {
      log.debug('No files matched preserve patterns');
      return result;
    }

    log.info(`Preserving ${filesToCopy.length} file(s) to worktree: ${filesToCopy.join(', ')}`);

    // Copy each file
    for (const file of filesToCopy) {
      const sourcePath = path.join(sourceDir, file);
      const destPath = path.join(destDir, file);

      // Verify source file exists
      if (!fs.existsSync(sourcePath)) {
        log.debug(`Source file does not exist, skipping: ${sourcePath}`);
        continue;
      }

      const copyResult = await this.copyFileExclusive(sourcePath, destPath);

      if (copyResult === 'copied') {
        result.copied.push(file);
        log.debug(`Copied: ${file}`);
      } else if (copyResult === 'skipped') {
        result.skipped.push(file);
        log.debug(`Skipped (already exists): ${file}`);
      }
    }

    if (result.copied.length > 0) {
      log.info(`Preserved ${result.copied.length} file(s) to worktree`);
    }

    return result;
  }

  private ensureClaudeAutoApprove(worktreePath: string) {
    try {
      const claudeDir = path.join(worktreePath, '.claude');
      const settingsPath = path.join(claudeDir, 'settings.json');

      // Create .claude directory if it doesn't exist
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // Read existing settings or create new
      let settings: any = {};
      if (fs.existsSync(settingsPath)) {
        try {
          const content = fs.readFileSync(settingsPath, 'utf8');
          settings = JSON.parse(content);
        } catch (err) {
          log.warn('Failed to parse existing .claude/settings.json, will overwrite', err);
        }
      }

      // Set defaultMode to bypassPermissions
      settings.defaultMode = 'bypassPermissions';

      // Write settings file
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
      log.info(`Created .claude/settings.json with auto-approve enabled in ${worktreePath}`);
    } catch (err) {
      log.error('Failed to create .claude/settings.json', err);
    }
  }

  private async logWorktreeSyncStatus(
    projectPath: string,
    worktreePath: string,
    baseRef: BaseRefInfo
  ): Promise<void> {
    try {
      const [{ stdout: remoteOut }, { stdout: worktreeOut }] = await Promise.all([
        execFileAsync('git', ['rev-parse', baseRef.fullRef], { cwd: projectPath }),
        execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: worktreePath }),
      ]);
      const remoteSha = (remoteOut || '').trim();
      const worktreeSha = (worktreeOut || '').trim();
      if (!remoteSha || !worktreeSha) return;
      if (remoteSha === worktreeSha) {
        log.debug(`Worktree ${worktreePath} matches ${baseRef.fullRef} @ ${remoteSha}`);
      } else {
        log.warn(
          `Worktree ${worktreePath} diverged from ${baseRef.fullRef} immediately after creation`,
          { remoteSha, worktreeSha, baseRef: baseRef.fullRef }
        );
      }
    } catch (error) {
      log.debug('Unable to verify worktree head against remote', error);
    }
  }

  async createWorktreeFromBranch(
    projectPath: string,
    taskName: string,
    branchName: string,
    projectId: string,
    options?: { worktreePath?: string }
  ): Promise<WorktreeInfo> {
    const normalizedName = taskName || branchName.replace(/\//g, '-');
    const sluggedName = this.slugify(normalizedName) || 'task';
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

    // Preserve .env and other gitignored config files from source to worktree
    try {
      const patterns = this.getPreservePatterns(projectPath);
      await this.preserveFilesToWorktree(projectPath, worktreePath, patterns);
    } catch (preserveErr) {
      log.warn('Failed to preserve files to worktree (continuing):', preserveErr);
    }

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
