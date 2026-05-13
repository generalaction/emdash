import { promises as fs } from 'node:fs';
import path from 'node:path';
import { basenameFromAnyPath, safePathSegment } from '@shared/path-name';
import type {
  ListManagedWorktreesOptions,
  ManagedWorktree,
  ManagedWorktreesSummary,
} from '@shared/worktree-cleanup';
import { sqlite } from '@main/db/client';
import { log } from '@main/lib/logger';
import { appSettingsService } from '../settings/settings-service';

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const STARTUP_CLEANUP_DELAY_MS = 30 * 1000;
const MANAGED_WORKTREES_CACHE_TTL_MS = 30 * 1000;
const ONE_GB = 1024 * 1024 * 1024;

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

function rowRecency(row: WorktreeRow): number {
  const timestamp = row.lastInteractedAt ?? row.taskUpdatedAt ?? row.workspaceUpdatedAt;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? time : 0;
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
      rowRecency(row) > rowRecency(existing)
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

async function directorySize(absPath: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(absPath, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory() && entry.name === 'node_modules') return;
      const entryPath = path.join(absPath, entry.name);
      try {
        if (entry.isDirectory()) {
          total += await directorySize(entryPath);
        } else if (entry.isFile()) {
          total += (await fs.stat(entryPath)).size;
        }
      } catch {}
    })
  );
  return total;
}

function getSortTime(worktree: ManagedWorktree): number {
  const timestamp = worktree.lastInteractedAt ?? worktree.updatedAt;
  const time = Date.parse(timestamp);
  return Number.isFinite(time) ? time : 0;
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
  activePaths: Set<string>
): boolean {
  if (!row.path) return false;
  if (activePaths.has(path.resolve(row.path))) return false;
  return status !== 'active';
}

function parseConfiguredWorktreeDirectory(json: string | null): string | undefined {
  if (!json) return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || !('worktreeDirectory' in parsed)) return undefined;
    const worktreeDirectory = parsed.worktreeDirectory;
    return typeof worktreeDirectory === 'string' && worktreeDirectory.trim()
      ? worktreeDirectory
      : undefined;
  } catch {
    return undefined;
  }
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

  initialize(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.cleanup().catch((error) => {
        log.warn('worktree-cleanup: periodic cleanup failed', { error: String(error) });
      });
    }, CLEANUP_INTERVAL_MS);
    this.timer.unref?.();
    this.startupTimer = setTimeout(() => {
      this.startupTimer = undefined;
      void this.cleanup().catch((error) => {
        log.warn('worktree-cleanup: startup cleanup failed', { error: String(error) });
      });
    }, STARTUP_CLEANUP_DELAY_MS);
    this.startupTimer.unref?.();
  }

  private cacheSummary(summary: ManagedWorktreesSummary): void {
    this.managedWorktreesCache = {
      expiresAt: Date.now() + MANAGED_WORKTREES_CACHE_TTL_MS,
      summary,
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
    if (!options.forceRefresh && this.managedWorktreesCache) {
      if (Date.now() < this.managedWorktreesCache.expiresAt) {
        return this.managedWorktreesCache.summary;
      }
    }

    if (!options.forceRefresh && this.managedWorktreesRefresh) {
      return this.managedWorktreesRefresh;
    }

    const refresh = this.readManagedWorktrees();
    this.managedWorktreesRefresh = refresh;

    try {
      const summary = await refresh;
      this.cacheSummary(summary);
      return summary;
    } finally {
      if (this.managedWorktreesRefresh === refresh) {
        this.managedWorktreesRefresh = undefined;
      }
    }
  }

  private async readManagedWorktrees(): Promise<ManagedWorktreesSummary> {
    const rows = readRows().filter(
      (row): row is WorktreeRow & { path: string } => row.path !== null
    );
    const activePaths = new Set(
      rows.flatMap((row) => (isActiveTaskReference(row) ? [path.resolve(row.path)] : []))
    );
    const visible = await Promise.all(
      rows.map(async (row): Promise<ManagedWorktree> => {
        const pathOnDisk = await exists(row.path);
        const status = classify(row, pathOnDisk);
        const sizeBytes = pathOnDisk ? await directorySize(row.path) : 0;
        return {
          workspaceId: row.workspaceId,
          taskId: row.taskId,
          taskName: row.taskName,
          projectId: row.projectId,
          projectName: row.projectName,
          branch: row.taskBranch,
          path: row.path,
          sizeBytes,
          updatedAt: row.taskUpdatedAt ?? row.workspaceUpdatedAt,
          lastInteractedAt: row.lastInteractedAt,
          archivedAt: row.archivedAt,
          status,
          cleanupEligible: cleanupEligible(row, status, activePaths),
        };
      })
    );
    const knownPaths = new Set(visible.map((worktree) => path.resolve(worktree.path)));
    const localWorktreeDefault = (await appSettingsService.get('localProject'))
      .defaultWorktreeDirectory;
    const projects = readLocalProjects();
    const roots = new Map<string, LocalProjectRow | undefined>();

    for (const project of projects) {
      const configured = parseConfiguredWorktreeDirectory(project.baseProjectSettingsJson);
      const baseDirectory = configured ? path.resolve(configured) : localWorktreeDefault;
      const root = path.join(
        baseDirectory,
        safePathSegment(project.projectName, project.projectId)
      );
      roots.set(path.resolve(root), project);
    }
    const defaultRoot = path.resolve(localWorktreeDefault);
    if (!roots.has(defaultRoot)) roots.set(defaultRoot, undefined);

    const orphans = (
      await Promise.all(
        Array.from(roots).map(async ([root, project]) => {
          if (!(await exists(root))) return [];
          const paths = await findWorktreeDirectories(root);
          return Promise.all(
            paths.map(async (worktreePath): Promise<ManagedWorktree | null> => {
              const resolvedPath = path.resolve(worktreePath);
              if (knownPaths.has(resolvedPath)) return null;
              const stats = await fs.stat(worktreePath).catch(() => undefined);
              const updatedAt = stats?.mtime.toISOString() ?? new Date(0).toISOString();
              const displayName = basenameFromAnyPath(worktreePath) || worktreePath;
              return {
                workspaceId: `path:${resolvedPath}`,
                taskId: null,
                taskName: displayName,
                projectId: project?.projectId ?? null,
                projectName: project?.projectName ?? path.basename(path.dirname(worktreePath)),
                branch: null,
                path: worktreePath,
                sizeBytes: await directorySize(worktreePath),
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
      worktrees: visible.sort((a, b) => getSortTime(b) - getSortTime(a)),
      totalSizeBytes: visible.reduce((sum, worktree) => sum + worktree.sizeBytes, 0),
      cleanedCount: 0,
      cleanedSizeBytes: 0,
    };
  }

  async cleanup(): Promise<ManagedWorktreesSummary> {
    const settings = await appSettingsService.get('worktreeCleanup');
    const summary = await this.listManagedWorktrees({ forceRefresh: true });
    const maxSizeBytes = settings.maxTotalSizeGb > 0 ? settings.maxTotalSizeGb * ONE_GB : Infinity;
    const removed = new Set<string>();
    let remainingCount = summary.worktrees.length;
    let remainingSize = summary.totalSizeBytes;
    let cleanedSizeBytes = 0;

    const candidates = summary.worktrees
      .filter((worktree) => worktree.cleanupEligible)
      .sort((a, b) => getSortTime(a) - getSortTime(b));

    for (const worktree of candidates) {
      if (remainingCount <= settings.maxWorktrees && remainingSize <= maxSizeBytes) break;
      await this.removeWorktree(worktree);
      removed.add(worktree.workspaceId);
      remainingCount -= 1;
      remainingSize -= worktree.sizeBytes;
      cleanedSizeBytes += worktree.sizeBytes;
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
