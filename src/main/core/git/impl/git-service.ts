import type {
  Branch,
  Commit,
  CommitError,
  CommitFile,
  CreateBranchError,
  DefaultBranch,
  DeleteBranchError,
  DiffBase,
  DiffLine,
  DiffResult,
  FetchError,
  FetchPrRefError,
  GitChange,
  GitInfo,
  LocalBranch,
  PullError,
  PushError,
  RemoteBranch,
  RenameBranchError,
  SoftResetError,
} from '@shared/git';
import { err, ok, type Result } from '@shared/result';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { ExecFn } from '@main/core/utils/exec';
import { GitProvider } from '../types';
import {
  computeBaseRef,
  mapStatus,
  MAX_DIFF_CONTENT_BYTES,
  MAX_DIFF_OUTPUT_BYTES,
  parseDiffLines,
  stripTrailingNewline,
} from './git-utils';

export class GitService implements GitProvider {
  constructor(
    private readonly path: string,
    private readonly exec: ExecFn,
    private readonly fs: FileSystemProvider
  ) {}

  // ---------------------------------------------------------------------------
  // Status & staging
  // ---------------------------------------------------------------------------

  async getStatus(): Promise<GitChange[]> {
    try {
      await this.exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: this.path });
    } catch {
      return [];
    }

    const { stdout: statusOutput } = await this.exec(
      'git',
      ['status', '--porcelain', '--untracked-files=all'],
      { cwd: this.path }
    );

    if (!statusOutput.trim()) return [];

    const statusLines = statusOutput
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter((l) => l.length > 0);

    // Fetch all staged and unstaged numstat counts in two parallel commands
    // instead of N×2 sequential per-file invocations.
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

    const [stagedNumstat, unstagedNumstat] = await Promise.all([
      this.exec('git', ['diff', '--numstat', '--cached'], { cwd: this.path })
        .then((r) => parseNumstat(r.stdout))
        .catch(() => new Map<string, { additions: number; deletions: number }>()),
      this.exec('git', ['diff', '--numstat'], { cwd: this.path })
        .then((r) => parseNumstat(r.stdout))
        .catch(() => new Map<string, { additions: number; deletions: number }>()),
    ]);

    const changes: GitChange[] = [];

    for (const line of statusLines) {
      const statusCode = line.substring(0, 2);
      let filePath = line.substring(3);
      if (statusCode.includes('R') && filePath.includes('->')) {
        const parts = filePath.split('->');
        filePath = (parts[parts.length - 1] ?? '').trim();
      }

      const status = mapStatus(statusCode);
      const isStaged = statusCode[0] !== ' ' && statusCode[0] !== '?';

      const staged = stagedNumstat.get(filePath);
      const unstaged = unstagedNumstat.get(filePath);
      let additions = (staged?.additions ?? 0) + (unstaged?.additions ?? 0);
      const deletions = (staged?.deletions ?? 0) + (unstaged?.deletions ?? 0);

      // Untracked files don't appear in git diff output; count lines from content.
      if (additions === 0 && deletions === 0 && statusCode.includes('?')) {
        try {
          const result = await this.fs.read(filePath, MAX_DIFF_CONTENT_BYTES);
          if (!result.truncated) {
            additions = (result.content.match(/\n/g) ?? []).length;
          }
        } catch {}
      }

      changes.push({ path: filePath, status, additions, deletions, isStaged });
    }

    return changes;
  }

  async stageFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    await this.exec('git', ['add', '--', ...filePaths], { cwd: this.path });
  }

  async stageAllFiles(): Promise<void> {
    await this.exec('git', ['add', '-A'], { cwd: this.path });
  }

  async unstageFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;
    try {
      await this.exec('git', ['reset', 'HEAD', '--', ...filePaths], { cwd: this.path });
    } catch {
      // Fallback for edge cases (e.g. new files with no HEAD): unstage each via rm --cached
      for (const filePath of filePaths) {
        try {
          await this.exec('git', ['reset', 'HEAD', '--', filePath], { cwd: this.path });
        } catch {
          await this.exec('git', ['rm', '--cached', '--', filePath], { cwd: this.path });
        }
      }
    }
  }

  async unstageAllFiles(): Promise<void> {
    try {
      await this.exec('git', ['reset', 'HEAD'], { cwd: this.path });
    } catch {
      // Repo may have no commits yet; ignore.
    }
  }

  async revertFiles(filePaths: string[]): Promise<void> {
    if (filePaths.length === 0) return;

    // Determine which files exist in HEAD in a single command
    let trackedPaths = new Set<string>();
    try {
      const { stdout } = await this.exec(
        'git',
        ['ls-tree', '--name-only', 'HEAD', '--', ...filePaths],
        { cwd: this.path }
      );
      trackedPaths = new Set(stdout.trim().split('\n').filter(Boolean));
    } catch {
      // Empty repo — no HEAD yet, all files are untracked
    }

    const tracked = filePaths.filter((f) => trackedPaths.has(f));
    const untracked = filePaths.filter((f) => !trackedPaths.has(f));

    if (tracked.length > 0) {
      await this.exec('git', ['checkout', 'HEAD', '--', ...tracked], { cwd: this.path });
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
      await this.exec('git', ['reset', '--hard', 'HEAD'], { cwd: this.path });
    } catch {
      // Repo may have no commits yet; ignore.
    }
    await this.exec('git', ['clean', '-fd'], { cwd: this.path });
  }

  // ---------------------------------------------------------------------------
  // Diffs
  // ---------------------------------------------------------------------------

  async getFileAtHead(filePath: string): Promise<string | null> {
    return this.getFileAtRef(filePath, 'HEAD');
  }

  async getFileAtRef(filePath: string, ref: string): Promise<string | null> {
    try {
      const { stdout } = await this.exec('git', ['show', `${ref}:${filePath}`], {
        cwd: this.path,
        maxBuffer: MAX_DIFF_CONTENT_BYTES,
      });
      return stripTrailingNewline(stdout);
    } catch {
      return null;
    }
  }

  async getFileAtIndex(filePath: string): Promise<string | null> {
    try {
      const { stdout } = await this.exec('git', ['show', `:0:${filePath}`], {
        cwd: this.path,
        maxBuffer: MAX_DIFF_CONTENT_BYTES,
      });
      return stripTrailingNewline(stdout);
    } catch {
      return null;
    }
  }

  async getFileDiff(filePath: string, base: DiffBase = 'HEAD'): Promise<DiffResult> {
    const isBranchDiff = base !== 'HEAD' && base !== 'staged';
    const diffArgs =
      base === 'staged'
        ? ['diff', '--no-color', '--unified=2000', '--cached', '--', filePath]
        : isBranchDiff
          ? ['diff', '--no-color', '--unified=2000', `${base}...HEAD`, '--', filePath]
          : ['diff', '--no-color', '--unified=2000', 'HEAD', '--', filePath];

    let diffStdout: string | undefined;
    try {
      const { stdout } = await this.exec('git', diffArgs, {
        cwd: this.path,
        maxBuffer: MAX_DIFF_OUTPUT_BYTES,
      });
      diffStdout = stdout;
    } catch {}

    const originalRef = isBranchDiff ? base : 'HEAD';

    const getOriginalContent = async (): Promise<string | undefined> => {
      try {
        const { stdout } = await this.exec('git', ['show', `${originalRef}:${filePath}`], {
          cwd: this.path,
          maxBuffer: MAX_DIFF_CONTENT_BYTES,
        });
        return stripTrailingNewline(stdout);
      } catch {
        return undefined;
      }
    };

    const getModifiedContent = async (): Promise<string | undefined> => {
      if (isBranchDiff) {
        try {
          const { stdout } = await this.exec('git', ['show', `HEAD:${filePath}`], {
            cwd: this.path,
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
        const { stdout } = await this.exec('git', ['show', `${ref}:${filePath}`], {
          cwd: this.path,
          maxBuffer: MAX_DIFF_CONTENT_BYTES,
        });
        return stripTrailingNewline(stdout);
      } catch {
        return undefined;
      }
    };

    let hasParent = true;
    try {
      await this.exec('git', ['rev-parse', '--verify', `${commitHash}~1`], { cwd: this.path });
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
      const { stdout } = await this.exec(
        'git',
        ['diff', '--no-color', '--unified=2000', `${commitHash}~1`, commitHash, '--', filePath],
        { cwd: this.path, maxBuffer: MAX_DIFF_OUTPUT_BYTES }
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
  }): Promise<{ commits: Commit[]; aheadCount: number }> {
    const { maxCount = 50, skip = 0, knownAheadCount } = options ?? {};

    let aheadCount = knownAheadCount ?? -1;
    if (aheadCount < 0) {
      aheadCount = 0;
      try {
        const { stdout } = await this.exec('git', ['rev-list', '--count', '@{upstream}..HEAD'], {
          cwd: this.path,
        });
        aheadCount = Number.parseInt(stdout.trim(), 10) || 0;
      } catch {
        try {
          const { stdout: branchOut } = await this.exec(
            'git',
            ['rev-parse', '--abbrev-ref', 'HEAD'],
            { cwd: this.path }
          );
          const currentBranch = branchOut.trim();
          const { stdout } = await this.exec(
            'git',
            ['rev-list', '--count', `origin/${currentBranch}..HEAD`],
            { cwd: this.path }
          );
          aheadCount = Number.parseInt(stdout.trim(), 10) || 0;
        } catch {
          try {
            const { stdout: defaultBranchOut } = await this.exec(
              'git',
              ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
              { cwd: this.path }
            );
            const defaultBranch = defaultBranchOut.trim();
            const { stdout } = await this.exec(
              'git',
              ['rev-list', '--count', `${defaultBranch}..HEAD`],
              { cwd: this.path }
            );
            aheadCount = Number.parseInt(stdout.trim(), 10) || 0;
          } catch {
            aheadCount = 0;
          }
        }
      }
    }

    const FIELD_SEP = '---FIELD_SEP---';
    const RECORD_SEP = '---RECORD_SEP---';
    const format = `${RECORD_SEP}%H${FIELD_SEP}%s${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%D${FIELD_SEP}%b`;
    const { stdout } = await this.exec(
      'git',
      ['log', `--max-count=${maxCount}`, `--skip=${skip}`, `--pretty=format:${format}`, '--'],
      { cwd: this.path }
    );

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

  async getChangedFiles(base: DiffBase): Promise<GitChange[]> {
    const ref = base === 'staged' ? '--cached' : String(base);

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

    const diffArgs =
      base === 'staged' ? ['diff', '--numstat', '--cached'] : ['diff', '--numstat', ref];
    const nameArgs =
      base === 'staged' ? ['diff', '--name-status', '--cached'] : ['diff', '--name-status', ref];

    const [numstatResult, nameStatusResult] = await Promise.all([
      this.exec('git', diffArgs, { cwd: this.path }).catch(() => ({ stdout: '' })),
      this.exec('git', nameArgs, { cwd: this.path }).catch(() => ({ stdout: '' })),
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
        isStaged: base === 'staged',
      });
    }

    return changes;
  }

  async getCommitFiles(commitHash: string): Promise<CommitFile[]> {
    const { stdout } = await this.exec(
      'git',
      [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '-r',
        '-m',
        '--first-parent',
        '--numstat',
        commitHash,
      ],
      { cwd: this.path }
    );

    const { stdout: nameStatus } = await this.exec(
      'git',
      [
        'diff-tree',
        '--root',
        '--no-commit-id',
        '-r',
        '-m',
        '--first-parent',
        '--name-status',
        commitHash,
      ],
      { cwd: this.path }
    );

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
      await this.exec('git', ['commit', '-m', message], { cwd: this.path });
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
      const { stdout } = await this.exec('git', ['rev-parse', 'HEAD'], { cwd: this.path });
      return ok({ hash: stdout.trim() });
    } catch (error: unknown) {
      return err({ type: 'error', message: String(error) });
    }
  }

  async fetch(): Promise<Result<void, FetchError>> {
    try {
      const remotes = await this.exec('git', ['remote'], { cwd: this.path }).catch(() => ({
        stdout: '',
      }));
      if (!remotes.stdout.trim()) return err({ type: 'no_remote' });
      await this.exec('git', ['fetch'], { cwd: this.path });
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

  async push(): Promise<Result<{ output: string }, PushError>> {
    const doPush = async (args: string[]): Promise<string> => {
      const { stdout, stderr } = await this.exec('git', args, { cwd: this.path });
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
          const { stdout: branchOut } = await this.exec('git', ['branch', '--show-current'], {
            cwd: this.path,
          });
          const currentBranch = branchOut.trim();
          let pushRemote = 'origin';
          try {
            const { stdout: remoteOut } = await this.exec(
              'git',
              ['config', '--get', `branch.${currentBranch}.remote`],
              { cwd: this.path }
            );
            if (remoteOut.trim()) pushRemote = remoteOut.trim();
          } catch {}
          const output = await doPush(['push', '--set-upstream', pushRemote, currentBranch]);
          return ok({ output });
        } catch (upstreamError: unknown) {
          const upstreamStderr = (upstreamError as { stderr?: string })?.stderr || '';
          return err({ type: 'error', message: upstreamStderr || String(upstreamError) });
        }
      }

      if (stderr.includes('[rejected]') || stderr.includes('Updates were rejected')) {
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
      const { stdout, stderr } = await this.exec('git', args, { cwd: this.path });
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

      if (stderr.includes('[rejected]') || stderr.includes('Updates were rejected')) {
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
      const { stdout } = await this.exec('git', ['pull'], { cwd: this.path });
      return ok({ output: stdout.trim() });
    } catch (error: unknown) {
      const stdout = (error as { stdout?: string })?.stdout || '';
      const stderr = (error as { stderr?: string })?.stderr || '';
      const message = stderr || String(error);

      if (stdout.includes('CONFLICT') || stderr.includes('CONFLICT')) {
        let conflictedFiles: string[] = [];
        try {
          const { stdout: conflictOut } = await this.exec(
            'git',
            ['diff', '--name-only', '--diff-filter=U'],
            { cwd: this.path }
          );
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
      await this.exec('git', ['rev-parse', '--verify', 'HEAD~1'], { cwd: this.path });
    } catch {
      return err({ type: 'initial_commit' });
    }

    const { commits: log } = await this.getLog({ maxCount: 1 });
    if (log[0]?.isPushed) {
      return err({ type: 'already_pushed' });
    }

    try {
      const { stdout: subject } = await this.exec('git', ['log', '-1', '--pretty=format:%s'], {
        cwd: this.path,
      });
      const { stdout: body } = await this.exec('git', ['log', '-1', '--pretty=format:%b'], {
        cwd: this.path,
      });

      await this.exec('git', ['reset', '--soft', 'HEAD~1'], { cwd: this.path });

      return ok({ subject: subject.trim(), body: body.trim() });
    } catch (error: unknown) {
      return err({ type: 'error', message: String(error) });
    }
  }

  // ---------------------------------------------------------------------------
  // Branch info
  // ---------------------------------------------------------------------------

  async getBranchStatus(): Promise<{
    branch: string;
    upstream?: string;
    ahead: number;
    behind: number;
  }> {
    const { stdout: branchOut } = await this.exec('git', ['branch', '--show-current'], {
      cwd: this.path,
    });
    const branch = branchOut.trim();

    let upstream: string | undefined;
    let ahead = 0;
    let behind = 0;

    try {
      const { stdout } = await this.exec(
        'git',
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
        { cwd: this.path }
      );
      upstream = stdout.trim() || undefined;
    } catch {}

    try {
      const { stdout } = await this.exec(
        'git',
        ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'],
        { cwd: this.path }
      );
      const parts = stdout.trim().split(/\s+/);
      if (parts.length >= 2) {
        behind = Number.parseInt(parts[0] || '0', 10) || 0;
        ahead = Number.parseInt(parts[1] || '0', 10) || 0;
      }
    } catch {}

    return { branch, upstream, ahead, behind };
  }

  async getBranches(): Promise<Branch[]> {
    const { stdout } = await this.exec(
      'git',
      ['branch', '-a', '--format=%(refname:short)|%(upstream:short)|%(upstream:track)|%(refname)'],
      { cwd: this.path }
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
        const remote = slashIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, slashIdx);
        const branchName = slashIdx === -1 ? '' : withoutPrefix.slice(slashIdx + 1);
        const entry: RemoteBranch = { type: 'remote', branch: branchName, remote };
        branches.push(entry);
      } else {
        const entry: LocalBranch = { type: 'local', branch: refname };
        if (upstreamRef) {
          const slashIdx = upstreamRef.indexOf('/');
          entry.remote = slashIdx === -1 ? upstreamRef : upstreamRef.slice(0, slashIdx);
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

  async getDefaultBranch(remote = 'origin'): Promise<DefaultBranch> {
    // Heuristic 1: ask the remote what its HEAD points to (fast, no network call needed
    // because git caches this in refs/remotes/<remote>/HEAD after a fetch/clone).
    try {
      const { stdout } = await this.exec(
        'git',
        ['symbolic-ref', `refs/remotes/${remote}/HEAD`, '--short'],
        { cwd: this.path }
      );
      const ref = stdout.trim();
      if (ref) {
        const slashIdx = ref.indexOf('/');
        const resolvedRemote = slashIdx === -1 ? remote : ref.slice(0, slashIdx);
        const name = slashIdx === -1 ? ref : ref.slice(slashIdx + 1);
        const existsLocally = await this._branchExistsLocally(name);
        return { name, remote: resolvedRemote, existsLocally };
      }
    } catch {}

    // Heuristic 2: ask the remote directly (requires a network call).
    try {
      const { stdout } = await this.exec('git', ['remote', 'show', remote], { cwd: this.path });
      const match = /HEAD branch:\s*(\S+)/.exec(stdout);
      if (match?.[1]) {
        const name = match[1];
        const existsLocally = await this._branchExistsLocally(name);
        return { name, remote, existsLocally };
      }
    } catch {}

    // Heuristic 3: fall back to well-known default branch names in preference order.
    for (const candidate of ['main', 'master', 'develop', 'trunk']) {
      if (await this._branchExistsLocally(candidate)) {
        return { name: candidate, remote: undefined, existsLocally: true };
      }
    }

    // Last resort: return "main" as a convention.
    return { name: 'main', remote: undefined, existsLocally: false };
  }

  private async _branchExistsLocally(branch: string): Promise<boolean> {
    try {
      await this.exec('git', ['rev-parse', '--verify', `refs/heads/${branch}`], {
        cwd: this.path,
      });
      return true;
    } catch {
      return false;
    }
  }

  async getRemotes(): Promise<{ name: string; url: string }[]> {
    try {
      const { stdout } = await this.exec('git', ['remote', '-v'], { cwd: this.path });
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

  async addRemote(name: string, url: string): Promise<void> {
    await this.exec('git', ['remote', 'add', name, url], { cwd: this.path });
  }

  async createBranch(
    name: string,
    from: string,
    syncWithRemote = true,
    remote = 'origin'
  ): Promise<Result<void, CreateBranchError>> {
    if (syncWithRemote) {
      await this.exec('git', ['fetch', remote], { cwd: this.path }).catch(() => {});
    }
    const base = syncWithRemote ? `${remote}/${from}` : `refs/heads/${from}`;
    try {
      await this.exec('git', ['branch', '--no-track', name, base], { cwd: this.path });
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

  async fetchPrRef(
    prNumber: number,
    localBranchName: string,
    remote = 'origin'
  ): Promise<Result<void, FetchPrRefError>> {
    try {
      await this.exec(
        'git',
        ['fetch', remote, `refs/pull/${prNumber}/head:refs/heads/${localBranchName}`],
        { cwd: this.path }
      );
      return ok();
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || String(error);
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
      const { stdout } = await this.exec('git', ['config', '--get', `branch.${oldBranch}.remote`], {
        cwd: this.path,
      });
      remoteName = stdout.trim() || undefined;
    } catch {}

    try {
      await this.exec('git', ['branch', '-m', oldBranch, newBranch], { cwd: this.path });
    } catch (error: unknown) {
      const stderr = (error as { stderr?: string })?.stderr || String(error);
      if (stderr.includes('already exists')) {
        return err({ type: 'already_exists', name: newBranch });
      }
      return err({ type: 'error', message: stderr });
    }

    if (remoteName) {
      try {
        await this.exec('git', ['push', remoteName, '--delete', oldBranch], { cwd: this.path });
      } catch {}
      try {
        await this.exec('git', ['push', '-u', remoteName, newBranch], { cwd: this.path });
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
      await this.exec('git', ['branch', flag, branch], { cwd: this.path });
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
      await this.exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: this.path });
    } catch {
      return { isGitRepo: false, baseRef: 'main', rootPath: this.path };
    }

    let remoteName: string | undefined;
    let remote: string | undefined;
    try {
      const { stdout } = await this.exec('git', ['remote'], { cwd: this.path });
      const remotes = stdout.trim().split('\n').filter(Boolean);
      remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
    } catch {}

    if (remoteName) {
      try {
        const { stdout } = await this.exec('git', ['remote', 'get-url', remoteName], {
          cwd: this.path,
        });
        remote = stdout.trim() || undefined;
      } catch {}
    }

    let branch: string | undefined;
    try {
      const { stdout } = await this.exec('git', ['branch', '--show-current'], { cwd: this.path });
      branch = stdout.trim() || undefined;
    } catch {}

    if (!branch && remoteName) {
      try {
        const { stdout } = await this.exec('git', ['remote', 'show', remoteName], {
          cwd: this.path,
        });
        const match = /HEAD branch:\s*(\S+)/.exec(stdout);
        branch = match?.[1] ?? undefined;
      } catch {}
    }

    let rootPath = this.path;
    try {
      const { stdout } = await this.exec('git', ['rev-parse', '--show-toplevel'], {
        cwd: this.path,
      });
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
}
