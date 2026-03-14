import type {
  Branch,
  Commit,
  CommitFile,
  DefaultBranch,
  DiffBase,
  DiffLine,
  DiffResult,
  GitChange,
  GitInfo,
  LocalBranch,
  PullError,
  PushError,
  RemoteBranch,
} from '@shared/git';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { ExecFn } from '@main/core/utils/exec';
import { err, ok, type Result } from '@main/lib/result';
import { GitProvider } from '../types';
import {
  computeBaseRef,
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

    const changes: GitChange[] = [];

    for (const line of statusLines) {
      const statusCode = line.substring(0, 2);
      let filePath = line.substring(3);
      if (statusCode.includes('R') && filePath.includes('->')) {
        const parts = filePath.split('->');
        filePath = (parts[parts.length - 1] ?? '').trim();
      }

      let status = 'modified';
      if (statusCode.includes('A') || statusCode.includes('?')) status = 'added';
      else if (statusCode.includes('D')) status = 'deleted';
      else if (statusCode.includes('R')) status = 'renamed';
      else if (statusCode.includes('M')) status = 'modified';

      const isStaged = statusCode[0] !== ' ' && statusCode[0] !== '?';
      let additions = 0;
      let deletions = 0;

      const sumNumstat = (stdout: string) => {
        for (const l of stdout
          .trim()
          .split('\n')
          .filter((s) => s.trim())) {
          const p = l.split('\t');
          if (p.length >= 2) {
            additions += p[0] === '-' ? 0 : Number.parseInt(p[0] ?? '0', 10) || 0;
            deletions += p[1] === '-' ? 0 : Number.parseInt(p[1] ?? '0', 10) || 0;
          }
        }
      };

      try {
        const { stdout } = await this.exec(
          'git',
          ['diff', '--numstat', '--cached', '--', filePath],
          { cwd: this.path }
        );
        if (stdout.trim()) sumNumstat(stdout);
      } catch {}

      try {
        const { stdout } = await this.exec('git', ['diff', '--numstat', '--', filePath], {
          cwd: this.path,
        });
        if (stdout.trim()) sumNumstat(stdout);
      } catch {}

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

  async stageFile(filePath: string): Promise<void> {
    await this.exec('git', ['add', '--', filePath], { cwd: this.path });
  }

  async stageAllFiles(): Promise<void> {
    await this.exec('git', ['add', '-A'], { cwd: this.path });
  }

  async unstageFile(filePath: string): Promise<void> {
    try {
      await this.exec('git', ['reset', 'HEAD', '--', filePath], { cwd: this.path });
    } catch {
      await this.exec('git', ['rm', '--cached', '--', filePath], { cwd: this.path });
    }
  }

  async revertFile(filePath: string): Promise<{ action: 'unstaged' | 'reverted' }> {
    let fileExistsInHead = false;
    try {
      await this.exec('git', ['cat-file', '-e', `HEAD:${filePath}`], { cwd: this.path });
      fileExistsInHead = true;
    } catch {
      const exists = await this.fs.exists(filePath);
      if (exists) {
        await this.fs.remove(filePath);
      }
      return { action: 'reverted' };
    }

    if (fileExistsInHead) {
      await this.exec('git', ['checkout', 'HEAD', '--', filePath], { cwd: this.path });
    }
    return { action: 'reverted' };
  }

  // ---------------------------------------------------------------------------
  // Diffs
  // ---------------------------------------------------------------------------

  async getFileDiff(filePath: string, base: DiffBase = 'HEAD'): Promise<DiffResult> {
    const diffArgs =
      base === 'staged'
        ? ['diff', '--no-color', '--unified=2000', '--cached', '--', filePath]
        : ['diff', '--no-color', '--unified=2000', 'HEAD', '--', filePath];

    let diffStdout: string | undefined;
    try {
      const { stdout } = await this.exec('git', diffArgs, {
        cwd: this.path,
        maxBuffer: MAX_DIFF_OUTPUT_BYTES,
      });
      diffStdout = stdout;
    } catch {}

    const getOriginalContent = async (): Promise<string | undefined> => {
      try {
        const { stdout } = await this.exec('git', ['show', `HEAD:${filePath}`], {
          cwd: this.path,
          maxBuffer: MAX_DIFF_CONTENT_BYTES,
        });
        return stripTrailingNewline(stdout);
      } catch {
        return undefined;
      }
    };

    const getModifiedContent = async (): Promise<string | undefined> => {
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
      const status =
        code === 'A'
          ? 'added'
          : code === 'D'
            ? 'deleted'
            : code?.startsWith('R')
              ? 'renamed'
              : 'modified';
      statusMap.set(filePath, status);
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

  async commit(message: string): Promise<{ hash: string }> {
    if (!message || !message.trim()) throw new Error('Commit message cannot be empty');
    await this.exec('git', ['commit', '-m', message], { cwd: this.path });
    const { stdout } = await this.exec('git', ['rev-parse', 'HEAD'], { cwd: this.path });
    return { hash: stdout.trim() };
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

      if (stderr.includes('has no upstream branch') || stderr.includes('no upstream configured')) {
        try {
          const { stdout: branchOut } = await this.exec('git', ['branch', '--show-current'], {
            cwd: this.path,
          });
          const output = await doPush(['push', '--set-upstream', 'origin', branchOut.trim()]);
          return ok({ output });
        } catch (upstreamError: unknown) {
          const upstreamStderr = (upstreamError as { stderr?: string })?.stderr || '';
          return err({ type: 'error', message: upstreamStderr || String(upstreamError) });
        }
      }

      if (stderr.includes('[rejected]') || stderr.includes('Updates were rejected')) {
        return err({ type: 'rejected', message });
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

      return err({ type: 'error', message });
    }
  }

  async softReset(): Promise<{ subject: string; body: string }> {
    try {
      await this.exec('git', ['rev-parse', '--verify', 'HEAD~1'], { cwd: this.path });
    } catch {
      throw new Error('Cannot undo the initial commit');
    }

    const { commits: log } = await this.getLog({ maxCount: 1 });
    if (log[0]?.isPushed) {
      throw new Error('Cannot undo a commit that has already been pushed');
    }

    const { stdout: subject } = await this.exec('git', ['log', '-1', '--pretty=format:%s'], {
      cwd: this.path,
    });
    const { stdout: body } = await this.exec('git', ['log', '-1', '--pretty=format:%b'], {
      cwd: this.path,
    });

    await this.exec('git', ['reset', '--soft', 'HEAD~1'], { cwd: this.path });

    return { subject: subject.trim(), body: body.trim() };
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

  async getDefaultBranch(): Promise<DefaultBranch> {
    // Heuristic 1: ask the remote what its HEAD points to (fast, no network call needed
    // because git caches this in refs/remotes/origin/HEAD after a fetch/clone).
    try {
      const { stdout } = await this.exec(
        'git',
        ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
        { cwd: this.path }
      );
      const ref = stdout.trim(); // e.g. "origin/main"
      if (ref) {
        const slashIdx = ref.indexOf('/');
        const remote = slashIdx === -1 ? 'origin' : ref.slice(0, slashIdx);
        const name = slashIdx === -1 ? ref : ref.slice(slashIdx + 1);
        const existsLocally = await this._branchExistsLocally(name);
        return { name, remote, existsLocally };
      }
    } catch {}

    // Heuristic 2: ask the remote directly (requires a network call).
    try {
      const { stdout } = await this.exec('git', ['remote', 'show', 'origin'], { cwd: this.path });
      const match = /HEAD branch:\s*(\S+)/.exec(stdout);
      if (match?.[1]) {
        const name = match[1];
        const existsLocally = await this._branchExistsLocally(name);
        return { name, remote: 'origin', existsLocally };
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

  async renameBranch(oldBranch: string, newBranch: string): Promise<{ remotePushed: boolean }> {
    let remotePushed = false;
    try {
      const { stdout } = await this.exec('git', ['config', '--get', `branch.${oldBranch}.remote`], {
        cwd: this.path,
      });
      remotePushed = Boolean(stdout.trim());
    } catch {}

    await this.exec('git', ['branch', '-m', oldBranch, newBranch], { cwd: this.path });

    if (remotePushed) {
      try {
        await this.exec('git', ['push', 'origin', '--delete', oldBranch], { cwd: this.path });
      } catch {}
      await this.exec('git', ['push', '-u', 'origin', newBranch], { cwd: this.path });
    }

    return { remotePushed };
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

    let remote: string | undefined;
    try {
      const { stdout } = await this.exec('git', ['remote', 'get-url', 'origin'], {
        cwd: this.path,
      });
      remote = stdout.trim() || undefined;
    } catch {}

    let branch: string | undefined;
    try {
      const { stdout } = await this.exec('git', ['branch', '--show-current'], { cwd: this.path });
      branch = stdout.trim() || undefined;
    } catch {}

    if (!branch) {
      try {
        const { stdout } = await this.exec('git', ['remote', 'show', 'origin'], { cwd: this.path });
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
      baseRef: computeBaseRef(remote, branch),
      rootPath,
    };
  }
}
