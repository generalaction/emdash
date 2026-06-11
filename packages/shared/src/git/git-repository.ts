import type { BoundExec } from '../exec';
import type { IFileWatchService, WatchHandle } from '../fs';
import { realpathOrResolve } from '../fs';
import { err, LiveModel, ok, type Result, type Unsubscribe } from '../lib';
import type { KeyedMutex } from '../lib';
import { CatFileBatch } from './cat-file-batch';
import {
  classifyCreateBranchError,
  classifyDeleteBranchError,
  classifyFetchError,
  classifyFetchPrForReviewError,
  classifyPushError,
  classifyRenameBranchError,
  toGitCommandError,
  type CreateBranchError,
  type DeleteBranchError,
  type FetchError,
  type FetchPrForReviewError,
  type GitCommandError,
  type PushError,
  type RenameBranchError,
} from './errors';
import type { GitBranch, GitRefsModel, GitRemote, GitRemotesModel } from './models/refs';
import type {
  CreateBranchOptions,
  FetchPrForReviewOptions,
  GitRepoSnapshot,
  GitRepoUpdate,
  GitSeqs,
  IGitRepository,
  SubscribedSnapshot,
} from './types';
import { classifyGitWatchEvents, type WorktreeWatchEffects } from './watch/classifier';

const WATCH_DEBOUNCE_MS = 100;
const REVALIDATE_INTERVAL_MS = 5 * 60_000;

export type GitOnError = (context: string, error: unknown) => void;

/**
 * Registration for worktrees served by this repository's `.git` watch. The repository owns
 * the single commonDir watcher (linked-worktree git dirs live inside it, and the main
 * worktree's git dir *is* it) and routes classified head/status effects to each worktree.
 */
export type WorktreeWatchRegistration = {
  gitDir: string;
  workTree: string;
  onEffects: (effects: WorktreeWatchEffects) => void;
};

export type GitRepositoryOptions = {
  gitCommonDir: string;
  objectStoreDir: string;
  exec: BoundExec;
  /** Injected file-watch service; disposed by the injector, not this class. */
  watcher: IFileWatchService;
  /** Serializes concurrent fetch operations on the same object store directory. */
  objectStoreMutex: KeyedMutex;
  onError?: GitOnError;
};

export class GitRepository implements IGitRepository {
  readonly gitCommonDir: string;
  readonly objectStoreDir: string;
  private readonly exec: BoundExec;
  private readonly objectStoreMutex: KeyedMutex;
  private readonly onError: GitOnError;
  private readonly refsModel: LiveModel<GitRefsModel>;
  private readonly remotesModel: LiveModel<GitRemotesModel>;
  private readonly commonDirWatch: WatchHandle;
  private readonly worktrees = new Map<string, WorktreeWatchRegistration>();
  private catFile: CatFileBatch | null = null;

  constructor(options: GitRepositoryOptions) {
    this.gitCommonDir = options.gitCommonDir;
    this.objectStoreDir = options.objectStoreDir;
    this.exec = options.exec;
    this.objectStoreMutex = options.objectStoreMutex;
    this.onError = options.onError ?? (() => {});

    this.refsModel = new LiveModel<GitRefsModel>({
      compute: () => this.computeRefs(),
      debounceMs: WATCH_DEBOUNCE_MS,
      revalidateIntervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => this.onError(`refs ${this.gitCommonDir}`, error),
    });
    this.remotesModel = new LiveModel<GitRemotesModel>({
      compute: () => this.computeRemotes(),
      debounceMs: WATCH_DEBOUNCE_MS,
      revalidateIntervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => this.onError(`remotes ${this.gitCommonDir}`, error),
    });

    this.commonDirWatch = options.watcher.watch(
      this.gitCommonDir,
      (events) => {
        const classification = classifyGitWatchEvents(events, this.layout());
        if (classification.repo.refs) this.refsModel.invalidate();
        if (classification.repo.remotes) this.remotesModel.invalidate();
        for (const [id, effects] of classification.worktrees) {
          this.worktrees.get(id)?.onEffects(effects);
        }
      },
      {
        ignore: ['objects/**'],
        onResync: () => {
          this.refsModel.invalidate();
          this.remotesModel.invalidate();
          for (const registration of this.worktrees.values()) {
            registration.onEffects({ status: true, head: true });
          }
        },
      }
    );
  }

  async ready(): Promise<void> {
    await this.commonDirWatch.ready();
  }

  async getRefs(): Promise<GitRefsModel> {
    return (await this.refsModel.get()).value;
  }

  async getRemotes(): Promise<GitRemotesModel> {
    return (await this.remotesModel.get()).value;
  }

  async getSnapshot(): Promise<GitRepoSnapshot> {
    const [refs, remotes] = await Promise.all([this.refsModel.get(), this.remotesModel.get()]);
    return { refs, remotes };
  }

  async getDefaultBranch(remote = 'origin'): Promise<string> {
    try {
      const { stdout } = await this.exec.exec([
        'symbolic-ref',
        `refs/remotes/${remote}/HEAD`,
        '--short',
      ]);
      const ref = stdout.trim();
      if (ref) {
        const slash = ref.indexOf('/');
        return slash === -1 ? ref : ref.slice(slash + 1);
      }
    } catch {}

    try {
      const { stdout } = await this.exec.exec(['remote', 'show', remote]);
      const match = /HEAD branch:\s*(\S+)/.exec(stdout);
      if (match?.[1]) return match[1];
    } catch {}

    for (const candidate of ['main', 'master', 'develop', 'trunk']) {
      if (await this.branchExistsLocally(candidate)) return candidate;
    }

    return 'main';
  }

  async readBlobAtRef(ref: string, filePath: string): Promise<string | null> {
    this.catFile ??= new CatFileBatch({ exec: this.exec });
    try {
      return await this.catFile.readText(`${ref}:${filePath}`);
    } catch {
      try {
        const { stdout } = await this.exec.exec(['show', `${ref}:${filePath}`]);
        return stdout;
      } catch {
        return null;
      }
    }
  }

  subscribe(cb: (update: GitRepoUpdate) => void): Unsubscribe {
    const unsubscribeRefs = this.refsModel.subscribe(({ value, seq }) =>
      cb({ kind: 'refs', model: value, seq })
    );
    const unsubscribeRemotes = this.remotesModel.subscribe(({ value, seq }) =>
      cb({ kind: 'remotes', model: value, seq })
    );
    return () => {
      unsubscribeRefs();
      unsubscribeRemotes();
    };
  }

  async subscribeWithSnapshot(
    cb: (update: GitRepoUpdate) => void
  ): Promise<SubscribedSnapshot<GitRepoSnapshot>> {
    const unsubscribe = this.subscribe(cb);
    try {
      return { snapshot: await this.getSnapshot(), unsubscribe };
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  registerWorktree(id: string, registration: WorktreeWatchRegistration): Unsubscribe {
    this.worktrees.set(id, registration);
    return () => {
      if (this.worktrees.get(id) === registration) this.worktrees.delete(id);
    };
  }

  async refresh(): Promise<GitRepoSnapshot> {
    const [refs, remotes] = await Promise.all([
      this.refsModel.refresh(),
      this.remotesModel.refresh(),
    ]);
    return { refs, remotes };
  }

  async refreshRefs(): Promise<number> {
    return (await this.refsModel.refresh()).seq;
  }

  async fetch(remote?: string): Promise<Result<{ seqs: GitSeqs }, FetchError>> {
    try {
      const key = realpathOrResolve(this.objectStoreDir);
      await this.objectStoreMutex.runExclusive(key, async () => {
        await this.exec.exec(['fetch', ...(remote ? [remote] : [])]);
      });
      return ok({ seqs: { refs: await this.refreshRefs() } });
    } catch (error) {
      return err(classifyFetchError(error, remote));
    }
  }

  async addRemote(name: string, url: string): Promise<Result<{ seqs: GitSeqs }, GitCommandError>> {
    try {
      await this.exec.exec(['remote', 'add', name, url]);
      const remotes = await this.remotesModel.refresh();
      return ok({ seqs: { remotes: remotes.seq } });
    } catch (error) {
      return err(toGitCommandError(error));
    }
  }

  async createBranch(
    options: CreateBranchOptions
  ): Promise<Result<{ seqs: GitSeqs }, CreateBranchError>>;
  async createBranch(
    name: string,
    from?: string
  ): Promise<Result<{ seqs: GitSeqs }, CreateBranchError>>;
  async createBranch(
    input: string | CreateBranchOptions,
    fallbackFrom = 'HEAD'
  ): Promise<Result<{ seqs: GitSeqs }, CreateBranchError>> {
    const options =
      typeof input === 'string'
        ? { name: input, from: fallbackFrom, syncWithRemote: false, remote: undefined }
        : {
            name: input.name,
            from: input.from ?? 'HEAD',
            syncWithRemote: input.syncWithRemote ?? false,
            remote: input.remote ?? 'origin',
          };
    const name = options.name;
    const from = options.from ?? 'HEAD';

    if (options.syncWithRemote) {
      const remote = options.remote ?? 'origin';
      const fetchResult = await this.fetch(remote);
      if (!fetchResult.success) {
        return err({ type: 'fetch-failed', remote, branch: from, error: fetchResult.error });
      }
    }

    const base = options.syncWithRemote ? `${options.remote ?? 'origin'}/${from}` : from;
    try {
      await this.exec.exec(['branch', '--no-track', name, base]);
      await this.setBranchBaseConfig(name, base);
      return ok({ seqs: { refs: await this.refreshRefs() } });
    } catch (error) {
      return err(classifyCreateBranchError(error, name, from));
    }
  }

  async renameBranch(
    oldBranch: string,
    newBranch: string
  ): Promise<Result<{ seqs: GitSeqs }, RenameBranchError>> {
    try {
      await this.exec.exec(['branch', '-m', oldBranch, newBranch]);
      return ok({ seqs: { refs: await this.refreshRefs() } });
    } catch (error) {
      return err(classifyRenameBranchError(error, oldBranch, newBranch));
    }
  }

  async deleteBranch(
    branch: string,
    force = false
  ): Promise<Result<{ seqs: GitSeqs }, DeleteBranchError>> {
    try {
      await this.exec.exec(['branch', force ? '-D' : '-d', branch]);
      return ok({ seqs: { refs: await this.refreshRefs() } });
    } catch (error) {
      return err(classifyDeleteBranchError(error, branch));
    }
  }

  async fetchPrForReview(
    options: FetchPrForReviewOptions
  ): Promise<Result<{ seqs: GitSeqs }, FetchPrForReviewError>> {
    try {
      if (options.isFork) {
        const forkRemote = remoteNameForRepositoryUrl(options.headRepositoryUrl);
        const remotes = await this.exec.exec(['remote']).catch(() => ({ stdout: '' }));
        const names = remotes.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean);
        if (names.includes(forkRemote)) {
          await this.exec.exec(['remote', 'set-url', forkRemote, options.headRepositoryUrl]);
        } else {
          await this.exec.exec(['remote', 'add', forkRemote, options.headRepositoryUrl]);
        }
        await this.exec.exec([
          'fetch',
          forkRemote,
          `${options.headRefName}:refs/heads/${options.localBranch}`,
          '--force',
        ]);
        await this.exec
          .exec([
            'branch',
            `--set-upstream-to=${forkRemote}/${options.headRefName}`,
            options.localBranch,
          ])
          .catch(() => ({ stdout: '', stderr: '' }));
        const [refs, remotes2] = await Promise.all([
          this.refsModel.refresh(),
          this.remotesModel.refresh(),
        ]);
        return ok({ seqs: { refs: refs.seq, remotes: remotes2.seq } });
      }

      const remote = options.configuredRemote ?? 'origin';
      await this.exec.exec([
        'fetch',
        remote,
        `refs/pull/${options.prNumber}/head:refs/heads/${options.localBranch}`,
        '--force',
      ]);
      await this.exec
        .exec(['branch', `--set-upstream-to=${remote}/${options.headRefName}`, options.localBranch])
        .catch(() => ({ stdout: '', stderr: '' }));
      return ok({ seqs: { refs: await this.refreshRefs() } });
    } catch (error) {
      return err(classifyFetchPrForReviewError(error, options.prNumber));
    }
  }

  async publishBranch(
    branchName: string,
    remote = 'origin'
  ): Promise<Result<{ output: string; seqs: GitSeqs }, PushError>> {
    try {
      const { stdout, stderr } = await this.exec.exec([
        'push',
        '--set-upstream',
        remote,
        branchName,
      ]);
      return ok({
        output: (stdout || stderr).trim(),
        seqs: { refs: await this.refreshRefs() },
      });
    } catch (error) {
      return err(classifyPushError(error));
    }
  }

  dispose(): void {
    this.commonDirWatch.release();
    this.refsModel.dispose();
    this.remotesModel.dispose();
    this.worktrees.clear();
    this.catFile?.dispose();
    this.catFile = null;
  }

  private layout() {
    return {
      gitCommonDir: this.gitCommonDir,
      worktrees: [...this.worktrees.entries()].map(([id, registration]) => ({
        id,
        gitDir: registration.gitDir,
        workTree: registration.workTree,
      })),
    };
  }

  private async computeRefs(): Promise<GitRefsModel> {
    const remotes = await this.getRemotes();
    const remoteByName = new Map(remotes.remotes.map((remote) => [remote.name, remote]));
    const { stdout } = await this.exec.exec([
      'branch',
      '-a',
      '--format=%(refname)|%(refname:short)|%(upstream:short)|%(upstream:track)',
    ]);
    const branches: GitBranch[] = [];

    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      const [fullRef, shortRef, upstreamRef, upstreamTrack] = line.split('|');
      if (!fullRef || !shortRef) continue;
      if (fullRef.startsWith('refs/remotes/')) {
        const remoteBranch = fullRef.slice('refs/remotes/'.length);
        if (remoteBranch.endsWith('/HEAD')) continue;
        const slash = remoteBranch.indexOf('/');
        if (slash === -1) continue;
        const remoteName = remoteBranch.slice(0, slash);
        const branch = remoteBranch.slice(slash + 1);
        branches.push({
          type: 'remote',
          branch,
          remote: remoteByName.get(remoteName) ?? { name: remoteName, url: '' },
        });
        continue;
      }

      if (!fullRef.startsWith('refs/heads/')) continue;
      const branch: GitBranch = { type: 'local', branch: shortRef };
      if (upstreamRef) {
        const slash = upstreamRef.indexOf('/');
        const remoteName = slash === -1 ? upstreamRef : upstreamRef.slice(0, slash);
        branch.remote = remoteByName.get(remoteName) ?? { name: remoteName, url: '' };
      }
      const divergence = parseDivergence(upstreamTrack ?? '');
      if (divergence) {
        Object.assign(branch, { divergence });
      }
      branches.push(branch);
    }

    return { branches };
  }

  private async computeRemotes(): Promise<GitRemotesModel> {
    const { stdout } = await this.exec.exec(['remote', '-v']);
    const seen = new Set<string>();
    const remotes: GitRemote[] = [];

    for (const line of stdout.trim().split('\n').filter(Boolean)) {
      const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line);
      if (!match || match[3] !== 'fetch') continue;
      const name = match[1]!;
      if (seen.has(name)) continue;
      seen.add(name);
      remotes.push({ name, url: match[2]! });
    }

    return { remotes };
  }

  private async branchExistsLocally(branch: string): Promise<boolean> {
    try {
      await this.exec.exec(['rev-parse', '--verify', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  private async setBranchBaseConfig(branchName: string, baseRef: string): Promise<void> {
    try {
      await this.exec.exec(['config', `branch.${branchName}.base`, baseRef]);
    } catch {}
  }
}

function remoteNameForRepositoryUrl(url: string): string {
  const withoutSuffix = url.replace(/\.git$/, '');
  const tail = withoutSuffix.split(/[/:]/).filter(Boolean).slice(-2).join('-');
  return `fork-${tail || 'remote'}`.replace(/[^A-Za-z0-9._-]/g, '-');
}

function parseDivergence(upstreamTrack: string): { ahead: number; behind: number } | undefined {
  if (!upstreamTrack) return undefined;
  const ahead = /ahead (\d+)/.exec(upstreamTrack)?.[1];
  const behind = /behind (\d+)/.exec(upstreamTrack)?.[1];
  if (!ahead && !behind) return undefined;
  return {
    ahead: ahead ? Number.parseInt(ahead, 10) : 0,
    behind: behind ? Number.parseInt(behind, 10) : 0,
  };
}
