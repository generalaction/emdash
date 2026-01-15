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
  private reserves = new Map<string, ReserveWorktree>();
  private creationInProgress = new Set<string>();
  private readonly RESERVE_PREFIX = '_reserve';
  // Reserves older than this are considered stale and will be recreated
  private readonly MAX_RESERVE_AGE_MS = 5 * 60 * 1000; // 5 minutes

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
    const reserve = this.reserves.get(projectId);
    if (!reserve) return false;
    // Don't count stale reserves
    if (this.isReserveStale(reserve)) return false;
    return true;
  }

  /** Get the reserve for a project (if any) */
  getReserve(projectId: string): ReserveWorktree | undefined {
    return this.reserves.get(projectId);
  }

  /**
   * Ensure a reserve worktree exists for a project.
   * Creates one in the background if not present.
   */
  async ensureReserve(
    projectId: string,
    projectPath: string,
    baseRef?: string
  ): Promise<void> {
    // Already have a reserve
    if (this.reserves.has(projectId)) {
      log.debug('WorktreePool: Reserve already exists for project', { projectId });
      return;
    }

    // Creation already in progress
    if (this.creationInProgress.has(projectId)) {
      log.debug('WorktreePool: Reserve creation already in progress', { projectId });
      return;
    }

    // Start background creation
    this.creationInProgress.add(projectId);
    log.info('WorktreePool: Starting reserve creation for project', { projectId });

    try {
      await this.createReserve(projectId, projectPath, baseRef);
    } catch (error) {
      log.warn('WorktreePool: Failed to create reserve', { projectId, error });
    } finally {
      this.creationInProgress.delete(projectId);
    }
  }

  /**
   * Create a reserve worktree for a project
   */
  private async createReserve(
    projectId: string,
    projectPath: string,
    baseRef?: string
  ): Promise<void> {
    const hash = this.generateReserveHash();
    const reservePath = this.getReservePath(projectPath, hash);
    const reserveBranch = this.getReserveBranch(hash);

    // Ensure worktrees directory exists
    const worktreesDir = path.dirname(reservePath);
    if (!fs.existsSync(worktreesDir)) {
      fs.mkdirSync(worktreesDir, { recursive: true });
    }

    // Resolve base ref (default to HEAD if not specified)
    const useBaseRef = baseRef || 'HEAD';

    // Fetch latest from remote first (best effort)
    try {
      await execFileAsync('git', ['fetch', '--quiet'], {
        cwd: projectPath,
        timeout: 30000,
      });
    } catch (fetchErr) {
      log.debug('WorktreePool: Fetch failed (continuing with local)', { error: fetchErr });
    }

    // Create the worktree
    await execFileAsync(
      'git',
      ['worktree', 'add', '-b', reserveBranch, reservePath, useBaseRef],
      { cwd: projectPath }
    );

    log.info('WorktreePool: Created reserve worktree', {
      projectId,
      path: reservePath,
      branch: reserveBranch,
    });

    const reserve: ReserveWorktree = {
      id: this.stableIdFromPath(reservePath),
      path: reservePath,
      branch: reserveBranch,
      projectId,
      projectPath,
      baseRef: useBaseRef,
      createdAt: new Date().toISOString(),
    };

    this.reserves.set(projectId, reserve);
  }

  /**
   * Claim a reserve worktree for a new task.
   * Renames the reserve to match the task name and returns it instantly.
   */
  async claimReserve(
    projectId: string,
    projectPath: string,
    taskName: string,
    requestedBaseRef?: string,
    autoApprove?: boolean
  ): Promise<ClaimResult | null> {
    const reserve = this.reserves.get(projectId);
    if (!reserve) {
      log.debug('WorktreePool: No reserve available for project', { projectId });
      return null;
    }

    // Check if reserve is stale (too old)
    if (this.isReserveStale(reserve)) {
      log.info('WorktreePool: Reserve is stale, discarding', {
        projectId,
        ageMinutes: ((Date.now() - new Date(reserve.createdAt).getTime()) / 60000).toFixed(1),
      });
      // Remove stale reserve and clean it up in background
      this.reserves.delete(projectId);
      this.cleanupReserve(reserve).catch(() => {});
      // Start creating a fresh reserve for next time
      this.replenishReserve(projectId, projectPath, requestedBaseRef);
      return null; // Caller will use fallback (sync creation)
    }

    // Remove from pool immediately to prevent double-claims
    this.reserves.delete(projectId);

    try {
      const result = await this.transformReserve(
        reserve,
        taskName,
        requestedBaseRef,
        autoApprove
      );

      // Start background replenishment
      this.replenishReserve(projectId, projectPath, requestedBaseRef);

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
  private async transformReserve(
    reserve: ReserveWorktree,
    taskName: string,
    requestedBaseRef?: string,
    autoApprove?: boolean
  ): Promise<ClaimResult> {
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

    // Rename the branch (instant operation)
    await execFileAsync('git', ['branch', '-m', reserve.branch, newBranch], {
      cwd: newPath,
    });

    log.info('WorktreePool: Transformed reserve to task worktree', {
      oldPath: reserve.path,
      newPath,
      oldBranch: reserve.branch,
      newBranch,
    });

    // Check if we need to switch base refs
    let needsBaseRefSwitch = false;
    if (requestedBaseRef && requestedBaseRef !== reserve.baseRef && requestedBaseRef !== 'HEAD') {
      needsBaseRefSwitch = true;
      // Do the base ref switch (this might take a moment but is still faster than full creation)
      try {
        await execFileAsync('git', ['reset', '--hard', requestedBaseRef], {
          cwd: newPath,
        });
        log.info('WorktreePool: Switched base ref', { newPath, requestedBaseRef });
        needsBaseRefSwitch = false; // Successfully switched
      } catch (error) {
        log.warn('WorktreePool: Failed to switch base ref', { error });
        // Continue anyway - user can handle this
      }
    }

    // Preserve .env files from project to worktree
    try {
      // Use worktreeService's preserveFilesToWorktree if exposed, or do it here
      const patterns = ['.env', '.env.keys', '.env.local', '.env.*.local', '.envrc'];
      await this.preserveFiles(reserve.projectPath, newPath, patterns);
    } catch (preserveErr) {
      log.warn('WorktreePool: Failed to preserve files', { error: preserveErr });
    }

    // Setup auto-approve if enabled
    if (autoApprove) {
      this.ensureClaudeAutoApprove(newPath);
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

    return { worktree, needsBaseRefSwitch };
  }

  /** Replenish reserve in background after claiming */
  private replenishReserve(
    projectId: string,
    projectPath: string,
    baseRef?: string
  ): void {
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
        log.debug('WorktreePool: No remote configured, skipping push');
        return;
      }

      await execFileAsync('git', ['push', '--set-upstream', remote, branchName], {
        cwd: worktreePath,
        timeout: 60000,
      });
      log.info('WorktreePool: Pushed branch to remote', { branchName, remote });
    } catch (error) {
      log.warn('WorktreePool: Failed to push branch', { branchName, error });
    }
  }

  /** Cleanup a reserve worktree */
  private async cleanupReserve(reserve: ReserveWorktree): Promise<void> {
    try {
      await execFileAsync('git', ['worktree', 'remove', '--force', reserve.path], {
        cwd: reserve.projectPath,
      });
      // Also delete the branch
      await execFileAsync('git', ['branch', '-D', reserve.branch], {
        cwd: reserve.projectPath,
      });
      log.info('WorktreePool: Cleaned up reserve', { path: reserve.path });
    } catch (error) {
      log.warn('WorktreePool: Failed to cleanup reserve', { error });
    }
  }

  /** Remove reserve for a project (e.g., when project is removed) */
  async removeReserve(projectId: string): Promise<void> {
    const reserve = this.reserves.get(projectId);
    if (!reserve) return;

    this.reserves.delete(projectId);
    await this.cleanupReserve(reserve);
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

  /** Preserve files from source to target */
  private async preserveFiles(
    sourcePath: string,
    targetPath: string,
    patterns: string[]
  ): Promise<void> {
    for (const pattern of patterns) {
      const sourceFile = path.join(sourcePath, pattern);
      const targetFile = path.join(targetPath, pattern);
      if (fs.existsSync(sourceFile) && !fs.existsSync(targetFile)) {
        try {
          fs.copyFileSync(sourceFile, targetFile);
        } catch {}
      }
    }
  }

  /** Setup Claude auto-approve settings */
  private ensureClaudeAutoApprove(worktreePath: string): void {
    try {
      const settingsDir = path.join(worktreePath, '.claude');
      if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
      }
      const settingsFile = path.join(settingsDir, 'settings.json');
      let settings: any = {};
      if (fs.existsSync(settingsFile)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        } catch {}
      }
      settings.autoApprove = true;
      fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    } catch (error) {
      log.warn('WorktreePool: Failed to setup auto-approve', { error });
    }
  }
}

export const worktreePoolService = new WorktreePoolService();
