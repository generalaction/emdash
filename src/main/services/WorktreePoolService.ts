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
  async ensureReserve(projectId: string, projectPath: string, baseRef?: string): Promise<void> {
    // Check if we have a fresh (non-stale) reserve
    const existingReserve = this.reserves.get(projectId);
    if (existingReserve && !this.isReserveStale(existingReserve)) {
      // Already have a fresh reserve
      return;
    }

    // If we have a stale reserve, remove it before creating a new one
    if (existingReserve && this.isReserveStale(existingReserve)) {
      log.info('WorktreePool: Replacing stale reserve proactively', { projectId });
      this.reserves.delete(projectId);
      this.cleanupReserve(existingReserve).catch(() => {});
    }

    // Already creating a reserve
    if (this.creationInProgress.has(projectId)) {
      return;
    }

    // Start background creation
    this.creationInProgress.add(projectId);

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

    // Note: We skip git fetch for reserve creation to avoid SSH prompts blocking
    // The worktree will use local refs which is fine for pre-warming purposes

    // Create the worktree
    await execFileAsync('git', ['worktree', 'add', '-b', reserveBranch, reservePath, useBaseRef], {
      cwd: projectPath,
    });

    const reserveId = this.stableIdFromPath(reservePath);
    const reserve: ReserveWorktree = {
      id: reserveId,
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

    // Fetch latest refs before transforming to ensure up-to-date code
    // This is a quick operation (non-blocking) and ensures users always work on fresh code
    try {
      const useBaseRef = requestedBaseRef || reserve.baseRef;
      await this.fetchBaseRef(projectPath, useBaseRef);
    } catch (fetchError) {
      log.warn('WorktreePool: Failed to fetch latest refs, proceeding with local refs', {
        projectId,
        error: fetchError,
      });
      // Continue with local refs - this is not a critical failure
    }

    try {
      const result = await this.transformReserve(reserve, taskName, requestedBaseRef, autoApprove);

      // Start background replenishment
      this.replenishReserve(projectId, projectPath, requestedBaseRef);

      return result;
    } catch (error) {
      log.error('WorktreePool: Failed to claim reserve', { projectId, taskName, error });
      
      // Clean up: Check if reserve was moved by looking for non-existent original path
      // If original path doesn't exist, the worktree was moved and we need to find it
      const originalExists = fs.existsSync(reserve.path);
      
      if (originalExists) {
        // Worktree is still at original location, clean up normally
        this.cleanupReserve(reserve).catch(() => {});
      } else {
        // Worktree was moved but transform failed
        // Look for the moved worktree in the worktrees directory
        try {
          const worktreesDir = path.join(reserve.projectPath, '..', 'worktrees');
          const sluggedName = this.slugify(taskName);
          
          if (fs.existsSync(worktreesDir)) {
            const entries = fs.readdirSync(worktreesDir, { withFileTypes: true });
            // Find worktree that starts with the slugged task name (since hash is random)
            const movedEntry = entries.find(
              (e) => e.isDirectory() && e.name.startsWith(sluggedName)
            );
            
            if (movedEntry) {
              const movedPath = path.join(worktreesDir, movedEntry.name);
              log.debug('WorktreePool: Found moved worktree, cleaning up', { movedPath });
              
              // Try to remove via git worktree command
              try {
                await execFileAsync('git', ['worktree', 'remove', '--force', movedPath], {
                  cwd: reserve.projectPath,
                });
              } catch {
                // Fallback to direct removal
                try {
                  fs.rmSync(movedPath, { recursive: true, force: true });
                } catch {}
              }
            }
          }
        } catch (cleanupError) {
          log.warn('WorktreePool: Failed to clean up moved worktree', { cleanupError });
        }
      }
      
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
        log.debug('WorktreePool: No remote configured, skipping push');
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
      // Also delete the branch
      await execFileAsync('git', ['branch', '-D', reserve.branch], {
        cwd: reserve.projectPath,
      });
    } catch {
      // Cleanup failures are non-critical
    }
  }

  /** Fetch latest refs for a base branch (non-blocking, handles errors gracefully) */
  private async fetchBaseRef(projectPath: string, baseRef: string): Promise<void> {
    try {
      // Parse the base ref to extract remote and branch
      // Common formats: "origin/main", "main", "origin/develop"
      const parts = baseRef.split('/');
      const remote = parts.length > 1 ? parts[0] : 'origin';
      const branch = parts.length > 1 ? parts.slice(1).join('/') : baseRef;

      // Check if remote exists
      const { stdout: remotesOut } = await execFileAsync('git', ['remote'], {
        cwd: projectPath,
      });
      const remotes = remotesOut.trim().split('\n').filter(Boolean);
      
      if (!remotes.includes(remote)) {
        log.debug('WorktreePool: No remote found, skipping fetch', { remote });
        return;
      }

      // Perform fetch with timeout to avoid hanging
      await execFileAsync('git', ['fetch', remote, branch], {
        cwd: projectPath,
        timeout: 10000, // 10 second timeout
      });
      log.debug('WorktreePool: Successfully fetched latest refs', { remote, branch });
    } catch (error) {
      // Fetch failures are non-critical (could be SSH issues, network issues, etc.)
      // Just log and continue
      throw error;
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

  /**
   * Clean up orphaned reserve worktrees from previous sessions.
   * Called on app startup to handle reserves left behind from crashes or forced quits.
   * Runs in background and doesn't block app startup.
   */
  async cleanupOrphanedReserves(): Promise<void> {
    // Small delay to not compete with critical startup tasks
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get all worktree directories from database projects
    const possibleWorktreeDirs = new Set<string>();
    
    try {
      // Import DatabaseService dynamically to avoid circular dependencies
      const { databaseService } = await import('./DatabaseService');
      const projects = await databaseService.getProjects();
      
      // Add worktree directories from all known projects
      for (const project of projects) {
        if (project.path) {
          const worktreesDir = path.join(project.path, '..', 'worktrees');
          possibleWorktreeDirs.add(path.resolve(worktreesDir));
        }
      }
    } catch (error) {
      log.warn('WorktreePool: Failed to load projects from database for cleanup', { error });
    }

    // Also include common hardcoded directories as fallback
    const homedir = require('os').homedir();
    const commonDirs = [
      path.join(homedir, 'cursor', 'worktrees'),
      path.join(homedir, 'Documents', 'worktrees'),
      path.join(homedir, 'Projects', 'worktrees'),
      path.join(homedir, 'code', 'worktrees'),
      path.join(homedir, 'dev', 'worktrees'),
    ];
    commonDirs.forEach((dir) => possibleWorktreeDirs.add(dir));

    // Collect all orphaned reserves first (fast sync scan)
    const orphanedReserves: { path: string; name: string }[] = [];
    for (const worktreesDir of possibleWorktreeDirs) {
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

    log.info('WorktreePool: Found orphaned reserves, cleaning up', {
      count: orphanedReserves.length,
    });

    // Clean up all reserves in parallel (silently)
    await Promise.allSettled(
      orphanedReserves.map((reserve) => this.cleanupOrphanedReserve(reserve.path, reserve.name))
    );
  }

  /** Clean up a single orphaned reserve */
  private async cleanupOrphanedReserve(reservePath: string, name: string): Promise<boolean> {
    try {
      // Try to find the parent git repo to properly remove the worktree
      const gitDirPath = path.join(reservePath, '.git');
      if (fs.existsSync(gitDirPath)) {
        const gitDirContent = fs.readFileSync(gitDirPath, 'utf8');
        const match = gitDirContent.match(/gitdir:\s*(.+)/);
        if (match) {
          // Extract the main repo path from the gitdir reference
          const gitWorktreePath = match[1].trim();
          const mainGitDir = gitWorktreePath.replace(/\/\.git\/worktrees\/.*$/, '');

          if (fs.existsSync(mainGitDir)) {
            // Remove worktree via git
            await execFileAsync('git', ['worktree', 'remove', '--force', reservePath], {
              cwd: mainGitDir,
            });

            // Try to remove the reserve branch
            const branchMatch = name.match(/^_reserve-(.+)$/);
            if (branchMatch) {
              const branchName = `_reserve/${branchMatch[1]}`;
              try {
                await execFileAsync('git', ['branch', '-D', branchName], { cwd: mainGitDir });
              } catch {
                // Branch may not exist
              }
            }

            return true;
          }
        }
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

  /** Preserve files from source to target, supporting glob patterns */
  private async preserveFiles(
    sourcePath: string,
    targetPath: string,
    patterns: string[]
  ): Promise<void> {
    for (const pattern of patterns) {
      // Check if pattern contains glob characters
      if (pattern.includes('*')) {
        // Handle glob pattern - scan directory and match
        try {
          const entries = fs.readdirSync(sourcePath, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isFile()) continue;
            // Simple glob matching for patterns like .env.*.local
            const regex = new RegExp(
              '^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$'
            );
            if (regex.test(entry.name)) {
              const sourceFile = path.join(sourcePath, entry.name);
              const targetFile = path.join(targetPath, entry.name);
              if (!fs.existsSync(targetFile)) {
                try {
                  fs.copyFileSync(sourceFile, targetFile);
                } catch {}
              }
            }
          }
        } catch {}
      } else {
        // Handle literal filename
        const sourceFile = path.join(sourcePath, pattern);
        const targetFile = path.join(targetPath, pattern);
        if (fs.existsSync(sourceFile) && !fs.existsSync(targetFile)) {
          try {
            fs.copyFileSync(sourceFile, targetFile);
          } catch {}
        }
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
