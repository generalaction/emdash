import path from 'node:path';
import {
  HEAD_MODE,
  toRangeString,
  toRefString,
  type Branch,
  type Commit,
  type CommitError,
  type CommitFile,
  type CreateBranchError,
  type DeleteBranchError,
  type DiffLine,
  type DiffMode,
  type DiffResult,
  type FetchError,
  type FetchPrForReviewError,
  type FullGitStatus,
  type GitChange,
  type GitHeadState,
  type GitInfo,
  type GitObjectRef,
  type LocalBranch,
  type MergeBaseRange,
  type PullError,
  type PushError,
  type RemoteBranch,
  type RenameBranchError,
  type SoftResetError,
} from '@shared/git';
import { DEFAULT_REMOTE_NAME } from '@shared/git-utils';
import { ownerFromUrl } from '@shared/pull-requests';
import { err, ok, type Result } from '@shared/result';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import type { IDisposable } from '@main/lib/lifecycle';
import { type GitProvider } from '../types';
import { CatFileBatch } from './cat-file-batch';
import {
  computeBaseRef,
  mapStatus,
  MAX_DIFF_CONTENT_BYTES,
  MAX_DIFF_OUTPUT_BYTES,
  MAX_REF_LIST_BYTES,
  parseDiffLines,
  stripTrailingNewline,
} from './git-utils';
import {
  MAX_STATUS_FILES,
  StatusParser,
  TooManyFilesChangedError,
  type IFileStatus,
} from './status-parser';

export class GitService implements GitProvider, IDisposable {
  private _statusInFlight: Promise<FullGitStatus> | null = null;
  private _catFile: CatFileBatch | null = null;

  constructor(
    private readonly ctx: IExecutionContext,
    private readonly fs: FileSystemProvider
  ) {}

  dispose(): void {
    this._catFile?.dispose();
    this._catFile = null;
  }

  private _getCatFile(): CatFileBatch | null {
    if (!this.ctx.supportsLocalSpawn) return null;
    this._catFile ??= new CatFileBatch(this.ctx.root ?? '');
    return this._catFile;
  }

  private parseNumstat(stdout: string): Map<string, { additions: number; deletions: number }> {
    const map = new Map<string, { additions: number; deletions: number }>();
    for (const l of stdout
      .trim()
      .split('\n')
      .filter((s) => s.trim())) {
      const [addStr, delStr, ...pathParts] = l.split('\t');
      const filePath = pathParts.join('\t');
      if (!filePath) continue;
      const existing = map.get(filePath) ?? { additions: 0, deletions: 0 };
      existing.additions += addStr === '-' ? 0 : Number.parseInt(addStr ?? '0', 10) || 0;
      existing.deletions += delStr === '-' ? 0 : Number.parseInt(delStr ?? '0', 10) || 0;
      map.set(filePath, existing);
    }
    return map;
  }

  async getFullStatus(): Promise<FullGitStatus> {
    if (this._statusInFlight) return this._statusInFlight;
    this._statusInFlight = this._loadFullStatus().finally(() => {
      this._statusInFlight = null;
    });
    return this._statusInFlight;
  }

  private async _loadFullStatus(): Promise<FullGitStatus> {
    try {
      const parser = new StatusParser();
      const [, stagedRes, unstagedRes, currentBranch] = await Promise.all([
        this._runStatusZ(parser),
        this.ctx.exec(GIT_EXECUTABLE, ['diff', '--numstat', '--cached']).catch(() => ({
          stdout: '',
        })),
        this.ctx.exec(GIT_EXECUTABLE, ['diff', '--numstat']).catch(() => ({ stdout: '' })),
        this.getCurrentBranch(),
      ]);

      const stagedNumstat = this.parseNumstat(stagedRes.stdout);
      const unstagedNumstat = this.parseNumstat(unstagedRes.stdout);

      if (parser.status.length > MAX_STATUS_FILES || parser.tooManyFiles) {
        throw new TooManyFilesChangedError();
      }

      return await this._buildFullGitStatus(
        parser.status,
        stagedNumstat,
        unstagedNumstat,
        currentBranch
      );
    } catch (e) {
      if (e instanceof TooManyFilesChangedError) throw e;
      return {
        staged: [],
        unstaged: [],
        currentBranch: null,
        totalAdded: 0,
        totalDeleted: 0,
      };
    }
  }

  private async _runStatusZ(parser: StatusParser): Promise<void> {
    await this.ctx.execStreaming(
      'git',
      ['--no-optional-locks', 'status', '-z', '-uall'],
      (chunk) => {
        parser.update(chunk);
        return !parser.tooManyFiles;
      }
    );
    if (parser.tooManyFiles) throw new TooManyFilesChangedError();
  }

  private async _buildFullGitStatus(
    entries: IFileStatus[],
    stagedNumstat: Map<string, { additions: number; deletions: number }>,
    unstagedNumstat: Map<string, { additions: number; deletions: number }>,
    currentBranch: string | null
  ): Promise<FullGitStatus> {
    const staged: GitChange[] = [];
    const unstaged: GitChange[] = [];

    for (const e of entries) {
      const code = `${e.x}${e.y}`;
      const filePath = e.path;
      const status = mapStatus(code);

      if (e.x !== ' ' && e.x !== '?') {
        const ns = stagedNumstat.get(filePath);
        staged.push({
          path: filePath,
          status,
          additions: ns?.additions ?? 0,
          deletions: ns?.deletions ?? 0,
        });
      }

      const isUntracked = code === '??';
      const hasUnstaged = code[1] !== ' ' && code[1] !== '?';
      if (!isUntracked && !hasUnstaged) {
        continue;
      }

      let additions = unstagedNumstat.get(filePath)?.additions ?? 0;
      const deletions = unstagedNumstat.get(filePath)?.deletions ?? 0;

      if (additions === 0 && deletions === 0 && code.includes('?')) {
        try {
          const result = await this.fs.read(filePath, MAX_DIFF_CONTENT_BYTES);
          if (!result.truncated) {
            additions = (result.content.match(/\n/g) ?? []).length;
          }
        } catch {}
      }

      unstaged.push({
        path: filePath,
        status,
        additions,
        deletions,
      });
    }

    const totalAdded = staged.reduce((s, c) => s + c.additions, 0);
    const totalDeleted = staged.reduce((s, c) => s + c.deletions, 0);

    return { staged, unstaged, currentBranch, totalAdded, totalDeleted };
  }

  async getStatus(): Promise<{ changes: GitChange[]; currentBranch: string | null }> {
    try {
      const full = await this.getFullStatus();
      const byPath = new Map<string, GitChange>();
      for (const c of full.staged) {
        byPath.set(c.path, { ...c });
      }
      for (const c of full.unstaged) {
        const prev = byPath.get(c.path);
        if (prev) {
          byPath.set(c.path, {
            path: c.path,
            status: c.status,
            additions: prev.additions + c.additions,
            deletions: prev.deletions + c.deletions,
          });
        } else {
          byPath.set(c.path, c);
        }
      }
      return { changes: [...byPath.values()], currentBranch: full.currentBranch };
    } catch (e) {
      if (e instanceof TooManyFilesChangedError) throw e;
      return { changes: [], currentBranch: null };
    }
  }

  async getStagedChanges(): Promise<{
    changes: GitChange[];
    totalAdded: number;
    totalDeleted: number;
  }> {
    try {
      const full = await this.getFullStatus();
      return {
        changes: full.staged,
        totalAdded: full.totalAdded,
        totalDeleted: full.totalDeleted,
      };
    } catch (e) {
      if (e instanceof TooManyFilesChangedError) {
        return { changes: [], totalAdded: 0, totalDeleted: 0 };
      }
      throw e;
    }
  }

  async getUnstagedChanges(): Promise<{ changes: GitChange[] }> {
    try {
      const full = await this.getFullStatus();
      return { changes: full.unstaged };
    } catch (e) {
      if (e instanceof TooManyFilesChangedError) {
        return { changes: [] };
      }
      throw e;
    }
  }

  async stageFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    await this.ctx.exec(GIT_EXECUTABLE, ['add', '--', ...filePaths]);
  }

  async stageAllFiles(): Promise<void> {
    await this.ctx.exec(GIT_EXECUTABLE, ['add', '-A']);
  }

  async unstageFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    try {
      await this.ctx.exec(GIT_EXECUTABLE, ['reset', 'HEAD', '--', ...filePaths]);
    } catch {
      // Fallback for edge cases (e.g. new files with no HEAD): unstage each via rm --cached
      for (const filePath of filePaths) {
        try {
          await this.ctx.exec(GIT_EXECUTABLE, ['reset', 'HEAD', '--', filePath]);
        } catch {
          await this.ctx.exec(GIT_EXECUTABLE, ['rm', '--cached', '--', filePath]);
        }
      }
    }
  }

  async unstageAllFiles(): Promise<void> {
    try {
      await this.ctx.exec(GIT_EXECUTABLE, ['reset', 'HEAD']);
    } catch {
      // Repo may have no commits yet; ignore.
    }
  }

  async revertFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;

    // Determine which files exist in HEAD in a single command
    let trackedPaths = new Set<string>();
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, [
        'ls-tree',
        '--name-only',
        'HEAD',
        '--',
        ...filePaths,
      ]);
      trackedPaths = new Set(stdout.trim().split('\n').filter(Boolean));
    } catch {
      // Empty repo — no HEAD yet, all files are untracked
    }

    const tracked = filePaths.filter((f) => trackedPaths.has(f));
    const untracked = filePaths.filter((f) => !trackedPaths.has(f));

    if (tracked.length > 0) {
      await this.ctx.exec(GIT_EXECUTABLE, ['checkout', 'HEAD', '--', ...tracked]);
    }

    // Untracked files don't exist in git history — remove them from disk
    for (const filePath of untracked) {
      try {
        const exists = await this.fs.exists(filePath);
        if (exists) await this.fs.remove(filePath);
      } catch {}
    }
  }

  async revertAllFiles(): Promise<void> {
    // Reset index and working tree for all tracked changes back to HEAD,
    // then remove any untracked files/directories.
    try {
      await this.ctx.exec(GIT_EXECUTABLE, ['reset', '--hard', 'HEAD']);
    } catch {
      // Repo may have no commits yet; ignore.
    }
    await this.ctx.exec(GIT_EXECUTABLE, ['clean', '-fd']);
  }

  // ---------------------------------------------------------------------------
  // Diffs
  // ---------------------------------------------------------------------------

  async getFileAtHead(filePath: string): Promise<string | null> {
    return this.getFileAtRef(filePath, 'HEAD');
  }

  async getFileAtRef(filePath: string, ref: string): Promise<string | null> {
    const cf = this._getCatFile();
    if (cf) {
      try {
        return await cf.read(`${ref}:${filePath}`);
      } catch {
        // Batch channel failed — fall back to one-shot git show.
      }
    }
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, ['show', `${ref}:${filePath}`], {
        maxBuffer: MAX_DIFF_CONTENT_BYTES,
      });
      return stripTrailingNewline(stdout);
    } catch {
      return null;
    }
  }

  async getFileAtIndex(filePath: string): Promise<string | null> {
    const cf = this._getCatFile();
    if (cf) {
      try {
        return await cf.read(`:0:${filePath}`);
      } catch {
        // Fall back
      }
    }
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, ['show', `:0:${filePath}`], {
        maxBuffer: MAX_DIFF_CONTENT_BYTES,
      });
      return stripTrailingNewline(stdout);
    } catch {
      return null;
    }
  }

  async getFileDiff(
    filePath: string,
    base: DiffMode | GitObjectRef = HEAD_MODE
  ): Promise<DiffResult> {
    const diffArgs = (() => {
      switch (base.kind) {
        case 'staged':
          return ['diff', '--no-color', '--unified=2000', '--cached', '--', filePath];
        case 'head':
          return ['diff', '--no-color', '--unified=2000', 'HEAD', '--', filePath];
        default:
          return [
            'diff',
            '--no-color',
            '--unified=2000',
            `${toRefString(base)}...HEAD`,
            '--',
            filePath,
          ];
      }
    })();

    const isObjectRef = base.kind !== 'head' && base.kind !== 'staged';

    let diffStdout: string | undefined;
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, diffArgs, {
        maxBuffer: MAX_DIFF_OUTPUT_BYTES,
      });
      diffStdout = stdout;
    } catch {}

    const originalRef = isObjectRef ? toRefString(base as GitObjectRef) : 'HEAD';

    const getOriginalContent = async (): Promise<string | undefined> => {
      try {
        const { stdout } = await this.ctx.exec(
          GIT_EXECUTABLE,
          ['show', `${originalRef}:${filePath}`],
          {
            maxBuffer: MAX_DIFF_CONTENT_BYTES,
          }
        );
        return stripTrailingNewline(stdout);
      } catch {
        return undefined;
      }
    };

    const getModifiedContent = async (): Promise<string | undefined> => {
      if (isObjectRef) {
        try {
          const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, ['show', `HEAD:${filePath}`], {
            maxBuffer: MAX_DIFF_CONTENT_BYTES,
          });
          return stripTrailingNewline(stdout);
        } catch {
          return undefined;
        }
      }
      try {
        const result = await this.fs.read(filePath, MAX_DIFF_CONTENT_BYTES);
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

      if (lines.length === 0) {
        if (modifiedContent !== undefined) {
          return {
            lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
            modifiedContent,
          };
        }
        if (originalContent !== undefined) {
          return {
            lines: originalContent.split('\n').map((l) => ({ left: l, type: 'del' as const })),
            originalContent,
          };
        }
        return { lines: [] };
      }
      return { lines, originalContent, modifiedContent };
    }

    const [originalContent, modifiedContent] = await Promise.all([
      getOriginalContent(),
      getModifiedContent(),
    ]);

    if (modifiedContent !== undefined) {
      return {
        lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
        originalContent,
        modifiedContent,
      };
    }
    if (originalContent !== undefined) {
      return {
        lines: originalContent.split('\n').map((l) => ({ left: l, type: 'del' as const })),
        originalContent,
      };
    }
    return { lines: [] };
  }

  async getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult> {
    const getContentAt = async (ref: string): Promise<string | undefined> => {
      try {
        const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, ['show', `${ref}:${filePath}`], {
          maxBuffer: MAX_DIFF_CONTENT_BYTES,
        });
        return stripTrailingNewline(stdout);
      } catch {
        return undefined;
      }
    };

    let hasParent = true;
    try {
      await this.ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--verify', `${commitHash}~1`]);
    } catch {
      hasParent = false;
    }

    if (!hasParent) {
      const modifiedContent = await getContentAt(commitHash);
      if (modifiedContent === undefined) return { lines: [] };
      if (modifiedContent === '') return { lines: [], modifiedContent };
      return {
        lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
        modifiedContent,
      };
    }

    let diffStdout: string | undefined;
    try {
      const { stdout } = await this.ctx.exec(
        'git',
        ['diff', '--no-color', '--unified=2000', `${commitHash}~1`, commitHash, '--', filePath],
        { maxBuffer: MAX_DIFF_OUTPUT_BYTES }
      );
      diffStdout = stdout;
    } catch {}

    let diffLines: DiffLine[] = [];
    if (diffStdout !== undefined) {
      const { lines, isBinary } = parseDiffLines(diffStdout);
      if (isBinary) return { lines: [], isBinary: true };
      diffLines = lines;
    }

    const [originalContent, modifiedContent] = await Promise.all([
      getContentAt(`${commitHash}~1`),
      getContentAt(commitHash),
    ]);

    if (diffLines.length > 0) return { lines: diffLines, originalContent, modifiedContent };

    if (modifiedContent !== undefined && modifiedContent !== '') {
      return {
        lines: modifiedContent.split('\n').map((l) => ({ right: l, type: 'add' as const })),
        originalContent,
        modifiedContent,
      };
    }
    if (originalContent !== undefined) {
      return {
        lines: originalContent.split('\n').map((l) => ({ left: l, type: 'del' as const })),
        originalContent,
        modifiedContent,
      };
    }
    return { lines: [], originalContent, modifiedContent };
  }

  // ---------------------------------------------------------------------------
  // Commit log
  // ---------------------------------------------------------------------------

  async getLog(options?: {
    maxCount?: number;
    skip?: number;
    knownAheadCount?: number;
    preferredRemote?: string;
    /**
     * When provided, compute aheadCount as `base..<head|HEAD>` instead of
     * `@{upstream}..HEAD`. Use an immutable commit SHA for merged PRs so the
     * count remains stable after the remote base branch moves forward.
     */
    base?: GitObjectRef;
    /**
     * When provided, anchor the log and aheadCount range to this ref instead
     * of the live HEAD. Pass `commitRef(pr.headRefOid)` for merged PRs.
     */
    head?: GitObjectRef;
  }): Promise<{ commits: Commit[]; aheadCount: number }> {
    const { maxCount = 50, skip = 0, knownAheadCount, preferredRemote, base, head } = options ?? {};
    const remote = preferredRemote?.trim() || DEFAULT_REMOTE_NAME;
    const headStr = head ? toRefString(head) : 'HEAD';

    let aheadCount = knownAheadCount ?? -1;
    if (aheadCount < 0) {
      aheadCount = 0;

      if (base !== undefined) {
        // PR-relative count: compare explicitly against the PR base ref.
        try {
          const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, [
            'rev-list',
            '--count',
            `${toRefString(base)}..${headStr}`,
          ]);
          aheadCount = Number.parseInt(stdout.trim(), 10) || 0;
        } catch {
          aheadCount = 0;
        }
      } else {
        try {
          const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, [
            'rev-list',
            '--count',
            '@{upstream}..HEAD',
          ]);
          aheadCount = Number.parseInt(stdout.trim(), 10) || 0;
        } catch {
          try {
            const { stdout: branchOut } = await this.ctx.exec(GIT_EXECUTABLE, [
              'rev-parse',
              '--abbrev-ref',
              'HEAD',
            ]);
            const currentBranch = branchOut.trim();
            const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, [
              'rev-list',
              '--count',
              `${remote}/${currentBranch}..HEAD`,
            ]);
            aheadCount = Number.parseInt(stdout.trim(), 10) || 0;
          } catch {
            try {
              const { stdout: defaultBranchOut } = await this.ctx.exec(GIT_EXECUTABLE, [
                'symbolic-ref',
                '--short',
                `refs/remotes/${remote}/HEAD`,
              ]);
              const defaultBranch = defaultBranchOut.trim();
              const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, [
                'rev-list',
                '--count',
                `${defaultBranch}..HEAD`,
              ]);
              aheadCount = Number.parseInt(stdout.trim(), 10) || 0;
            } catch {
              aheadCount = 0;
            }
          }
        }
      }
    }

    const FIELD_SEP = '---FIELD_SEP---';
    const RECORD_SEP = '---RECORD_SEP---';
    const format = `${RECORD_SEP}%H${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%D${FIELD_SEP}%b`;
    // When base is provided (PR view), use a range so only commits between
    // base and head are returned — not a raw linear walk from head.
    const rangeArg = base ? `${toRefString(base)}..${headStr}` : headStr;
    const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, [
      'log',
      `--max-count=${maxCount}`,
      `--skip=${skip}`,
      `--pretty=format:${format}`,
      rangeArg,
      '--',
    ]);

    if (!stdout.trim()) return { commits: [], aheadCount };

    const commits = stdout
      .split(RECORD_SEP)
      .filter((entry) => entry.trim())
      .map((entry, index) => {
        const parts = entry.trim().split(FIELD_SEP);
        const refs = parts[4] || '';
        const tags = refs
          .split(',')
          .map((r) => r.trim())
          .filter((r) => r.startsWith('tag: '))
          .map((r) => r.slice(5));
        return {
          hash: parts[0] || '',
          subject: parts[1] || '',
          body: (parts[5] || '').trim(),
          author: parts[2] || '',
          date: parts[3] || '',
          isPushed: skip + index >= aheadCount,
          tags,
        };
      });

    return { commits, aheadCount };
  }

  async getLatestCommit(): Promise<Commit | null> {
    const { commits } = await this.getLog({ maxCount: 1 });
    return commits[0] || null;
  }

  async getChangedFiles(base: DiffMode | GitObjectRef | MergeBaseRange): Promise<GitChange[]> {
    const isRange = 'base' in base;
    const isStaged = !isRange && (base as DiffMode | GitObjectRef).kind === 'staged';
    const ref = isStaged
      ? '--cached'
      : isRange
        ? toRangeString(base as MergeBaseRange)
        : toRefString(base as GitObjectRef);

    const parseNumstat = (
      stdout: string
    ): Map<string, { additions: number; deletions: number }> => {
      const map = new Map<string, { additions: number; deletions: number }>();
      for (const l of stdout
        .trim()
        .split('\n')
        .filter((s) => s.trim())) {
        const [addStr, delStr, ...pathParts] = l.split('\t');
        const filePath = pathParts.join('\t');
        if (!filePath) continue;
        const existing = map.get(filePath) ?? { additions: 0, deletions: 0 };
        existing.additions += addStr === '-' ? 0 : Number.parseInt(addStr ?? '0', 10) || 0;
        existing.deletions += delStr === '-' ? 0 : Number.parseInt(delStr ?? '0', 10) || 0;
        map.set(filePath, existing);
      }
      return map;
    };

    const diffArgs = isStaged ? ['diff', '--numstat', '--cached'] : ['diff', '--numstat', ref];
    const nameArgs = isStaged
      ? ['diff', '--name-status', '--cached']
      : ['diff', '--name-status', ref];

    const [numstatResult, nameStatusResult] = await Promise.all([
      this.ctx.exec(GIT_EXECUTABLE, diffArgs).catch(() => ({ stdout: '' })),
      this.ctx.exec(GIT_EXECUTABLE, nameArgs).catch(() => ({ stdout: '' })),
    ]);

    const numstatMap = parseNumstat(numstatResult.stdout);

    const changes: GitChange[] = [];
    for (const line of nameStatusResult.stdout.trim().split('\n').filter(Boolean)) {
      const parts = line.split('\t');
      const code = parts[0] ?? '';
      const filePath = (parts[parts.length - 1] ?? '').trim();
      if (!filePath) continue;

      const stat = numstatMap.get(filePath);
      changes.push({
        path: filePath,
        status: mapStatus(code),
        additions: stat?.additions ?? 0,
        deletions: stat?.deletions ?? 0,
      });
    }

    return changes;
  }

  async getCommitFiles(commitHash: string): Promise<CommitFile[]> {
    const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '-r',
      '-m',
      '--first-parent',
      '--numstat',
      commitHash,
    ]);

    const { stdout: nameStatus } = await this.ctx.exec(GIT_EXECUTABLE, [
      'diff-tree',
      '--root',
      '--no-commit-id',
      '-r',
      '-m',
      '--first-parent',
      '--name-status',
      commitHash,
    ]);

    const statLines = stdout.trim().split('\n').filter(Boolean);
    const statusLines = nameStatus.trim().split('\n').filter(Boolean);

    const statusMap = new Map<string, string>();
    for (const line of statusLines) {
      const [code, ...pathParts] = line.split('\t');
      const filePath = pathParts[pathParts.length - 1] || '';
      statusMap.set(filePath, mapStatus(code ?? ''));
    }

    return statLines.map((line) => {
      const [addStr, delStr, ...pathParts] = line.split('\t');
      const filePath = pathParts.join('\t');
      return {
        path: filePath,
        status: statusMap.get(filePath) || 'modified',
        additions: addStr === '-' ? 0 : Number.parseInt(addStr || '0', 10) || 0,
        deletions: delStr === '-' ? 0 : Number.parseInt(delStr || '0', 10) || 0,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  async commit(message: string): Promise<Result<{ hash: string }, CommitError>> {
    if (!message || !message.trim()) return err({ type: 'empty_message' });
    try {
      await this.ctx.exec(GIT_EXECUTABLE, ['commit', '-m', message]);
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || '';
      const stdout = (error as { stdout?: string })?.stdout || '';
      const output = stderr || stdout || String(error);
      if (stderr.includes('nothing to commit') || stdout.includes('nothing to commit')) {
        return err({ type: 'nothing_to_commit' });
      }
      return err({ type: 'hook_failed', message: output });
    }
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, ['rev-parse', 'HEAD']);
      return ok({ hash: stdout.trim() });
    } catch (error: unknown) {
      return err({ type: 'error', message: String(error) });
    }
  }

  async fetch(remote?: string): Promise<Result<void, FetchError>> {
    try {
      const remotes = await this.ctx.exec(GIT_EXECUTABLE, ['remote']).catch(() => ({
        stdout: '',
      }));
      const remoteNames = remotes.stdout
        .split('\n')
        .map((name) => name.trim())
        .filter(Boolean);
      if (remoteNames.length === 0) return err({ type: 'no_remote' });

      const selectedRemote = remote?.trim();
      if (selectedRemote && !remoteNames.includes(selectedRemote)) {
        return err({ type: 'remote_not_found', message: `Remote "${selectedRemote}" not found` });
      }

      await this.ctx.exec(GIT_EXECUTABLE, selectedRemote ? ['fetch', selectedRemote] : ['fetch'], {
        maxBuffer: MAX_REF_LIST_BYTES,
      });
      return ok();
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || String(error);
      if (
        stderr.includes('Authentication failed') ||
        stderr.includes('authentication failed') ||
        stderr.includes('Permission denied') ||
        stderr.includes('could not read Username')
      ) {
        return err({ type: 'auth_failed', message: stderr });
      }
      if (
        stderr.includes('Could not resolve host') ||
        stderr.includes('could not resolve host') ||
        stderr.includes('Network is unreachable') ||
        stderr.includes('Connection refused') ||
        stderr.includes('Connection timed out') ||
        stderr.includes('unable to connect')
      ) {
        return err({ type: 'network_error', message: stderr });
      }
      if (
        stderr.includes('does not appear to be a git repository') ||
        stderr.includes('repository not found') ||
        stderr.includes('Repository not found') ||
        stderr.includes('not found') ||
        stderr.includes('ERROR: Repository not found')
      ) {
        return err({ type: 'remote_not_found', message: stderr });
      }
      return err({ type: 'error', message: stderr });
    }
  }

  async push(preferredRemote?: string): Promise<Result<{ output: string }, PushError>> {
    const doPush = async (args: string[]): Promise<string> => {
      const { stdout, stderr } = await this.ctx.exec(GIT_EXECUTABLE, args);
      return (stdout || stderr || '').trim();
    };

    try {
      const output = await doPush(['push']);
      return ok({ output });
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || '';
      const message = stderr || String(error);

      if (stderr.includes('Everything up-to-date') || message.includes('Everything up-to-date')) {
        return ok({ output: 'Everything up-to-date' });
      }

      if (
        stderr.includes('has no upstream branch') ||
        stderr.includes('no upstream configured') ||
        stderr.includes('upstream branch of your current branch does not match')
      ) {
        try {
          const { stdout: branchOut } = await this.ctx.exec(GIT_EXECUTABLE, [
            'branch',
            '--show-current',
          ]);
          const currentBranch = branchOut.trim();
          let pushRemote = preferredRemote?.trim() || DEFAULT_REMOTE_NAME;
          try {
            const { stdout: remoteOut } = await this.ctx.exec(GIT_EXECUTABLE, [
              'config',
              '--get',
              `branch.${currentBranch}.remote`,
            ]);
            if (remoteOut.trim()) pushRemote = remoteOut.trim();
          } catch {}
          const output = await doPush(['push', '--set-upstream', pushRemote, currentBranch]);
          return ok({ output });
        } catch (upstreamError: unknown) {
          const upstreamStderr = (upstreamError as { stderr?: string })?.stderr || '';
          return err({ type: 'error', message: upstreamStderr || String(upstreamError) });
        }
      }

      if (
        stderr.includes('[rejected]') ||
        stderr.includes('Updates were rejected') ||
        stderr.includes('non-fast-forward')
      ) {
        return err({ type: 'rejected', message });
      }

      if (
        stderr.includes('Authentication failed') ||
        stderr.includes('authentication failed') ||
        stderr.includes('Permission denied') ||
        stderr.includes('could not read Username')
      ) {
        return err({ type: 'auth_failed', message });
      }

      if (
        stderr.includes('Could not resolve host') ||
        stderr.includes('could not resolve host') ||
        stderr.includes('Network is unreachable') ||
        stderr.includes('Connection refused') ||
        stderr.includes('Connection timed out') ||
        stderr.includes('unable to connect')
      ) {
        return err({ type: 'network_error', message });
      }

      if (stderr.includes('hook declined') || stderr.includes('pre-receive hook')) {
        return err({ type: 'hook_rejected', message });
      }

      if (stderr.includes('No configured push destination') || stderr.includes('no remote')) {
        return err({ type: 'no_remote', message });
      }

      return err({ type: 'error', message });
    }
  }

  async publishBranch(
    branchName: string,
    remote = 'origin'
  ): Promise<Result<{ output: string }, PushError>> {
    const doPush = async (args: string[]): Promise<string> => {
      const { stdout, stderr } = await this.ctx.exec(GIT_EXECUTABLE, args);
      return (stdout || stderr || '').trim();
    };

    try {
      const output = await doPush(['push', '--set-upstream', remote, branchName]);
      return ok({ output });
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || '';
      const message = stderr || String(error);

      if (stderr.includes('Everything up-to-date') || message.includes('Everything up-to-date')) {
        return ok({ output: 'Everything up-to-date' });
      }

      if (
        stderr.includes('[rejected]') ||
        stderr.includes('Updates were rejected') ||
        stderr.includes('non-fast-forward')
      ) {
        try {
          await this.ctx.exec(GIT_EXECUTABLE, [
            'branch',
            `--set-upstream-to=${remote}/${branchName}`,
            branchName,
          ]);
        } catch {}
        return err({ type: 'rejected', message });
      }

      if (
        stderr.includes('Authentication failed') ||
        stderr.includes('authentication failed') ||
        stderr.includes('Permission denied') ||
        stderr.includes('could not read Username')
      ) {
        return err({ type: 'auth_failed', message });
      }

      if (
        stderr.includes('Could not resolve host') ||
        stderr.includes('could not resolve host') ||
        stderr.includes('Network is unreachable') ||
        stderr.includes('Connection refused') ||
        stderr.includes('Connection timed out') ||
        stderr.includes('unable to connect')
      ) {
        return err({ type: 'network_error', message });
      }

      if (stderr.includes('hook declined') || stderr.includes('pre-receive hook')) {
        return err({ type: 'hook_rejected', message });
      }

      if (
        stderr.includes('No configured push destination') ||
        stderr.includes('no remote') ||
        stderr.includes('does not appear to be a git repository')
      ) {
        return err({ type: 'no_remote', message });
      }

      return err({ type: 'error', message });
    }
  }

  async pull(): Promise<Result<{ output: string }, PullError>> {
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, ['pull']);
      return ok({ output: stdout.trim() });
    } catch (error: unknown) {
      const stdout = (error as { stdout?: string })?.stdout || '';
      const stderr = (error as { stderr?: string })?.stderr || '';
      const message = stderr || String(error);

      if (stdout.includes('CONFLICT') || stderr.includes('CONFLICT')) {
        let conflictedFiles: string[] = [];
        try {
          const { stdout: conflictOut } = await this.ctx.exec(GIT_EXECUTABLE, [
            'diff',
            '--name-only',
            '--diff-filter=U',
          ]);
          conflictedFiles = conflictOut
            .split('\n')
            .map((f) => f.trim())
            .filter(Boolean);
        } catch {}
        return err({ type: 'conflict', conflictedFiles, message });
      }

      if (
        stderr.includes('There is no tracking information') ||
        stderr.includes('no tracking information') ||
        stderr.includes('has no upstream branch') ||
        stderr.includes('no upstream configured')
      ) {
        return err({ type: 'no_upstream', message });
      }

      if (
        stderr.includes('Need to specify how to reconcile') ||
        stderr.includes('hint: You have divergent branches') ||
        stderr.includes('fatal: Need to specify how to reconcile')
      ) {
        return err({ type: 'diverged', message });
      }

      if (
        stderr.includes('Authentication failed') ||
        stderr.includes('authentication failed') ||
        stderr.includes('Permission denied') ||
        stderr.includes('could not read Username')
      ) {
        return err({ type: 'auth_failed', message });
      }

      if (
        stderr.includes('Could not resolve host') ||
        stderr.includes('could not resolve host') ||
        stderr.includes('Network is unreachable') ||
        stderr.includes('Connection refused') ||
        stderr.includes('Connection timed out') ||
        stderr.includes('unable to connect')
      ) {
        return err({ type: 'network_error', message });
      }

      return err({ type: 'error', message });
    }
  }

  async softReset(): Promise<Result<{ subject: string; body: string }, SoftResetError>> {
    try {
      await this.ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--verify', 'HEAD~1']);
    } catch {
      return err({ type: 'initial_commit' });
    }

    const { commits: log } = await this.getLog({ maxCount: 1 });
    if (log[0]?.isPushed) {
      return err({ type: 'already_pushed' });
    }

    try {
      const { stdout: subject } = await this.ctx.exec(GIT_EXECUTABLE, [
        'log',
        '-1',
        '--pretty=format:%s',
      ]);
      const { stdout: body } = await this.ctx.exec(GIT_EXECUTABLE, [
        'log',
        '-1',
        '--pretty=format:%b',
      ]);

      await this.ctx.exec(GIT_EXECUTABLE, ['reset', '--soft', 'HEAD~1']);

      return ok({ subject: subject.trim(), body: body.trim() });
    } catch (error: unknown) {
      return err({ type: 'error', message: String(error) });
    }
  }

  async getCurrentBranch(): Promise<string | null> {
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, [
        'rev-parse',
        '--symbolic-full-name',
        'HEAD',
      ]);
      const ref = stdout.trim();
      if (ref === 'HEAD' || !ref) return null;
      if (ref.startsWith('refs/heads/')) return ref.slice('refs/heads/'.length);
      if (ref.startsWith('heads/')) return ref.slice('heads/'.length);
      return ref;
    } catch {
      return null;
    }
  }

  async getWorktreeGitDir(mainDotGitAbs: string): Promise<string> {
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--git-dir']);
      const raw = stdout.trim();
      const root = this.ctx.root ?? '';
      const gitDirAbs = path.isAbsolute(raw) ? raw : path.resolve(root, raw);
      const rel = path.relative(mainDotGitAbs, gitDirAbs).replace(/\\/g, '/');
      return rel === '.' || rel === '' ? '' : rel;
    } catch {
      return `worktrees/${path.basename(this.ctx.root ?? '')}`;
    }
  }

  async getBranches(): Promise<Branch[]> {
    const remotes = await this.getRemotes();
    const remoteByName = new Map(remotes.map((remote) => [remote.name, remote]));
    const { stdout } = await this.ctx.exec(
      'git',
      ['branch', '-a', '--format=%(refname:short)|%(upstream:short)|%(upstream:track)|%(refname)'],
      { maxBuffer: MAX_REF_LIST_BYTES }
    );

    const branches: Branch[] = [];

    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const [refname, upstreamRef, track, fullRef] = trimmed.split('|');

      if (fullRef?.startsWith('refs/remotes/')) {
        const withoutPrefix = fullRef.slice('refs/remotes/'.length);
        if (withoutPrefix.includes('HEAD')) continue;
        const slashIdx = withoutPrefix.indexOf('/');
        const remoteName = slashIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, slashIdx);
        const branchName = slashIdx === -1 ? '' : withoutPrefix.slice(slashIdx + 1);
        const entry: RemoteBranch = {
          type: 'remote',
          branch: branchName,
          remote: remoteByName.get(remoteName) ?? { name: remoteName, url: '' },
        };
        branches.push(entry);
      } else {
        const localBranchName = fullRef?.startsWith('refs/heads/')
          ? fullRef.slice('refs/heads/'.length)
          : refname;
        const entry: LocalBranch = { type: 'local', branch: localBranchName };
        if (upstreamRef) {
          const slashIdx = upstreamRef.indexOf('/');
          const remoteName = slashIdx === -1 ? upstreamRef : upstreamRef.slice(0, slashIdx);
          entry.remote = remoteByName.get(remoteName) ?? { name: remoteName, url: '' };
          if (track) {
            const ahead = Number.parseInt(/ahead (\d+)/.exec(track)?.[1] ?? '0', 10);
            const behind = Number.parseInt(/behind (\d+)/.exec(track)?.[1] ?? '0', 10);
            entry.divergence = { ahead, behind };
          }
        }
        branches.push(entry);
      }
    }

    return branches;
  }

  async getDefaultBranch(remote = 'origin'): Promise<string> {
    // Heuristic 1: ask the remote what its HEAD points to (fast, no network call needed
    // because git caches this in refs/remotes/<remote>/HEAD after a fetch/clone).
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, [
        'symbolic-ref',
        `refs/remotes/${remote}/HEAD`,
        '--short',
      ]);
      const ref = stdout.trim();
      if (ref) {
        const slashIdx = ref.indexOf('/');
        return slashIdx === -1 ? ref : ref.slice(slashIdx + 1);
      }
    } catch {}

    // Heuristic 2: ask the remote directly (requires a network call).
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, ['remote', 'show', remote]);
      const match = /HEAD branch:\s*(\S+)/.exec(stdout);
      if (match?.[1]) return match[1];
    } catch {}

    // Heuristic 3: fall back to well-known default branch names in preference order.
    for (const candidate of ['main', 'master', 'develop', 'trunk']) {
      if (await this._branchExistsLocally(candidate)) return candidate;
    }

    // Last resort: return "main" as a convention.
    return 'main';
  }

  private async _branchExistsLocally(branch: string): Promise<boolean> {
    try {
      await this.ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--verify', `refs/heads/${branch}`]);
      return true;
    } catch {
      return false;
    }
  }

  async getRemotes(): Promise<{ name: string; url: string }[]> {
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, ['remote', '-v']);
      const seen = new Set<string>();
      const remotes: { name: string; url: string }[] = [];
      for (const line of stdout.split('\n')) {
        const match = /^(\S+)\s+(\S+)\s+\(fetch\)$/.exec(line.trim());
        if (match?.[1] && match[2] && !seen.has(match[1])) {
          seen.add(match[1]);
          remotes.push({ name: match[1], url: match[2] });
        }
      }
      return remotes;
    } catch {
      return [];
    }
  }

  async getHeadState(): Promise<GitHeadState> {
    let headName: string | undefined;
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, [
        'symbolic-ref',
        '--quiet',
        '--short',
        'HEAD',
      ]);
      headName = stdout.trim() || undefined;
    } catch {}

    try {
      await this.ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--verify', 'HEAD']);
      return { headName, isUnborn: false };
    } catch {
      return { headName, isUnborn: true };
    }
  }

  async addRemote(name: string, url: string): Promise<void> {
    await this.ctx.exec(GIT_EXECUTABLE, ['remote', 'add', name, url]);
  }

  async createBranch(
    name: string,
    from: string,
    syncWithRemote = true,
    remote = 'origin'
  ): Promise<Result<void, CreateBranchError>> {
    if (syncWithRemote) {
      await this.ctx
        .exec('git', ['fetch', remote], {
          maxBuffer: MAX_REF_LIST_BYTES,
        })
        .catch(() => {});
    }
    const base = syncWithRemote ? `${remote}/${from}` : `refs/heads/${from}`;
    try {
      await this.ctx.exec(GIT_EXECUTABLE, ['branch', '--no-track', name, base]);
      return ok();
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || String(error);
      if (stderr.includes('already exists')) {
        return err({ type: 'already_exists', name });
      }
      if (
        stderr.includes('not a valid object name') ||
        stderr.includes('Not a valid object name') ||
        stderr.includes('invalid reference')
      ) {
        return err({ type: 'invalid_base', from });
      }
      if (
        stderr.includes('not a valid branch name') ||
        stderr.includes('invalid branch name') ||
        stderr.includes("'.' is not a valid branch name")
      ) {
        return err({ type: 'invalid_name', name });
      }
      return err({ type: 'error', message: stderr });
    }
  }

  async fetchPrForReview(
    prNumber: number,
    headRefName: string,
    headRepositoryUrl: string,
    localBranch: string,
    isFork: boolean,
    configuredRemote = 'origin'
  ): Promise<Result<void, FetchPrForReviewError>> {
    try {
      if (isFork) {
        const forkRemote = ownerFromUrl(headRepositoryUrl) ?? 'fork';
        // Idempotently ensure remote exists with the correct URL
        const remotes = await this.ctx
          .exec(GIT_EXECUTABLE, ['remote'])
          .catch(() => ({ stdout: '' }));
        const names = remotes.stdout
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);
        if (!names.includes(forkRemote)) {
          await this.ctx.exec(GIT_EXECUTABLE, ['remote', 'add', forkRemote, headRepositoryUrl]);
        } else {
          await this.ctx
            .exec('git', ['remote', 'set-url', forkRemote, headRepositoryUrl])
            .catch(() => {});
        }
        await this.ctx.exec(GIT_EXECUTABLE, [
          'fetch',
          forkRemote,
          `${headRefName}:refs/heads/${localBranch}`,
          '--force',
        ]);
        // Set tracking so `git push` targets the contributor's fork branch
        await this.ctx
          .exec('git', ['branch', `--set-upstream-to=${forkRemote}/${headRefName}`, localBranch])
          .catch(() => {});
      } else {
        // Same-repo: GitHub always exposes refs/pull/{N}/head on origin
        await this.ctx.exec(GIT_EXECUTABLE, [
          'fetch',
          configuredRemote,
          `refs/pull/${prNumber}/head:refs/heads/${localBranch}`,
          '--force',
        ]);
        await this.ctx
          .exec('git', [
            'branch',
            `--set-upstream-to=${configuredRemote}/${headRefName}`,
            localBranch,
          ])
          .catch(() => {});
      }
      return ok();
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr ?? String(error);
      if (
        stderr.includes('not found') ||
        stderr.includes("couldn't find remote ref") ||
        stderr.includes('unknown revision')
      ) {
        return err({ type: 'not_found', prNumber });
      }
      return err({ type: 'error', message: stderr });
    }
  }

  async renameBranch(
    oldBranch: string,
    newBranch: string
  ): Promise<Result<{ remotePushed: boolean }, RenameBranchError>> {
    let remoteName: string | undefined;
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, [
        'config',
        '--get',
        `branch.${oldBranch}.remote`,
      ]);
      remoteName = stdout.trim() || undefined;
    } catch {}

    try {
      await this.ctx.exec(GIT_EXECUTABLE, ['branch', '-m', oldBranch, newBranch]);
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || String(error);
      if (stderr.includes('already exists')) {
        return err({ type: 'already_exists', name: newBranch });
      }
      return err({ type: 'error', message: stderr });
    }

    if (remoteName) {
      try {
        await this.ctx.exec(GIT_EXECUTABLE, ['push', remoteName, '--delete', oldBranch]);
      } catch {}
      try {
        await this.ctx.exec(GIT_EXECUTABLE, ['push', '-u', remoteName, newBranch]);
      } catch (error: unknown) {
        const stderr = (error as { stderr?: string })?.stderr || String(error);
        return err({ type: 'remote_push_failed', message: stderr });
      }
    }

    return ok({ remotePushed: !!remoteName });
  }

  async deleteBranch(branch: string, force = true): Promise<Result<void, DeleteBranchError>> {
    const flag = force ? '-D' : '-d';
    try {
      await this.ctx.exec(GIT_EXECUTABLE, ['branch', flag, branch]);
      return ok();
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || String(error);
      if (stderr.includes('not fully merged')) {
        return err({ type: 'unmerged', branch });
      }
      if (stderr.includes('not found') || stderr.includes('did not match any branch')) {
        return err({ type: 'not_found', branch });
      }
      if (stderr.includes('checked out') || stderr.includes('is not fully merged')) {
        return err({ type: 'is_current', branch });
      }
      return err({ type: 'error', message: stderr });
    }
  }

  // ---------------------------------------------------------------------------
  // Repo info
  // ---------------------------------------------------------------------------

  async detectInfo(): Promise<GitInfo> {
    try {
      await this.ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--is-inside-work-tree']);
    } catch {
      return { isGitRepo: false, baseRef: 'main', rootPath: this.ctx.root ?? '' };
    }

    let remoteName: string | undefined;
    let remote: string | undefined;
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, ['remote']);
      const remotes = stdout.trim().split('\n').filter(Boolean);
      remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
    } catch {}

    if (remoteName) {
      try {
        const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, ['remote', 'get-url', remoteName]);
        remote = stdout.trim() || undefined;
      } catch {}
    }

    let branch: string | undefined;
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, ['branch', '--show-current']);
      branch = stdout.trim() || undefined;
    } catch {}

    if (!branch && remoteName) {
      try {
        const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, ['remote', 'show', remoteName]);
        const match = /HEAD branch:\s*(\S+)/.exec(stdout);
        branch = match?.[1] ?? undefined;
      } catch {}
    }

    let rootPath: string = this.ctx.root ?? '';
    try {
      const { stdout } = await this.ctx.exec(GIT_EXECUTABLE, ['rev-parse', '--show-toplevel']);
      const trimmed = stdout.trim();
      if (trimmed) rootPath = trimmed;
    } catch {}

    return {
      isGitRepo: true,
      remote,
      branch,
      baseRef: computeBaseRef(undefined, remoteName, branch),
      rootPath,
    };
  }

  async initRepository(): Promise<void> {
    await this.ctx.exec(GIT_EXECUTABLE, ['init']);
  }
}
