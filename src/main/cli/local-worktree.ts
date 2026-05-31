/**
 * Builds a `WorktreeService` for a local project the same way the app does in
 * `createLocalProvider` (see src/main/core/projects/create-project-provider.ts),
 * but without the surrounding Electron/project-manager lifecycle.
 *
 * This is the shared building block the CLI uses to create worktrees that are
 * byte-identical to UI-created ones (same git commands, same pool path layout).
 */

import fs from 'node:fs';
import path from 'node:path';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { GitService } from '@main/core/git/impl/git-service';
import type { ProjectSettingsProvider } from '@main/core/projects/settings/provider';
import { LocalWorktreeHost } from '@main/core/projects/worktrees/hosts/local-worktree-host';
import { WorktreeService } from '@main/core/projects/worktrees/worktree-service';
import { safePathSegment } from '@shared/path-name';
import { ok, type Result } from '@shared/result';

/**
 * A minimal settings provider for the CLI worktree path. Only the methods that
 * `WorktreeService` actually calls during worktree creation are meaningful
 * (`getWorktreeDirectory`, `getBaseRemote`, `get`); the rest return safe
 * defaults. The real app injects `LocalProjectSettingsProvider`; tests inject
 * this stub so they don't depend on the global app-settings singleton.
 */
export class CliWorktreeSettings implements ProjectSettingsProvider {
  constructor(
    private readonly worktreeDirectory: string,
    private readonly baseRef: string,
    private readonly baseRemote: string = 'origin'
  ) {}

  async getDefaultBranch(): Promise<string> {
    return this.baseRef;
  }
  async getBaseRemote(): Promise<string> {
    return this.baseRemote;
  }
  async getPushRemote(): Promise<string> {
    return this.baseRemote;
  }
  async getDefaultWorktreeDirectory(): Promise<string> {
    return this.worktreeDirectory;
  }
  async getWorktreeDirectory(): Promise<string> {
    return this.worktreeDirectory;
  }
  async get(): Promise<Record<string, never>> {
    return {};
  }
  async update(): Promise<Result<void, never>> {
    return ok();
  }
  async patch(): Promise<Result<void, never>> {
    return ok();
  }
  async ensure(): Promise<void> {}
}

export type LocalWorktreeContext = {
  worktreeService: WorktreeService;
  repoGit: GitService;
  /** Absolute root of the worktree pool for this project (…/<worktreeDir>/<project>). */
  poolPath: string;
};

/**
 * Assembles the local git + worktree services for a project. Mirrors
 * `createLocalProvider`'s worktree wiring exactly so the resulting worktrees
 * are indistinguishable from those the UI creates.
 */
export async function buildLocalWorktreeContext(args: {
  projectName: string;
  projectId: string;
  repoPath: string;
  baseRef: string;
  worktreeDirectory: string;
  /** When supplied (production), used for preserve patterns / remotes parity. */
  settings?: ProjectSettingsProvider;
}): Promise<LocalWorktreeContext> {
  const localFs = new LocalFileSystem(args.repoPath);
  const ctx = new LocalExecutionContext({ root: args.repoPath });
  const repoGit = new GitService(ctx, localFs);

  const settings = args.settings ?? new CliWorktreeSettings(args.worktreeDirectory, args.baseRef);

  await fs.promises.mkdir(args.worktreeDirectory, { recursive: true });
  const worktreeHost = await LocalWorktreeHost.create({
    allowedRoots: [args.repoPath, args.worktreeDirectory],
  });

  const poolPath = path.join(
    args.worktreeDirectory,
    safePathSegment(args.projectName, args.projectId)
  );

  const resolveWorktreePoolPath = async () => {
    const directory = await settings.getWorktreeDirectory();
    await fs.promises.mkdir(directory, { recursive: true });
    await worktreeHost.allowRoot(directory);
    return path.join(directory, safePathSegment(args.projectName, args.projectId));
  };

  const worktreeService = new WorktreeService({
    repoPath: args.repoPath,
    projectSettings: settings,
    ctx,
    host: worktreeHost,
    resolveWorktreePoolPath,
  });

  return { worktreeService, repoGit, poolPath };
}
