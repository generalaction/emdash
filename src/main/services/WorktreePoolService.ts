import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { log } from '../lib/logger';
import { worktreeService, type WorktreeInfo } from './WorktreeService';

const execFileAsync = promisify(execFile);

interface ReserveWorktree {
  id: string;
  path: string;
  branch: string;
  projectId: string;
  projectPath: string;
  baseRef: string;
  createdAt: string;
}

interface ClaimResult {
  worktree: WorktreeInfo;
  needsBaseRefSwitch: boolean;
}

/**
 * WorktreePoolService maintains a pool of pre-created "reserve" worktrees
 * that can be instantly claimed when users create new tasks.
 *
 * This eliminates the 3-7 second wait for worktree creation by:
 * 1. Pre-creating reserve worktrees in the background when projects are opened
 * 2. Instantly renaming reserves when tasks are created
 * 3. Replenishing the pool in the background after claims
 */
export class WorktreePoolService {
  // Keyed by `${projectId}::${baseRef}` to keep reserves base-ref specific.
  private reserves = new Map<string, ReserveWorktree>();
  private creationInProgress = new Set<string>();
  private readonly RESERVE_PREFIX = '_reserve';
  // Reserves older than this are considered stale and will be recreated
  // 30 minutes is reasonable since users don't create tasks that frequently
  private readonly MAX_RESERVE_AGE_MS = 30 * 60 * 1000; // 30 minutes

  /** Generate a unique hash for reserve identification */
  private generateReserveHash(): string {
    const bytes = crypto.randomBytes(4);
    return bytes.readUIntBE(0, 4).toString(36).slice(0, 6).padStart(6, '0');
  }

  /** Get the reserve worktree path for a project */
  private getReservePath(projectPath: string, hash: string): string {
    return path.join(projectPath, '..', `worktrees/${this.RESERVE_PREFIX}-${hash}`);
  }

  /** Get the reserve branch name */
  private getReserveBranch(hash: string): string {
    return `${this.RESERVE_PREFIX}/${hash}`;
  }

  private normalizeBaseRef(baseRef?: string): string {
    const trimmed = (baseRef || '').trim();
    return trimmed.length > 0 ? trimmed : 'HEAD';
  }

  private getReserveKey(projectId: string, baseRef?: string): string {
    return `${projectId}::${this.normalizeBaseRef(baseRef)}`;
  }

  private async refreshRefsForReserveCreation(
    projectPath: string,
    projectId: string
  ): Promise<void> {
    try {
      await execFileAsync('git', ['fetch', '--all', '--prune'], {
        cwd: projectPath,
        timeout: 15000,
      });
    } catch (error) {
      log.warn('WorktreePool: Failed to refresh refs during reserve creation', {
        projectId,
        error,
      });
    }
  }

  /**
   * Resolve HEAD or bare branch names to their remote tracking counterpart.
   * After `refreshRefsForReserveCreation` fetches all refs, this ensures the
   * worktree is created from the freshly-fetched remote ref rather than a
   * potentially stale local branch.
   */
  private async resolveToRemoteRef(projectPath: string, baseRef: string): Promise<string> {
    // Already a remote ref (e.g. origin/main) — use as-is
    if (baseRef.includes('/')) return baseRef;

    try {
      const branchName =
        baseRef === 'HEAD'
          ? (
              await execFileAsync('git', ['symbolic-ref', '--short', 'HEAD'], {
                cwd: projectPath,
              })
            ).stdout.trim()
          : baseRef;

      // Verify the remote tracking ref exists (it should after fetch --all)
      await execFileAsync('git', ['rev-parse', '--verify', `refs/remotes/origin/${branchName}`], {
        cwd: projectPath,
      });
      return `origin/${branchName}`;
    } catch {
      return baseRef; // Fallback to original if resolution fails
    }
  }

  /** Generate stable ID from path */
  private stableIdFromPath(worktreePath: string): string {
    const abs = path.resolve(worktreePath);
    const h = crypto.createHash('sha1').update(abs).digest('hex').slice(0, 12);
    return `wt-${h}`;
  }

  /** Check if a reserve is stale (too old to be useful) */
  private isReserveStale(reserve: ReserveWorktree): boolean {
    const age = Date.now() - new Date(reserve.createdAt).getTime();
    return age > this.MAX_RESERVE_AGE_MS;
  }

  /** Check if a fresh reserve exists for a project */
  hasReserve(projectId: string): boolean {
    for (const [key, reserve] of this.reserves.entries()) {
      if (!key.startsWith(`${projectId}::`)) continue;
      if (this.isReserveStale(reserve)) {
        this.reserves.delete(key);
        this.cleanupReserve(reserve).catch(() => {});
        continue;
      }
      return true;
    }
    return false;
  }

  /** Get the reserve for a project (if any) */
  getReserve(projectId: string): ReserveWorktree | undefined {
    for (const [key, reserve] of this.reserves.entries()) {
      if (!key.startsWith(`${projectId}::`)) continue;
      if (this.isReserveStale(reserve)) {
        this.reserves.delete(key);
        this.cleanupReserve(reserve).catch(() => {});
        continue;
      }
      return reserve;
    }
    return undefined;
  }

  /**
   * Ensure a reserve worktree exists for a project.
   * Creates one in the background if not present.
   */
  async ensureReserve(projectId: string, projectPath: string, baseRef?: string): Promise<void> {
    const reserveKey = this.getReserveKey(projectId, baseRef);

    // Creation already in progress
    if (this.creationInProgress.has(reserveKey)) {
      return;
    }

    // Check existing reserve
    const existing = this.reserves.get(reserveKey);
    if (existing) {
      if (!this.isReserveStale(existing)) {
        return; // Fresh reserve exists
      }
      // Stale reserve - clean it up and create fresh one
      this.reserves.delete(reserveKey);
      this.cleanupReserve(existing).catch(() => {});
    }

    // Start background creation
    this.creationInProgress.add(reserveKey);

    try {
      await this.createReserve(projectId, projectPath, this.normalizeBaseRef(baseRef));
    } catch (error) {
      log.warn('WorktreePool: Failed to create reserve', { projectId, baseRef, error });
    } finally {
      this.creationInProgress.delete(reserveKey);
    }
  }

  /**
   * Create a reserve worktree for a project
   */
  private async createReserve(
    projectId: string,
    projectPath: string,
    baseRef: string
  ): Promise<void> {
    const hash = this.generateReserveHash();
    const reservePath = this.getReservePath(projectPath, hash);
    const reserveBranch = this.getReserveBranch(hash);

    // Ensure worktrees directory exists
    const worktreesDir = path.dirname(reservePath);
    if (!fs.existsSync(worktreesDir)) {
      fs.mkdirSync(worktreesDir, { recursive: true });
    }

    // Keep reserve refs fresh in the background so claim remains instant.
    await this.refreshRefsForReserveCreation(projectPath, projectId);

    // Resolve HEAD/local refs to remote tracking refs (freshly fetched)
    // so the worktree is created from up-to-date code, not a stale local branch.
    const resolvedRef = await this.resolveToRemoteRef(projectPath, baseRef);

    // Create the worktree
    await execFileAsync('git', ['worktree', 'add', '-b', reserveBranch, reservePath, resolvedRef], {
      cwd: projectPath,
    });

    const reserveId = this.stableIdFromPath(reservePath);
    const reserve: ReserveWorktree = {
      id: reserveId,
      path: reservePath,
      branch: reserveBranch,
      projectId,
      projectPath,
      baseRef,
      createdAt: new Date().toISOString(),
    };

    this.reserves.set(this.getReserveKey(projectId, baseRef), reserve);
  }

  /**
   * Claim a reserve worktree for a new task.
   * Renames the reserve to match the task name and returns it instantly.
   */
  async claimReserve(
    projectId: string,
    projectPath: string,
    taskName: string,
    requestedBaseRef?: string
  ): Promise<ClaimResult | null> {
    const resolvedBaseRef = this.normalizeBaseRef(requestedBaseRef);
    const reserveKey = this.getReserveKey(projectId, resolvedBaseRef);
    const reserve = this.reserves.get(reserveKey);
    if (!reserve) {
      this.replenishReserve(projectId, projectPath, resolvedBaseRef);
      return null;
    }

    // Check if reserve is stale (too old)
    if (this.isReserveStale(reserve)) {
      // Remove stale reserve and clean it up in background
      this.reserves.delete(reserveKey);
      this.cleanupReserve(reserve).catch(() => {});
      // Start creating a fresh reserve for next time
      this.replenishReserve(projectId, projectPath, resolvedBaseRef);
      return null; // Caller will use fallback (sync creation)
    }

    // Remove from pool immediately to prevent double-claims
    this.reserves.delete(reserveKey);

    try {
      const result = await this.transformReserve(reserve, taskName);

      // Start background replenishment
      this.replenishReserve(projectId, projectPath, resolvedBaseRef);

      return result;
    } catch (error) {
      log.error('WorktreePool: Failed to claim reserve', { projectId, taskName, error });
      // Try to clean up the reserve on failure
      this.cleanupReserve(reserve).catch(() => {});
      return null;
    }
  }

  /**
   * Transform a reserve worktree into a task worktree
   */
  private async transformReserve(reserve: ReserveWorktree, taskName: string): Promise<ClaimResult> {
    const { getAppSettings } = await import('../settings');
    const settings = getAppSettings();
    const prefix = settings?.repository?.branchPrefix || 'emdash';

    // Generate new names
    const sluggedName = this.slugify(taskName);
    const hash = this.generateShortHash();
    const newBranch = `${prefix}/${sluggedName}-${hash}`;
    const newPath = path.join(reserve.projectPath, '..', `worktrees/${sluggedName}-${hash}`);
    const newId = this.stableIdFromPath(newPath);

    // Move the worktree (instant operation)
    await execFileAsync('git', ['worktree', 'move', reserve.path, newPath], {
      cwd: reserve.projectPath,
    });

    // Update reserve path so cleanup uses correct location if we fail later
    reserve.path = newPath;

    // Rename the branch (instant operation)
    await execFileAsync('git', ['branch', '-m', reserve.branch, newBranch], {
      cwd: newPath,
    });

    // Preserve project-specific gitignored files from project to worktree
    try {
      await worktreeService.preserveProjectFilesToWorktree(reserve.projectPath, newPath);
    } catch (preserveErr) {
      log.warn('WorktreePool: Failed to preserve files', { error: preserveErr });
    }

    // Push branch to remote in background (non-blocking)
    this.pushBranchAsync(newPath, newBranch, settings);

    const worktree: WorktreeInfo = {
      id: newId,
      name: taskName,
      branch: newBranch,
      path: newPath,
      projectId: reserve.projectId,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    // Register with worktreeService
    worktreeService.registerWorktree(worktree);

    return { worktree, needsBaseRefSwitch: false };
  }

  /** Replenish reserve in background after claiming */
  private replenishReserve(projectId: string, projectPath: string, baseRef?: string): void {
    // Fire and forget
    this.ensureReserve(projectId, projectPath, baseRef).catch((error) => {
      log.warn('WorktreePool: Failed to replenish reserve', { projectId, error });
    });
  }

  /** Push branch to remote asynchronously */
  private async pushBranchAsync(
    worktreePath: string,
    branchName: string,
    settings: any
  ): Promise<void> {
    if (settings?.repository?.pushOnCreate === false) {
      return;
    }

    try {
      // Get remote name
      const { stdout: remotesOut } = await execFileAsync('git', ['remote'], {
        cwd: worktreePath,
      });
      const remotes = remotesOut.trim().split('\n').filter(Boolean);
      const remote = remotes.includes('origin') ? 'origin' : remotes[0];

      if (!remote) {
        return;
      }

      await execFileAsync('git', ['push', '--set-upstream', remote, branchName], {
        cwd: worktreePath,
        timeout: 60000,
      });
    } catch {
      // Push failures are non-critical, ignore silently
    }
  }

  /** Cleanup a reserve worktree */
  private async cleanupReserve(reserve: ReserveWorktree): Promise<void> {
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', reserve.path], {
        cwd: reserve.projectPath,
      });
    } catch {
      // Worktree might already be gone; continue and try branch cleanup.
    }

    try {
      // Also delete the branch
      await execFileAsync('git', ['branch', '-D', reserve.branch], {
        cwd: reserve.projectPath,
      });
    } catch {
      // Cleanup failures are non-critical
    }
  }

  /** Remove reserve for a project (e.g., when project is removed) */
  async removeReserve(projectId: string, projectPath?: string): Promise<void> {
    const reservesForProject = Array.from(this.reserves.entries()).filter(([key]) =>
      key.startsWith(`${projectId}::`)
    );
    const resolvedProjectPath = projectPath || reservesForProject[0]?.[1].projectPath;

    await Promise.all(
      reservesForProject.map(async ([key, reserve]) => {
        this.reserves.delete(key);
        await this.cleanupReserve(reserve);
      })
    );

    if (!resolvedProjectPath) {
      return;
    }

    await this.cleanupReserveArtifactsForProject(resolvedProjectPath);
  }

  private async cleanupReserveArtifactsForProject(projectPath: string): Promise<void> {
    const normalizedProjectPath = path.resolve(projectPath);
    const reserveBranches = await this.listReserveBranches(normalizedProjectPath);
    const remainingBranches = new Set(reserveBranches);

    for (const reserve of this.findReserveDirectoriesForProject(
      normalizedProjectPath,
      remainingBranches
    )) {
      try {
        await execFileAsync('git', ['worktree', 'remove', '--force', reserve.path], {
          cwd: normalizedProjectPath,
        });
      } catch {
        // Best effort: if git cleanup fails, remove directory directly.
        try {
          fs.rmSync(reserve.path, { recursive: true, force: true });
        } catch {
          // Ignore secondary cleanup failure.
        }
      }

      if (reserve.branch) {
        await this.deleteBranch(normalizedProjectPath, reserve.branch);
        remainingBranches.delete(reserve.branch);
      }
    }

    // Clean up any remaining reserve branches even if the worktree directory is already gone.
    for (const branch of remainingBranches) {
      await this.deleteBranch(normalizedProjectPath, branch);
    }
  }

  private findReserveDirectoriesForProject(
    projectPath: string,
    reserveBranches: Set<string>
  ): Array<{ path: string; branch: string | null }> {
    const worktreesDir = path.join(projectPath, '..', 'worktrees');
    if (!fs.existsSync(worktreesDir)) {
      return [];
    }

    const result: Array<{ path: string; branch: string | null }> = [];
    try {
      const entries = fs.readdirSync(worktreesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith(`${this.RESERVE_PREFIX}-`)) {
          continue;
        }

        const reservePath = path.join(worktreesDir, entry.name);
        const ownerPath = this.getMainRepoPathFromWorktree(reservePath);
        const branch = this.getReserveBranchFromDirectoryName(entry.name);
        const ownsReserve = ownerPath ? path.resolve(ownerPath) === projectPath : false;
        const branchBelongsToProject = branch ? reserveBranches.has(branch) : false;

        if (!ownsReserve && !branchBelongsToProject) {
          continue;
        }

        result.push({ path: reservePath, branch });
      }
    } catch {
      // Ignore unreadable worktrees directory.
    }

    return result;
  }

  private getReserveBranchFromDirectoryName(name: string): string | null {
    const branchMatch = name.match(/^_reserve-(.+)$/);
    if (!branchMatch) return null;
    return `_reserve/${branchMatch[1]}`;
  }

  private async listReserveBranches(projectPath: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['for-each-ref', '--format=%(refname:short)', `refs/heads/${this.RESERVE_PREFIX}`],
        { cwd: projectPath }
      );
      return stdout
        .trim()
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith(`${this.RESERVE_PREFIX}/`));
    } catch {
      return [];
    }
  }

  private async deleteBranch(projectPath: string, branchName: string): Promise<void> {
    try {
      await execFileAsync('git', ['branch', '-D', branchName], { cwd: projectPath });
    } catch {
      // Branch may not exist or still be attached to a worktree.
    }
  }

  private getMainRepoPathFromWorktree(worktreePath: string): string | null {
    const gitDirPath = path.join(worktreePath, '.git');
    if (!fs.existsSync(gitDirPath)) {
      return null;
    }

    try {
      const gitDirContent = fs.readFileSync(gitDirPath, 'utf8');
      const match = gitDirContent.match(/gitdir:\s*(.+)/);
      if (!match) {
        return null;
      }

      const gitWorktreePath = match[1].trim();
      const resolvedGitWorktreePath = path.isAbsolute(gitWorktreePath)
        ? gitWorktreePath
        : path.resolve(worktreePath, gitWorktreePath);
      const mainRepoPath = resolvedGitWorktreePath.replace(
        /[\\\\/]\.git[\\\\/]worktrees[\\\\/].*$/,
        ''
      );
      if (mainRepoPath !== resolvedGitWorktreePath) {
        return mainRepoPath;
      }

      // Fallback for unexpected gitdir layouts.
      return resolvedGitWorktreePath.replace(/[\\\\/]\.git$/, '');
    } catch {
      return null;
    }
  }

  /** Cleanup all reserves (e.g., on app shutdown) */
  async cleanup(): Promise<void> {
    for (const [projectId, reserve] of this.reserves) {
      try {
        await this.cleanupReserve(reserve);
      } catch (error) {
        log.warn('WorktreePool: Failed to cleanup reserve on shutdown', { projectId, error });
      }
    }
    this.reserves.clear();
  }

  /**
   * Clean up orphaned reserve worktrees from previous sessions.
   * Called on app startup to handle reserves left behind from crashes or forced quits.
   * Runs in background and doesn't block app startup.
   */
  async cleanupOrphanedReserves(projectPaths: string[] = []): Promise<void> {
    // Small delay to not compete with critical startup tasks
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Find all worktree directories that might contain reserves
    const homedir = require('os').homedir();
    const projectWorktreeDirs = projectPaths.map((projectPath) =>
      path.join(projectPath, '..', 'worktrees')
    );
    const possibleWorktreeDirs = [
      ...projectWorktreeDirs,
      path.join(homedir, 'cursor', 'worktrees'),
      path.join(homedir, 'Documents', 'worktrees'),
      path.join(homedir, 'Projects', 'worktrees'),
      path.join(homedir, 'code', 'worktrees'),
      path.join(homedir, 'dev', 'worktrees'),
    ];
    const uniqueWorktreeDirs = [...new Set(possibleWorktreeDirs.map((dir) => path.resolve(dir)))];

    // Collect all orphaned reserves first (fast sync scan)
    const orphanedReserves: { path: string; name: string }[] = [];
    for (const worktreesDir of uniqueWorktreeDirs) {
      if (!fs.existsSync(worktreesDir)) continue;
      try {
        const entries = fs.readdirSync(worktreesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && entry.name.startsWith(this.RESERVE_PREFIX)) {
            orphanedReserves.push({
              path: path.join(worktreesDir, entry.name),
              name: entry.name,
            });
          }
        }
      } catch {
        // Ignore unreadable directories
      }
    }

    if (orphanedReserves.length === 0) {
      return;
    }

    // Clean up all reserves in parallel (silently)
    await Promise.allSettled(
      orphanedReserves.map((reserve) => this.cleanupOrphanedReserve(reserve.path, reserve.name))
    );
  }

  /** Clean up a single orphaned reserve */
  private async cleanupOrphanedReserve(reservePath: string, name: string): Promise<boolean> {
    try {
      // Try to find the parent git repo to properly remove the worktree
      const mainRepoPath = this.getMainRepoPathFromWorktree(reservePath);
      if (mainRepoPath && fs.existsSync(mainRepoPath)) {
        // Remove worktree via git
        await execFileAsync('git', ['worktree', 'remove', '--force', reservePath], {
          cwd: mainRepoPath,
        });

        // Try to remove the reserve branch
        const branchName = this.getReserveBranchFromDirectoryName(name);
        if (branchName) {
          await this.deleteBranch(mainRepoPath, branchName);
        }

        return true;
      }

      // Fallback: just remove the directory
      fs.rmSync(reservePath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  /** Slugify task name */
  private slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /** Generate short hash */
  private generateShortHash(): string {
    const bytes = crypto.randomBytes(3);
    return bytes.readUIntBE(0, 3).toString(36).slice(0, 3).padStart(3, '0');
  }
}

export const worktreePoolService = new WorktreePoolService();
