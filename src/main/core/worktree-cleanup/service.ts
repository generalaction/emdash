import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { sqlite } from '@main/db/client';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';
import {
  managedWorktreeRefreshCompleteChannel,
  managedWorktreeSizeUpdatedChannel,
} from '@shared/events/worktree-events';
import { basenameFromAnyPath, safePathSegment } from '@shared/path-name';
import { baseProjectSettingsSchema } from '@shared/project-settings';
import {
  WORKTREE_CLEANUP_INTERVAL_MS,
  type ListManagedWorktreesOptions,
  type ManagedWorktree,
  type ManagedWorktreesSummary,
} from '@shared/worktree-cleanup';
import { appSettingsService } from '../settings/settings-service';

const execFileAsync = promisify(execFile);

const STARTUP_CLEANUP_DELAY_MS = 30 * 1000;
const MANAGED_WORKTREES_CACHE_TTL_MS = 30 * 1000;
const ONE_GB = 1024 * 1024 * 1024;
// Caps total in-flight readdir/stat syscalls across all directorySize walks.
// Without this, recursive Promise.all fans out unboundedly into node_modules trees.
const FS_SIZE_CONCURRENCY = 16;
// Caps how many `du` (or fallback walker) calls run in parallel during size streaming.
// Higher = faster total, but heavier disk pressure when many worktrees coexist.
const SIZE_STREAM_CONCURRENCY = 4;
const DU_TIMEOUT_MS = 120_000;

type WorktreeRow = {
  workspaceId: string;
  path: string | null;
  workspaceUpdatedAt: string;
  taskId: string | null;
  taskName: string | null;
  taskBranch: string | null;
  taskStatus: string | null;
  taskUpdatedAt: string | null;
  lastInteractedAt: string | null;
  archivedAt: string | null;
  projectId: string | null;
  projectName: string | null;
  projectPath: string | null;
};

type LocalProjectRow = {
  projectId: string;
  projectName: string;
  projectPath: string;
  baseProjectSettingsJson: string | null;
};

type ManagedWorktreeRoot = {
  project: LocalProjectRow;
  root: string;
  resolvedRoot: string;
};

function recencyOf(...timestamps: Array<string | null | undefined>): number {
  for (const timestamp of timestamps) {
    if (!timestamp) continue;
    const time = Date.parse(timestamp);
    if (Number.isFinite(time)) return time;
  }
  return 0;
}

function readRows(): WorktreeRow[] {
  const rows = sqlite
    .prepare(
      `
        SELECT
          w.id AS workspaceId,
          w.path AS path,
          w.updated_at AS workspaceUpdatedAt,
          t.id AS taskId,
          t.name AS taskName,
          t.task_branch AS taskBranch,
          t.status AS taskStatus,
          t.updated_at AS taskUpdatedAt,
          t.last_interacted_at AS lastInteractedAt,
          t.archived_at AS archivedAt,
          p.id AS projectId,
          p.name AS projectName,
          p.path AS projectPath
        FROM workspaces w
        LEFT JOIN tasks t ON t.workspace_id = w.id
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE w.type = 'local' AND w.path IS NOT NULL
          AND (p.path IS NULL OR w.path != p.path)
      `
    )
    .all() as WorktreeRow[];

  // A workspace can have many tasks; collapse to one representative row per workspace,
  // preferring an active task (no archivedAt), then the most recently touched.
  const byWorkspace = new Map<string, WorktreeRow>();
  for (const row of rows) {
    const existing = byWorkspace.get(row.workspaceId);
    if (!existing) {
      byWorkspace.set(row.workspaceId, row);
      continue;
    }
    const existingActive = existing.taskId && !existing.archivedAt;
    const candidateActive = row.taskId && !row.archivedAt;
    if (candidateActive && !existingActive) {
      byWorkspace.set(row.workspaceId, row);
    } else if (
      candidateActive === Boolean(existingActive) &&
      recencyOf(row.lastInteractedAt, row.taskUpdatedAt, row.workspaceUpdatedAt) >
        recencyOf(existing.lastInteractedAt, existing.taskUpdatedAt, existing.workspaceUpdatedAt)
    ) {
      byWorkspace.set(row.workspaceId, row);
    }
  }
  return Array.from(byWorkspace.values());
}

function readLocalProjects(): LocalProjectRow[] {
  return sqlite
    .prepare(
      `
        SELECT
          p.id AS projectId,
          p.name AS projectName,
          p.path AS projectPath,
          ps.base_project_settings_json AS baseProjectSettingsJson
        FROM projects p
        LEFT JOIN project_settings ps ON ps.project_id = p.id
        WHERE p.workspace_provider = 'local'
      `
    )
    .all() as LocalProjectRow[];
}

async function exists(absPath: string): Promise<boolean> {
  try {
    await fs.access(absPath);
    return true;
  } catch {
    return false;
  }
}

function createConcurrencyLimiter(limit: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: Array<() => void> = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task().then(
          (value) => {
            next();
            resolve(value);
          },
          (error) => {
            next();
            reject(error);
          }
        );
      };
      if (active < limit) run();
      else queue.push(run);
    });
}

type FsLimit = <T>(task: () => Promise<T>) => Promise<T>;

async function duSize(absPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('du', ['-sk', absPath], {
      maxBuffer: 1024 * 1024,
      timeout: DU_TIMEOUT_MS,
    });
    const kb = Number.parseInt(stdout.trim().split(/\s+/)[0], 10);
    return Number.isFinite(kb) ? kb * 1024 : null;
  } catch (error) {
    const stdout =
      typeof error === 'object' && error && 'stdout' in error ? error.stdout : undefined;
    if (typeof stdout === 'string' || Buffer.isBuffer(stdout)) {
      const kb = Number.parseInt(stdout.toString().trim().split(/\s+/)[0], 10);
      if (Number.isFinite(kb)) return kb * 1024;
    }

    log.debug('worktree-cleanup: du failed', {
      path: absPath,
      error: String(error),
    });
    return null;
  }
}

async function walkerDirectorySize(absPath: string, limit: FsLimit): Promise<number> {
  const entries = await limit(() => fs.readdir(absPath, { withFileTypes: true })).catch((error) => {
    log.debug('worktree-cleanup: directorySize readdir failed', {
      path: absPath,
      error: String(error),
    });
    return [];
  });
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(absPath, entry.name);
      try {
        if (entry.isDirectory()) {
          return await walkerDirectorySize(entryPath, limit);
        } else if (entry.isFile()) {
          return (await limit(() => fs.stat(entryPath))).size;
        }
      } catch (error) {
        log.debug('worktree-cleanup: directorySize entry failed', {
          path: entryPath,
          error: String(error),
        });
      }
      return 0;
    })
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}

async function directorySize(absPath: string, limit: FsLimit): Promise<number> {
  // `du -sk` is orders of magnitude faster than walking node_modules tree-by-tree.
  // Windows lacks `du`, and BSD/macOS `du` may fail on permission-denied subtrees —
  // on Unix, avoid the JS fallback because a timed-out `du` followed by a recursive
  // walker is the slow path that makes the cleanup page take minutes to settle.
  if (process.platform !== 'win32') {
    const fast = await duSize(absPath);
    return fast ?? 0;
  }
  return walkerDirectorySize(absPath, limit);
}

function sortTime(worktree: ManagedWorktree): number {
  return recencyOf(worktree.lastInteractedAt, worktree.updatedAt);
}

function classify(row: WorktreeRow, pathExists: boolean): ManagedWorktree['status'] {
  if (!pathExists) return 'missing';
  if (!row.taskId) return 'orphaned';
  if (row.archivedAt) return 'archived';
  return 'active';
}

function isActiveTaskReference(row: WorktreeRow): boolean {
  return Boolean(row.path && row.taskId && !row.archivedAt);
}

function cleanupEligible(
  row: WorktreeRow,
  status: ManagedWorktree['status'],
  activePaths: Set<string>,
  isManagedPath: boolean
): boolean {
  if (!row.path) return false;
  if (activePaths.has(path.resolve(row.path))) return false;
  if (!isManagedPath) return false;
  return status !== 'active';
}

const worktreeDirectoryFieldSchema = baseProjectSettingsSchema.pick({ worktreeDirectory: true });

function parseConfiguredWorktreeDirectory(json: string | null): string | undefined {
  if (!json) return undefined;
  try {
    const parsed = worktreeDirectoryFieldSchema.safeParse(JSON.parse(json));
    return parsed.success && parsed.data.worktreeDirectory
      ? parsed.data.worktreeDirectory
      : undefined;
  } catch {
    return undefined;
  }
}

function isPathInsideDirectory(candidatePath: string, directory: string): boolean {
  const relative = path.relative(directory, path.resolve(candidatePath));
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function readManagedWorktreeRoots(): Promise<Map<string, ManagedWorktreeRoot>> {
  const localWorktreeDefault = (await appSettingsService.get('localProject'))
    .defaultWorktreeDirectory;
  const roots = new Map<string, ManagedWorktreeRoot>();

  for (const project of readLocalProjects()) {
    const configured = parseConfiguredWorktreeDirectory(project.baseProjectSettingsJson);
    const baseDirectory = configured
      ? path.resolve(configured)
      : localWorktreeDefault.trim()
        ? localWorktreeDefault
        : undefined;
    if (!baseDirectory) continue;

    const root = path.join(baseDirectory, safePathSegment(project.projectName, project.projectId));
    roots.set(project.projectId, {
      project,
      root,
      resolvedRoot: path.resolve(root),
    });
  }

  return roots;
}

async function findWorktreeDirectories(root: string): Promise<string[]> {
  const found: string[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    if (entries.some((entry) => entry.name === '.git')) {
      found.push(directory);
      return;
    }

    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
        .map((entry) => walk(path.join(directory, entry.name)))
    );
  }

  await walk(root);
  return found;
}

export class WorktreeCleanupService {
  private timer: NodeJS.Timeout | undefined;
  private startupTimer: NodeJS.Timeout | undefined;
  private managedWorktreesCache:
    | { expiresAt: number; summary: ManagedWorktreesSummary }
    | undefined;
  private managedWorktreesRefresh: Promise<ManagedWorktreesSummary> | undefined;
  private sizeStreamPromise: Promise<void> | undefined;
  private cleanupRun: Promise<ManagedWorktreesSummary> | undefined;
  private destructiveQueue: Promise<unknown> = Promise.resolve();
  private cacheGeneration = 0;
  private readonly limitFs: FsLimit = createConcurrencyLimiter(FS_SIZE_CONCURRENCY);

  private bumpCacheGeneration(): void {
    this.cacheGeneration += 1;
  }

  private isCurrentGeneration(generation: number): boolean {
    return generation === this.cacheGeneration;
  }

  private enqueueDestructive<T>(task: () => Promise<T>): Promise<T> {
    const runTask = async () => {
      this.bumpCacheGeneration();
      try {
        return await task();
      } finally {
        this.bumpCacheGeneration();
      }
    };
    const run = this.destructiveQueue.then(runTask, runTask);
    this.destructiveQueue = run.catch(() => {});
    return run;
  }

  initialize(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runScheduledCleanup('periodic');
    }, WORKTREE_CLEANUP_INTERVAL_MS);
    this.timer.unref?.();
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      void this.runScheduledCleanup('startup');
    }, STARTUP_CLEANUP_DELAY_MS);
    this.startupTimer.unref?.();
  }

  private async runScheduledCleanup(reason: 'startup' | 'periodic'): Promise<void> {
    const settings = await appSettingsService.get('worktreeCleanup').catch(() => undefined);
    if (!settings?.autoCleanupEnabled) return;
    await this.cleanup().catch((error) => {
      log.warn(`worktree-cleanup: ${reason} cleanup failed`, { error: String(error) });
    });
  }

  private cacheSummary(summary: ManagedWorktreesSummary): void {
    this.managedWorktreesCache = {
      expiresAt: Date.now() + MANAGED_WORKTREES_CACHE_TTL_MS,
      summary: {
        ...summary,
        cleanedCount: 0,
        cleanedSizeBytes: 0,
      },
    };
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = undefined;
  }

  async listManagedWorktrees(
    options: ListManagedWorktreesOptions = {}
  ): Promise<ManagedWorktreesSummary> {
    const cacheFresh =
      !options.forceRefresh &&
      this.managedWorktreesCache &&
      Date.now() < this.managedWorktreesCache.expiresAt;

    if (cacheFresh && !options.awaitSizes) {
      return this.managedWorktreesCache!.summary;
    }

    // Trigger a background refresh once and reuse it for any concurrent callers.
    // Sizes stream in via managedWorktreeSizeUpdatedChannel after this returns.
    if (!cacheFresh && !this.managedWorktreesRefresh) {
      this.managedWorktreesRefresh = this.refreshManagedWorktrees();
      void this.managedWorktreesRefresh.then(
        () => {
          this.managedWorktreesRefresh = undefined;
        },
        () => {
          this.managedWorktreesRefresh = undefined;
        }
      );
    }

    if (options.awaitSizes) {
      if (this.managedWorktreesRefresh) await this.managedWorktreesRefresh;
      if (this.sizeStreamPromise) await this.sizeStreamPromise;
      return this.managedWorktreesCache?.summary ?? (await this.buildPreview());
    }

    if (options.forceRefresh) {
      return this.managedWorktreesRefresh ?? this.managedWorktreesCache!.summary;
    }

    // First-ever call (no cache yet): wait for the fast preview phase so the renderer
    // has a list to display. The slow size phase keeps streaming after we return.
    if (!this.managedWorktreesCache) {
      return this.managedWorktreesRefresh!;
    }

    return { ...this.managedWorktreesCache.summary, isRefreshing: true };
  }

  private async refreshManagedWorktrees(): Promise<ManagedWorktreesSummary> {
    const generation = this.cacheGeneration;
    const preview = await this.buildPreview();
    if (!this.isCurrentGeneration(generation)) {
      return this.managedWorktreesCache?.summary ?? (await this.buildPreview());
    }

    this.cacheSummary({ ...preview, isRefreshing: true });

    this.sizeStreamPromise = this.streamSizes(preview, generation)
      .catch((error) => {
        log.warn('worktree-cleanup: size streaming failed', { error: String(error) });
      })
      .finally(() => {
        this.sizeStreamPromise = undefined;
      });

    return { ...preview, isRefreshing: true };
  }

  private async streamSizes(preview: ManagedWorktreesSummary, generation: number): Promise<void> {
    const sizeLimit = createConcurrencyLimiter(SIZE_STREAM_CONCURRENCY);
    const sizes = new Map<string, number>();

    await Promise.all(
      preview.worktrees.map((worktree) =>
        sizeLimit(async () => {
          const sizeBytes =
            worktree.status === 'missing' ? 0 : await directorySize(worktree.path, this.limitFs);
          if (!this.isCurrentGeneration(generation)) return;

          sizes.set(worktree.workspaceId, sizeBytes);

          const current = this.managedWorktreesCache?.summary;
          if (current && this.isCurrentGeneration(generation)) {
            const nextWorktrees = current.worktrees.map((entry) =>
              entry.workspaceId === worktree.workspaceId ? { ...entry, sizeBytes } : entry
            );
            this.cacheSummary({
              ...current,
              worktrees: nextWorktrees,
              totalSizeBytes: nextWorktrees.reduce((sum, entry) => sum + entry.sizeBytes, 0),
              isRefreshing: true,
            });
          }

          events.emit(managedWorktreeSizeUpdatedChannel, {
            workspaceId: worktree.workspaceId,
            sizeBytes,
          });
        })
      )
    );

    if (!this.isCurrentGeneration(generation)) return;

    const final = this.managedWorktreesCache?.summary;
    if (final) {
      this.cacheSummary({ ...final, isRefreshing: false });
    }

    events.emit(managedWorktreeRefreshCompleteChannel, {
      totalSizeBytes: Array.from(sizes.values()).reduce((sum, bytes) => sum + bytes, 0),
    });
  }

  private async buildPreview(): Promise<ManagedWorktreesSummary> {
    const rows = readRows().filter(
      (row): row is WorktreeRow & { path: string } => row.path !== null
    );
    const rootsByProjectId = await readManagedWorktreeRoots();
    const activePaths = new Set(
      rows.flatMap((row) => (isActiveTaskReference(row) ? [path.resolve(row.path)] : []))
    );
    const visible = await Promise.all(
      rows.map(async (row): Promise<ManagedWorktree> => {
        const pathOnDisk = await exists(row.path);
        const status = classify(row, pathOnDisk);
        const projectRoot = row.projectId ? rootsByProjectId.get(row.projectId) : undefined;
        const isManagedPath = projectRoot
          ? isPathInsideDirectory(row.path, projectRoot.resolvedRoot)
          : false;
        return {
          workspaceId: row.workspaceId,
          taskId: row.taskId,
          taskName: row.taskName,
          projectId: row.projectId,
          projectName: row.projectName,
          projectPath: row.projectPath,
          branch: row.taskBranch,
          path: row.path,
          sizeBytes: 0,
          updatedAt: row.taskUpdatedAt ?? row.workspaceUpdatedAt,
          lastInteractedAt: row.lastInteractedAt,
          archivedAt: row.archivedAt,
          status,
          cleanupEligible: cleanupEligible(row, status, activePaths, isManagedPath),
        };
      })
    );
    const knownPaths = new Set(visible.map((worktree) => path.resolve(worktree.path)));
    // Only scan project-specific roots (`<base>/<safePathSegment(name,id)>`).
    // Scanning the bare default worktree directory would treat unrelated git repos
    // sitting in the user's chosen folder as orphaned Emdash worktrees.
    const orphans = (
      await Promise.all(
        Array.from(rootsByProjectId.values()).map(async ({ root, resolvedRoot, project }) => {
          // findWorktreeDirectories catches readdir errors on missing roots and returns [].
          const paths = await findWorktreeDirectories(root);
          return Promise.all(
            paths.map(async (worktreePath): Promise<ManagedWorktree | null> => {
              const resolvedPath = path.resolve(worktreePath);
              if (knownPaths.has(resolvedPath)) return null;
              if (!isPathInsideDirectory(resolvedPath, resolvedRoot)) return null;
              const stats = await fs.stat(worktreePath).catch(() => undefined);
              const updatedAt = stats?.mtime.toISOString() ?? new Date(0).toISOString();
              const displayName = basenameFromAnyPath(worktreePath) || worktreePath;
              return {
                workspaceId: `path:${resolvedPath}`,
                taskId: null,
                taskName: displayName,
                projectId: project.projectId,
                projectName: project.projectName,
                projectPath: project.projectPath,
                branch: null,
                path: worktreePath,
                sizeBytes: 0,
                updatedAt,
                lastInteractedAt: null,
                archivedAt: null,
                status: 'orphaned',
                cleanupEligible: true,
              };
            })
          );
        })
      )
    ).flat();

    for (const orphan of orphans) {
      if (!orphan) continue;
      const resolvedPath = path.resolve(orphan.path);
      if (knownPaths.has(resolvedPath)) continue;
      knownPaths.add(resolvedPath);
      visible.push(orphan);
    }

    return {
      worktrees: visible.sort((a, b) => sortTime(b) - sortTime(a)),
      totalSizeBytes: 0,
      cleanedCount: 0,
      cleanedSizeBytes: 0,
    };
  }

  private async getSummaryForRemoval(): Promise<ManagedWorktreesSummary> {
    const preview = await this.buildPreview();
    const cachedSizes = new Map(
      this.managedWorktreesCache?.summary.worktrees.map((worktree) => [
        worktree.workspaceId,
        worktree.sizeBytes,
      ]) ?? []
    );
    const worktrees = preview.worktrees.map((worktree) => ({
      ...worktree,
      sizeBytes: cachedSizes.get(worktree.workspaceId) ?? worktree.sizeBytes,
    }));

    return {
      ...preview,
      worktrees,
      totalSizeBytes: worktrees.reduce((sum, worktree) => sum + worktree.sizeBytes, 0),
    };
  }

  async removeWorktreeById(workspaceId: string): Promise<ManagedWorktreesSummary> {
    return this.enqueueDestructive(() => this.runRemoveWorktreeById(workspaceId));
  }

  private findOtherActivePathReferences(worktree: ManagedWorktree): WorktreeRow[] {
    const resolvedPath = path.resolve(worktree.path);
    return readRows().filter((row) => {
      if (row.workspaceId === worktree.workspaceId) return false;
      if (!isActiveTaskReference(row) || !row.path) return false;
      return path.resolve(row.path) === resolvedPath;
    });
  }

  private assertNoOtherActivePathReferences(worktree: ManagedWorktree): void {
    const activeReferences = this.findOtherActivePathReferences(worktree);
    if (activeReferences.length === 0) return;

    throw new Error(
      `Worktree ${worktree.workspaceId} is still referenced by active task ${activeReferences[0].taskId}`
    );
  }

  private async runRemoveWorktreeById(workspaceId: string): Promise<ManagedWorktreesSummary> {
    const summary = await this.getSummaryForRemoval();
    const worktree = summary.worktrees.find((entry) => entry.workspaceId === workspaceId);
    if (!worktree) {
      throw new Error(`Worktree ${workspaceId} not found`);
    }

    this.assertNoOtherActivePathReferences(worktree);

    if (worktree.status === 'active') {
      // Archive every non-archived task pointing at this workspace before nuking the dir.
      // archiveTask tears down PTYs/sessions and emits events so the UI updates.
      const activeTasks = sqlite
        .prepare<[string], { taskId: string; projectId: string }>(
          'SELECT id AS taskId, project_id AS projectId FROM tasks WHERE workspace_id = ? AND archived_at IS NULL'
        )
        .all(workspaceId);

      const { archiveTask } = await import('../tasks/operations/archiveTask');
      for (const task of activeTasks) {
        await archiveTask(task.projectId, task.taskId).catch((error: unknown) => {
          log.warn('worktree-cleanup: archiveTask failed during manual removal', {
            workspaceId,
            taskId: task.taskId,
            error: String(error),
          });
          throw error;
        });
      }
    }

    this.assertNoOtherActivePathReferences(worktree);

    await this.removeWorktree(worktree);

    if (worktree.projectPath) {
      await execFileAsync('git', ['-C', worktree.projectPath, 'worktree', 'prune']).catch(
        (error) => {
          log.warn('worktree-cleanup: git worktree prune failed', {
            projectPath: worktree.projectPath,
            error: String(error),
          });
        }
      );
    }

    const next: ManagedWorktreesSummary = {
      ...summary,
      worktrees: summary.worktrees.filter((entry) => entry.workspaceId !== workspaceId),
      totalSizeBytes: summary.totalSizeBytes - worktree.sizeBytes,
      cleanedCount: 1,
      cleanedSizeBytes: worktree.sizeBytes,
    };

    this.cacheSummary(next);
    return next;
  }

  async cleanup(): Promise<ManagedWorktreesSummary> {
    if (this.cleanupRun) return this.cleanupRun;

    const run = this.enqueueDestructive(() => this.runCleanup());
    this.cleanupRun = run;

    try {
      return await run;
    } finally {
      if (this.cleanupRun === run) {
        this.cleanupRun = undefined;
      }
    }
  }

  private async runCleanup(): Promise<ManagedWorktreesSummary> {
    const settings = await appSettingsService.get('worktreeCleanup');
    const summary = await this.listManagedWorktrees({ forceRefresh: true, awaitSizes: true });
    const maxSizeBytes = settings.maxTotalSizeGb > 0 ? settings.maxTotalSizeGb * ONE_GB : Infinity;
    const removed = new Set<string>();
    const projectsToPrune = new Set<string>();
    let remainingCount = summary.worktrees.length;
    let remainingSize = summary.totalSizeBytes;
    let cleanedSizeBytes = 0;

    const candidates = summary.worktrees
      .filter((worktree) => worktree.cleanupEligible)
      .sort((a, b) => sortTime(a) - sortTime(b));

    try {
      for (const worktree of candidates) {
        if (remainingCount <= settings.maxWorktrees && remainingSize <= maxSizeBytes) break;
        await this.removeWorktree(worktree);
        removed.add(worktree.workspaceId);
        if (worktree.projectPath) projectsToPrune.add(worktree.projectPath);
        remainingCount -= 1;
        remainingSize -= worktree.sizeBytes;
        cleanedSizeBytes += worktree.sizeBytes;
      }
    } finally {
      // Prune dangling `.git/worktrees/<name>` metadata once per repo even if cleanup aborts
      // mid-loop, so subsequent `git worktree list` calls don't trip over removed directories.
      await Promise.all(
        Array.from(projectsToPrune).map((projectPath) =>
          execFileAsync('git', ['-C', projectPath, 'worktree', 'prune']).catch((error) => {
            log.warn('worktree-cleanup: git worktree prune failed', {
              projectPath,
              error: String(error),
            });
          })
        )
      );
    }

    const result: ManagedWorktreesSummary = {
      ...summary,
      worktrees: summary.worktrees.filter((worktree) => !removed.has(worktree.workspaceId)),
      totalSizeBytes: remainingSize,
      cleanedCount: removed.size,
      cleanedSizeBytes,
    };

    this.cacheSummary(result);

    return result;
  }

  private async removeWorktree(worktree: ManagedWorktree): Promise<void> {
    if (worktree.status !== 'missing') {
      await fs.rm(worktree.path, { recursive: true, force: true }).catch((error) => {
        log.warn('worktree-cleanup: failed to remove worktree directory', {
          workspaceId: worktree.workspaceId,
          path: worktree.path,
          error: String(error),
        });
        throw error;
      });
    }
    if (worktree.taskId) {
      sqlite
        .prepare(
          'UPDATE workspaces SET path = NULL, key = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        )
        .run(worktree.workspaceId);
    } else {
      sqlite.prepare('DELETE FROM workspaces WHERE id = ?').run(worktree.workspaceId);
    }
  }
}

export const worktreeCleanupService = new WorktreeCleanupService();
