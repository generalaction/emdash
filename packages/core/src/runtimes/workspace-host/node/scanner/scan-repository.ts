import { readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { formatAbsolute, parseAbsolute, type HostAbsolutePath } from '@primitives/path/api';
import type { BoundExec, ExecError } from '@services/exec/api';
import type {
  WorkspaceHostDiffStats,
  WorkspaceHostError,
  WorkspaceHostRepoSnapshot,
  WorkspaceHostSnapshotRequest,
  WorkspaceHostWorktreeObservation,
} from '../../api';
import { workspaceHostRepoSnapshotSchema } from '../../api';
import { createWorkspaceHostGitExec, parseWorkspaceHostWorktreeList } from '../git';

export interface ScanRepositoryOptions {
  exec?: BoundExec;
  now?: () => number;
  concurrency?: number;
}

export async function scanRepository(
  request: WorkspaceHostSnapshotRequest,
  options: ScanRepositoryOptions = {}
): Promise<Result<WorkspaceHostRepoSnapshot, WorkspaceHostError>> {
  const repoRoot = formatAbsolute(request.repoRoot);
  const exec = options.exec ?? createWorkspaceHostGitExec(repoRoot);
  const now = options.now ?? Date.now;

  try {
    const [worktreesResult, commonDirResult] = await Promise.all([
      exec.exec(['worktree', 'list', '--porcelain']),
      exec.exec(['rev-parse', '--git-common-dir']),
    ]);
    const commonDir = resolveGitPath(repoRoot, commonDirResult.stdout.trim());
    const adminNames = await readAdminNames(commonDir);
    const worktrees = parseWorkspaceHostWorktreeList(worktreesResult.stdout, parseAbsoluteOrThrow);

    const observations =
      request.tier === 'full'
        ? await mapWithConcurrency(worktrees, options.concurrency ?? 4, async (worktree) =>
            enrichWorktree(exec.withCwd(formatAbsolute(worktree.worktreePath)), {
              path: worktree.worktreePath,
              adminName: adminNames.get(formatAbsolute(worktree.worktreePath)),
              isMain: worktree.isMain,
              head: worktree.head,
              branch:
                worktree.head.kind === 'branch' || worktree.head.kind === 'unborn'
                  ? worktree.head.name
                  : null,
              locked: worktree.locked,
              prunable: worktree.prunable,
              prunableReason: worktree.prunableReason,
              status: worktree.prunable ? 'corrupted' : 'present',
              corruptionReason: worktree.prunableReason,
            })
          )
        : worktrees.map((worktree) => ({
            path: worktree.worktreePath,
            adminName: adminNames.get(formatAbsolute(worktree.worktreePath)),
            isMain: worktree.isMain,
            head: worktree.head,
            branch:
              worktree.head.kind === 'branch' || worktree.head.kind === 'unborn'
                ? worktree.head.name
                : null,
            locked: worktree.locked,
            prunable: worktree.prunable,
            prunableReason: worktree.prunableReason,
            status: worktree.prunable ? ('corrupted' as const) : ('present' as const),
            corruptionReason: worktree.prunableReason,
          }));

    return ok(
      workspaceHostRepoSnapshotSchema.parse({
        repoRoot: request.repoRoot,
        scannedAt: now(),
        tier: request.tier,
        repository: {
          path: request.repoRoot,
          status: 'present',
          defaultBranch: await readDefaultBranch(exec),
        },
        worktrees: observations,
      })
    );
  } catch (error) {
    return err(errorToWorkspaceHostError(error));
  }
}

async function enrichWorktree(
  exec: BoundExec,
  base: WorkspaceHostWorktreeObservation
): Promise<WorkspaceHostWorktreeObservation> {
  if (base.status === 'corrupted') {
    return base;
  }

  const [dirty, diffStats, divergence] = await Promise.all([
    readDirty(exec),
    readDiffStats(exec),
    base.branch ? readDivergence(exec) : Promise.resolve(undefined),
  ]);

  return {
    ...base,
    dirty,
    diffStats,
    ...(divergence ? { ahead: divergence.ahead, behind: divergence.behind } : {}),
  };
}

async function readDefaultBranch(exec: BoundExec): Promise<string | undefined> {
  try {
    const result = await exec.exec([
      'symbolic-ref',
      '--quiet',
      '--short',
      'refs/remotes/origin/HEAD',
    ]);
    return result.stdout.trim().replace(/^origin\//, '') || undefined;
  } catch {
    return undefined;
  }
}

async function readDirty(exec: BoundExec): Promise<boolean> {
  const result = await exec.exec(['status', '--porcelain=v1', '--untracked-files=normal'], {
    maxBuffer: 1024 * 128,
  });
  return result.stdout.trim().length > 0;
}

async function readDiffStats(exec: BoundExec): Promise<WorkspaceHostDiffStats> {
  let result: Awaited<ReturnType<BoundExec['exec']>>;
  try {
    result = await exec.exec(['diff', '--numstat', 'HEAD', '--'], { maxBuffer: 1024 * 1024 });
  } catch {
    return { added: 0, deleted: 0 };
  }
  let added = 0;
  let deleted = 0;
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [rawAdded, rawDeleted] = line.split('\t');
    added += parseNumstatValue(rawAdded);
    deleted += parseNumstatValue(rawDeleted);
  }
  return { added, deleted };
}

function parseNumstatValue(value: string | undefined): number {
  if (!value || value === '-') return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

async function readDivergence(
  exec: BoundExec
): Promise<{ ahead: number; behind: number } | undefined> {
  try {
    await exec.exec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    const result = await exec.exec(['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
    const [aheadRaw, behindRaw] = result.stdout.trim().split(/\s+/u);
    return {
      ahead: Number.parseInt(aheadRaw ?? '0', 10) || 0,
      behind: Number.parseInt(behindRaw ?? '0', 10) || 0,
    };
  } catch {
    return undefined;
  }
}

async function readAdminNames(commonDir: string): Promise<Map<string, string>> {
  const byPath = new Map<string, string>();
  const worktreesDir = join(commonDir, 'worktrees');
  let entries: string[];
  try {
    entries = await readdir(worktreesDir);
  } catch {
    return byPath;
  }

  await Promise.all(
    entries.map(async (adminName) => {
      try {
        const gitdir = (await readFile(join(worktreesDir, adminName, 'gitdir'), 'utf8')).trim();
        const worktreePath = dirname(gitdir);
        byPath.set(worktreePath, adminName);
      } catch {
        // Corrupted admin dirs are already surfaced by `git worktree list --porcelain --verbose`.
      }
    })
  );
  return byPath;
}

function resolveGitPath(cwd: string, rawPath: string): string {
  return isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
}

function parseAbsoluteOrThrow(path: string): HostAbsolutePath {
  const parsed = parseAbsolute(path);
  if (!parsed.success) {
    throw new Error(`Git returned a non-absolute worktree path: ${path}`);
  }
  return parsed.data;
}

async function mapWithConcurrency<T, U>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await fn(items[index]!);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function errorToWorkspaceHostError(error: unknown): WorkspaceHostError {
  const maybeExec = error as Partial<ExecError>;
  if (typeof maybeExec.exitCode === 'number' || maybeExec.name === 'ExecError') {
    return {
      type: 'git-command-failed',
      message: error instanceof Error ? error.message : String(error),
      code: maybeExec.exitCode != null ? String(maybeExec.exitCode) : undefined,
    };
  }
  return {
    type: 'filesystem-error',
    message: error instanceof Error ? error.message : String(error),
  };
}
