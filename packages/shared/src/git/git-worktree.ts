import { createHash } from 'node:crypto';
import path from 'node:path';
import { ExecError, type BoundExec } from '../exec';
import type { IFileWatchService, IFsService, WatchHandle } from '../fs';
import { err, LiveModel, ok, type Result, type Unsubscribe } from '../lib';
import {
  classifyCommitError,
  classifyPullError,
  classifyPushError,
  classifySoftResetError,
  gitErrorMessage,
  type CommitError,
  type PullError,
  type PushError,
  type SoftResetError,
} from './errors';
import type { GitOnError, GitRepository } from './git-repository';
import type { DiffResult, ImageReadResult } from './models/diff';
import { toRangeString, toRefString, type DiffTarget } from './models/diff-target';
import type { GitHeadModel } from './models/head';
import type { Commit, CommitFile, GitLogResult } from './models/log';
import type {
  GitChange,
  GitStatusFingerprint,
  GitStatusModel,
  GitStatusUntrackedMode,
} from './models/status';
import { mapGitChangeStatus, parseDiffLines } from './parsers/diff-parser';
import {
  MAX_STATUS_FILES,
  StatusParser,
  TooManyFilesChangedError,
  type FileStatus,
} from './parsers/status-parser';
import type {
  GitLogOptions,
  GitSeqs,
  GitWorktreeSnapshot,
  GitWorktreeUpdate,
  IGitWorktree,
  SubscribedSnapshot,
} from './types';
import { classifyGitWatchEvents } from './watch/classifier';

const MAX_DIFF_CONTENT_BYTES = 512 * 1024;
const MAX_DIFF_OUTPUT_BYTES = 10 * 1024 * 1024;
const MAX_IMAGE_BLOB_BYTES = 10 * 1024 * 1024;
const WATCH_DEBOUNCE_MS = 100;
const REVALIDATE_INTERVAL_MS = 5 * 60_000;
const STATUS_FINGERPRINT_TIMEOUT_MS: Record<GitStatusUntrackedMode, number> = {
  no: 5_000,
  normal: 10_000,
};
const LFS_POINTER_PREFIX = Buffer.from('version https://git-lfs.github.com/spec/');
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

type Numstat = Map<string, { additions: number; deletions: number }>;

export type GitWorktreeOptions = {
  workTree: string;
  gitDir: string;
  repository: GitRepository;
  exec: BoundExec;
  fs: IFsService;
  /** Injected file-watch service; disposed by the injector, not this class. */
  watcher: IFileWatchService;
  onError?: GitOnError;
};

export class GitWorktree implements IGitWorktree {
  readonly workTree: string;
  readonly gitDir: string;
  readonly repository: GitRepository;
  private readonly exec: BoundExec;
  private readonly fs: IFsService;
  private readonly statusModel: LiveModel<GitStatusModel>;
  private readonly headModel: LiveModel<GitHeadModel>;
  private readonly workTreeWatch: WatchHandle;
  private readonly unregisterFromRepository: Unsubscribe;

  constructor(options: GitWorktreeOptions) {
    this.workTree = options.workTree;
    this.gitDir = options.gitDir;
    this.repository = options.repository;
    this.exec = options.exec;
    this.fs = options.fs;
    const onError = options.onError ?? (() => {});

    this.statusModel = new LiveModel<GitStatusModel>({
      compute: () => this.computeStatus(),
      debounceMs: WATCH_DEBOUNCE_MS,
      revalidateIntervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => onError(`status ${this.workTree}`, error),
    });
    this.headModel = new LiveModel<GitHeadModel>({
      compute: () => this.computeHead(),
      debounceMs: WATCH_DEBOUNCE_MS,
      revalidateIntervalMs: REVALIDATE_INTERVAL_MS,
      onError: (error) => onError(`head ${this.workTree}`, error),
    });

    // The repository owns the `.git` (commonDir) watch and routes classified HEAD/index
    // effects here; this watch only covers working-tree file changes.
    this.unregisterFromRepository = this.repository.registerWorktree(this.workTree, {
      gitDir: this.gitDir,
      workTree: this.workTree,
      onEffects: (effects) => {
        if (effects.status) this.statusModel.invalidate();
        if (effects.head) this.headModel.invalidate();
      },
    });
    this.workTreeWatch = options.watcher.watch(
      this.workTree,
      (events) => {
        const classification = classifyGitWatchEvents(events, {
          gitCommonDir: this.repository.gitCommonDir,
          worktrees: [{ id: 'self', gitDir: this.gitDir, workTree: this.workTree }],
        });
        const effects = classification.worktrees.get('self');
        if (effects?.status) this.statusModel.invalidate();
        if (effects?.head) this.headModel.invalidate();
      },
      {
        ignore: ['.git/**'],
        onResync: () => {
          this.statusModel.invalidate();
          this.headModel.invalidate();
        },
      }
    );
  }

  async ready(): Promise<void> {
    await this.workTreeWatch.ready();
  }

  async getStatus(): Promise<GitStatusModel> {
    return (await this.statusModel.get()).value;
  }

  async getHead(): Promise<GitHeadModel> {
    return (await this.headModel.get()).value;
  }

  async getSnapshot(): Promise<GitWorktreeSnapshot> {
    const [status, head] = await Promise.all([this.statusModel.get(), this.headModel.get()]);
    return { status, head };
  }

  async getStatusFingerprint(untracked: GitStatusUntrackedMode): Promise<GitStatusFingerprint> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), STATUS_FINGERPRINT_TIMEOUT_MS[untracked]);
    try {
      const { stdout } = await this.exec.exec(
        [
          '--no-optional-locks',
          'status',
          '--porcelain=v1',
          '-z',
          untracked === 'normal' ? '--untracked-files=normal' : '-uno',
        ],
        { signal: abort.signal }
      );
      return {
        hash: createHash('sha256').update(stdout).digest('hex'),
        byteLength: Buffer.byteLength(stdout),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async isFileCleanlyTracked(filePath: string): Promise<boolean> {
    try {
      await this.exec.exec(['ls-files', '--error-unmatch', '--', filePath]);
      await this.exec.exec(['diff', '--quiet', '--', filePath]);
      await this.exec.exec(['diff', '--cached', '--quiet', '--', filePath]);
      return true;
    } catch {
      return false;
    }
  }

  async getFileDiff(filePath: string, base = 'HEAD'): Promise<DiffResult> {
    const staged = base === 'STAGED' || base === 'staged';
    const diffArgs = staged
      ? ['diff', '--no-color', '--unified=2000', '--cached', '--', filePath]
      : ['diff', '--no-color', '--unified=2000', base, '--', filePath];
    let diffStdout: string | undefined;
    try {
      const { stdout } = await this.exec.exec(diffArgs, { maxBuffer: MAX_DIFF_OUTPUT_BYTES });
      diffStdout = stdout;
    } catch {}

    const getOriginalContent = async (): Promise<string | undefined> => {
      const content = await this.repository.readBlobAtRef(staged ? 'HEAD' : base, filePath);
      return content === null ? undefined : stripTrailingNewline(content);
    };
    const getModifiedContent = async (): Promise<string | undefined> => {
      if (staged) {
        const content = await this.getFileAtIndex(filePath);
        return content === null ? undefined : stripTrailingNewline(content);
      }
      try {
        const result = await this.fs.read(path.join(this.workTree, filePath), {
          maxBytes: MAX_DIFF_CONTENT_BYTES,
        });
        if (result.truncated) return undefined;
        return stripTrailingNewline(result.content);
      } catch {
        return undefined;
      }
    };

    if (diffStdout !== undefined) {
      const { lines, isBinary } = parseDiffLines(diffStdout);
      if (isBinary) return { lines: [], isBinary: true };
      const [originalContent, modifiedContent] = await Promise.all([
        getOriginalContent(),
        getModifiedContent(),
      ]);
      return { lines, originalContent, modifiedContent };
    }

    const [originalContent, modifiedContent] = await Promise.all([
      getOriginalContent(),
      getModifiedContent(),
    ]);
    if (modifiedContent !== undefined) {
      return {
        lines: modifiedContent.split('\n').map((line) => ({ right: line, type: 'add' as const })),
        originalContent,
        modifiedContent,
      };
    }
    if (originalContent !== undefined) {
      return {
        lines: originalContent.split('\n').map((line) => ({ left: line, type: 'del' as const })),
        originalContent,
      };
    }
    return { lines: [] };
  }

  async getFileAtRef(filePath: string, ref: string): Promise<string | null> {
    return this.repository.readBlobAtRef(ref, filePath);
  }

  async getFileAtHead(filePath: string): Promise<string | null> {
    return this.getFileAtRef(filePath, 'HEAD');
  }

  async getFileAtIndex(filePath: string): Promise<string | null> {
    try {
      const { stdout } = await this.exec.exec(['show', `:${filePath}`]);
      return stdout;
    } catch {
      return null;
    }
  }

  async getImageAtRef(filePath: string, ref: string): Promise<ImageReadResult> {
    return this.getImageBlob(filePath, `${ref}:${filePath}`);
  }

  async getImageAtIndex(filePath: string): Promise<ImageReadResult> {
    return this.getImageBlob(filePath, `:${filePath}`);
  }

  async getChangedFiles(base: DiffTarget): Promise<GitChange[]> {
    const resolved = resolveDiffTarget(base);
    const diffArgs = resolved.cached
      ? ['diff', '--numstat', '--cached']
      : ['diff', '--numstat', resolved.ref];
    const nameArgs = resolved.cached
      ? ['diff', '--name-status', '--cached']
      : ['diff', '--name-status', resolved.ref];

    const [numstatResult, nameStatusResult] = await Promise.all([
      this.exec.exec(diffArgs).catch(() => ({ stdout: '' })),
      this.exec.exec(nameArgs).catch(() => ({ stdout: '' })),
    ]);
    const numstat = parseNumstat(numstatResult.stdout);
    const changes: GitChange[] = [];

    for (const line of nameStatusResult.stdout.trim().split('\n').filter(Boolean)) {
      const [code = '', ...parts] = line.split('\t');
      const filePath = parts[parts.length - 1]?.trim();
      if (!filePath) continue;
      const stat = numstat.get(filePath);
      changes.push({
        path: filePath,
        status: mapGitChangeStatus(code),
        additions: stat?.additions ?? 0,
        deletions: stat?.deletions ?? 0,
      });
    }

    return changes;
  }

  async getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult> {
    const getContentAt = async (ref: string): Promise<string | undefined> => {
      const content = await this.repository.readBlobAtRef(ref, filePath);
      return content === null ? undefined : stripTrailingNewline(content);
    };

    let hasParent = true;
    try {
      await this.exec.exec(['rev-parse', '--verify', `${commitHash}~1`]);
    } catch {
      hasParent = false;
    }

    if (!hasParent) {
      const modifiedContent = await getContentAt(commitHash);
      if (modifiedContent === undefined) return { lines: [] };
      return {
        lines: modifiedContent
          ? modifiedContent.split('\n').map((line) => ({ right: line, type: 'add' as const }))
          : [],
        modifiedContent,
      };
    }

    let diffStdout: string | undefined;
    try {
      const { stdout } = await this.exec.exec(
        ['diff', '--no-color', '--unified=2000', `${commitHash}~1`, commitHash, '--', filePath],
        { maxBuffer: MAX_DIFF_OUTPUT_BYTES }
      );
      diffStdout = stdout;
    } catch {}

    const [originalContent, modifiedContent] = await Promise.all([
      getContentAt(`${commitHash}~1`),
      getContentAt(commitHash),
    ]);

    if (diffStdout !== undefined) {
      const { lines, isBinary } = parseDiffLines(diffStdout);
      if (isBinary) return { lines: [], isBinary: true };
      if (lines.length > 0) return { lines, originalContent, modifiedContent };
    }

    if (modifiedContent !== undefined && modifiedContent !== '') {
      return {
        lines: modifiedContent.split('\n').map((line) => ({ right: line, type: 'add' as const })),
        originalContent,
        modifiedContent,
      };
    }
    if (originalContent !== undefined) {
      return {
        lines: originalContent.split('\n').map((line) => ({ left: line, type: 'del' as const })),
        originalContent,
        modifiedContent,
      };
    }
    return { lines: [], originalContent, modifiedContent };
  }

  async getLog(options: GitLogOptions = {}): Promise<GitLogResult> {
    const maxCount =
      typeof options.maxCount === 'number'
        ? Math.max(1, Math.floor(options.maxCount))
        : typeof options.limit === 'number'
          ? Math.max(1, Math.floor(options.limit))
          : 50;
    const skip = typeof options.skip === 'number' ? Math.max(0, Math.floor(options.skip)) : 0;
    const head = options.head ? toRefString(options.head) : 'HEAD';
    const range = options.base ? `${toRefString(options.base)}..${head}` : head;
    const aheadCount = await this.getAheadCount(options, head);
    const fieldSep = '\x1f';
    const recordSep = '\x1e';
    const { stdout } = await this.exec.exec([
      'log',
      `--max-count=${maxCount}`,
      `--skip=${skip}`,
      '--decorate=full',
      `--format=%H${fieldSep}%P${fieldSep}%s${fieldSep}%b${fieldSep}%an${fieldSep}%aI${fieldSep}%D${recordSep}`,
      range,
      '--',
    ]);
    const remoteReachable = await this.getRemoteReachableCommits();
    const commits = stdout
      .split(recordSep)
      .map((record) => record.replace(/^\n/, '').trimEnd())
      .filter(Boolean)
      .map((record) => {
        const [
          hash = '',
          parents = '',
          subject = '',
          body = '',
          author = '',
          date = '',
          decorations = '',
        ] = record.split(fieldSep);
        return {
          hash,
          parents: parents ? parents.split(' ').filter(Boolean) : [],
          subject,
          body: body.trim(),
          author,
          date,
          isPushed: remoteReachable.has(hash),
          tags: parseDecoratedTags(decorations),
        };
      });
    return { commits, aheadCount };
  }

  async getLatestCommit(): Promise<Commit | null> {
    const { commits } = await this.getLog({ maxCount: 1 });
    return commits[0] ?? null;
  }

  async getCommitFiles(hash: string): Promise<CommitFile[]> {
    const [numstatRes, nameStatusRes] = await Promise.all([
      this.exec.exec(['diff-tree', '--root', '--no-commit-id', '--numstat', '-r', hash]),
      this.exec.exec(['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', hash]),
    ]);
    const numstat = parseNumstat(numstatRes.stdout);
    const statusByPath = new Map<string, ReturnType<typeof mapGitChangeStatus>>();
    for (const line of nameStatusRes.stdout.trim().split('\n').filter(Boolean)) {
      const [code = '', ...parts] = line.split('\t');
      const filePath = parts[parts.length - 1];
      if (filePath) statusByPath.set(filePath, mapGitChangeStatus(code));
    }
    return [...numstat.entries()].map(([filePath, stat]) => ({
      path: filePath,
      status: statusByPath.get(filePath) ?? 'modified',
      additions: stat.additions,
      deletions: stat.deletions,
    }));
  }

  subscribe(cb: (update: GitWorktreeUpdate) => void): Unsubscribe {
    const unsubscribeStatus = this.statusModel.subscribe(({ value, seq }) =>
      cb({ kind: 'status', model: value, seq })
    );
    const unsubscribeHead = this.headModel.subscribe(({ value, seq }) =>
      cb({ kind: 'head', model: value, seq })
    );
    return () => {
      unsubscribeStatus();
      unsubscribeHead();
    };
  }

  async subscribeWithSnapshot(
    cb: (update: GitWorktreeUpdate) => void
  ): Promise<SubscribedSnapshot<GitWorktreeSnapshot>> {
    const unsubscribe = this.subscribe(cb);
    try {
      return { snapshot: await this.getSnapshot(), unsubscribe };
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  async refresh(): Promise<GitWorktreeSnapshot> {
    const [status, head] = await Promise.all([
      this.statusModel.refresh(),
      this.headModel.refresh(),
    ]);
    return { status, head };
  }

  async stage(paths: string[]): Promise<GitSeqs> {
    if (paths.length === 0) return {};
    await this.exec.exec(['add', '--', ...paths]);
    return this.refreshStatus();
  }

  async unstage(paths: string[]): Promise<GitSeqs> {
    if (paths.length === 0) return {};
    await this.exec.exec(['reset', 'HEAD', '--', ...paths]);
    return this.refreshStatus();
  }

  async revert(paths: string[]): Promise<GitSeqs> {
    if (paths.length === 0) return {};
    await this.exec.exec(['checkout', 'HEAD', '--', ...paths]);
    return this.refreshStatus();
  }

  async commit(message: string): Promise<Result<{ hash: string; seqs: GitSeqs }, CommitError>> {
    try {
      await this.exec.exec(['commit', '-m', message]);
      const { stdout } = await this.exec.exec(['rev-parse', 'HEAD']);
      return ok({ hash: stdout.trim(), seqs: await this.refreshAfterHistoryChange() });
    } catch (error) {
      return err(classifyCommitError(error));
    }
  }

  async push(remote?: string): Promise<Result<{ output: string; seqs: GitSeqs }, PushError>> {
    try {
      const { stdout, stderr } = await this.exec.exec(['push', ...(remote ? [remote] : [])]);
      return ok({ output: stdout || stderr, seqs: await this.refreshAfterHistoryChange() });
    } catch (error) {
      return err(classifyPushError(error));
    }
  }

  async pull(): Promise<Result<{ output: string; seqs: GitSeqs }, PullError>> {
    try {
      const { stdout, stderr } = await this.exec.exec(['pull']);
      return ok({ output: stdout || stderr, seqs: await this.refreshAfterHistoryChange() });
    } catch (error) {
      return err(classifyPullError(error));
    }
  }

  async softReset(): Promise<
    Result<{ subject: string; body: string; seqs: GitSeqs }, SoftResetError>
  > {
    try {
      await this.exec.exec(['rev-parse', '--verify', 'HEAD~1']);
    } catch (error) {
      return err({ type: 'initial-commit', message: gitErrorMessage(error) });
    }

    const latest = await this.getLatestCommit();
    if (latest?.isPushed) {
      return err({ type: 'already-pushed', message: 'Latest commit is already pushed' });
    }

    try {
      const [{ stdout: subject }, { stdout: body }] = await Promise.all([
        this.exec.exec(['log', '-1', '--pretty=format:%s']),
        this.exec.exec(['log', '-1', '--pretty=format:%b']),
      ]);
      await this.exec.exec(['reset', '--soft', 'HEAD~1']);
      return ok({
        subject: subject.trim(),
        body: body.trim(),
        seqs: await this.refreshAfterHistoryChange(),
      });
    } catch (error) {
      return err(classifySoftResetError(error));
    }
  }

  dispose(): void {
    this.unregisterFromRepository();
    this.workTreeWatch.release();
    this.statusModel.dispose();
    this.headModel.dispose();
  }

  /** Status never throws: failures are encoded in the model so subscribers see them. */
  private async computeStatus(): Promise<GitStatusModel> {
    try {
      const parser = new StatusParser();
      const [, stagedRes, unstagedRes] = await Promise.all([
        this.runStatusZ(parser),
        this.exec.exec(['diff', '--numstat', '--cached']).catch(() => ({ stdout: '' })),
        this.exec.exec(['diff', '--numstat']).catch(() => ({ stdout: '' })),
      ]);

      if (parser.status.length > MAX_STATUS_FILES || parser.tooManyFiles) {
        return { kind: 'too-many-files' };
      }

      return await this.buildStatus(
        parser.status,
        parseNumstat(stagedRes.stdout),
        parseNumstat(unstagedRes.stdout)
      );
    } catch (error) {
      if (error instanceof TooManyFilesChangedError) return { kind: 'too-many-files' };
      return {
        kind: 'error',
        message: gitErrorMessage(error),
      };
    }
  }

  private async computeHead(): Promise<GitHeadModel> {
    try {
      const { stdout } = await this.exec.exec(['symbolic-ref', '--short', 'HEAD']);
      const name = stdout.trim();
      try {
        await this.exec.exec(['rev-parse', '--verify', 'HEAD']);
        return { kind: 'branch', name };
      } catch {
        return { kind: 'unborn', name };
      }
    } catch {
      const { stdout } = await this.exec.exec(['rev-parse', '--short', 'HEAD']);
      return { kind: 'detached', shortHash: stdout.trim() };
    }
  }

  private async refreshStatus(): Promise<GitSeqs> {
    const status = await this.statusModel.refresh();
    return { status: status.seq };
  }

  private async refreshAfterHistoryChange(): Promise<GitSeqs> {
    const [status, head, refs] = await Promise.all([
      this.statusModel.refresh(),
      this.headModel.refresh(),
      this.repository.refreshRefs(),
    ]);
    return { status: status.seq, head: head.seq, refs };
  }

  private async runStatusZ(parser: StatusParser): Promise<void> {
    await this.exec.execStreaming(['--no-optional-locks', 'status', '-z', '-uall'], (chunk) => {
      parser.update(chunk);
      return !parser.tooManyFiles;
    });
    if (parser.tooManyFiles) throw new TooManyFilesChangedError();
  }

  private async buildStatus(
    entries: FileStatus[],
    stagedNumstat: Numstat,
    unstagedNumstat: Numstat
  ): Promise<GitStatusModel> {
    const staged: GitChange[] = [];
    const unstaged: GitChange[] = [];

    for (const entry of entries) {
      const code = `${entry.x}${entry.y}`;
      const filePath = entry.path;
      const status = mapGitChangeStatus(code);

      if (entry.x !== ' ' && entry.x !== '?') {
        const stat = stagedNumstat.get(filePath);
        staged.push({
          path: filePath,
          status,
          additions: stat?.additions ?? 0,
          deletions: stat?.deletions ?? 0,
        });
      }

      const isUntracked = code === '??';
      const hasUnstaged = entry.y !== ' ' && entry.y !== '?';
      if (!isUntracked && !hasUnstaged) continue;

      let additions = unstagedNumstat.get(filePath)?.additions ?? 0;
      const deletions = unstagedNumstat.get(filePath)?.deletions ?? 0;
      if (additions === 0 && deletions === 0 && isUntracked) {
        try {
          const result = await this.fs.read(path.join(this.workTree, filePath), {
            maxBytes: MAX_DIFF_CONTENT_BYTES,
          });
          if (!result.truncated) additions = (result.content.match(/\n/g) ?? []).length;
        } catch {}
      }

      unstaged.push({ path: filePath, status, additions, deletions });
    }

    const stagedAdded = staged.reduce((sum, change) => sum + change.additions, 0);
    const stagedDeleted = staged.reduce((sum, change) => sum + change.deletions, 0);
    return {
      kind: 'ok',
      staged,
      unstaged,
      stagedAdded,
      stagedDeleted,
    };
  }

  private async getImageBlob(filePath: string, spec: string): Promise<ImageReadResult> {
    const mimeType = imageMimeForPath(filePath);
    if (!mimeType) return { kind: 'unavailable', reason: 'unsupported' };

    let buffer: Buffer;
    try {
      const result = await this.exec.execBuffer(['cat-file', '--filters', spec], {
        maxBuffer: MAX_IMAGE_BLOB_BYTES,
      });
      buffer = result.stdout;
    } catch (error) {
      if (error instanceof ExecError && error.stderr.includes('maxBuffer')) {
        return { kind: 'unavailable', reason: 'too-large' };
      }
      const exitCode = error instanceof ExecError ? error.exitCode : null;
      return exitCode === 128 ? { kind: 'missing' } : { kind: 'unavailable', reason: 'git-error' };
    }

    if (buffer.length === 0) {
      return { kind: 'unavailable', reason: 'git-error' };
    }
    if (looksLikeLfsPointer(buffer)) {
      return { kind: 'unavailable', reason: 'lfs-pointer' };
    }
    return {
      kind: 'image',
      image: {
        dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
        mimeType,
        size: buffer.length,
      },
    };
  }

  private async getAheadCount(options: GitLogOptions, head: string): Promise<number> {
    if (typeof options.knownAheadCount === 'number') return Math.max(0, options.knownAheadCount);
    if (options.base) {
      try {
        const { stdout } = await this.exec.exec([
          'rev-list',
          '--count',
          `${toRefString(options.base)}..${head}`,
        ]);
        return Number.parseInt(stdout.trim(), 10) || 0;
      } catch {
        return 0;
      }
    }

    const remote = options.preferredRemote?.trim() || 'origin';
    try {
      const { stdout } = await this.exec.exec(['rev-list', '--count', '@{upstream}..HEAD']);
      return Number.parseInt(stdout.trim(), 10) || 0;
    } catch {}

    try {
      const { stdout: branchOut } = await this.exec.exec(['rev-parse', '--abbrev-ref', 'HEAD']);
      const branch = branchOut.trim();
      if (!branch || branch === 'HEAD') return 0;
      const { stdout } = await this.exec.exec(['rev-list', '--count', `${remote}/${branch}..HEAD`]);
      return Number.parseInt(stdout.trim(), 10) || 0;
    } catch {
      return 0;
    }
  }

  private async getRemoteReachableCommits(): Promise<Set<string>> {
    try {
      const { stdout } = await this.exec.exec(['rev-list', '--remotes', '--max-count=10000']);
      return new Set(
        stdout
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      );
    } catch {
      return new Set();
    }
  }
}

function parseNumstat(stdout: string): Numstat {
  const map: Numstat = new Map();
  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    const [addStr, delStr, ...pathParts] = line.split('\t');
    const filePath = pathParts.join('\t');
    if (!filePath) continue;
    const current = map.get(filePath) ?? { additions: 0, deletions: 0 };
    current.additions += addStr === '-' ? 0 : Number.parseInt(addStr ?? '0', 10) || 0;
    current.deletions += delStr === '-' ? 0 : Number.parseInt(delStr ?? '0', 10) || 0;
    map.set(filePath, current);
  }
  return map;
}

function resolveDiffTarget(base: DiffTarget): { cached: boolean; ref: string } {
  if ('base' in base) return { cached: false, ref: toRangeString(base) };
  if (base.kind === 'staged') return { cached: true, ref: '--cached' };
  if (base.kind === 'head') return { cached: false, ref: 'HEAD' };
  return { cached: false, ref: toRefString(base) };
}

function parseDecoratedTags(decorations: string): string[] {
  return decorations
    .split(',')
    .map((decoration) => decoration.trim())
    .filter((decoration) => decoration.startsWith('tag: '))
    .map((decoration) => decoration.slice('tag: '.length).replace(/^refs\/tags\//, ''))
    .filter(Boolean);
}

function stripTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value.slice(0, -1) : value;
}

function imageMimeForPath(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? (IMAGE_MIME_BY_EXT[ext] ?? null) : null;
}

function looksLikeLfsPointer(buffer: Buffer): boolean {
  if (buffer.length > 1024) return false;
  return buffer.subarray(0, LFS_POINTER_PREFIX.length).equals(LFS_POINTER_PREFIX);
}
