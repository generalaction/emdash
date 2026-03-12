import type { ExecResult } from '@shared/ssh/types';
import type { DiffResult, GitChange, GitInfo, IGitProvider } from '@main/core/git/types';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { quoteShellArg } from '@main/utils/shellEscape';
import {
  computeBaseRef,
  MAX_DIFF_CONTENT_BYTES,
  parseDiffLines,
  stripTrailingNewline,
} from './local-git-utils';

export class SshGitService implements IGitProvider {
  constructor(
    private readonly proxy: SshClientProxy,
    private readonly worktreePath: string
  ) {}

  private exec(command: string, cwd?: string): Promise<ExecResult> {
    const inner = cwd ? `cd ${quoteShellArg(cwd)} && ${command}` : command;
    const full = `bash -l -c ${quoteShellArg(inner)}`;
    return new Promise((resolve, reject) => {
      this.proxy.client.exec(full, (execErr, stream) => {
        if (execErr) return reject(execErr);
        let stdout = '';
        let stderr = '';
        stream.on('close', (code: number | null) => {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? -1 });
        });
        stream.on('data', (d: Buffer) => {
          stdout += d.toString('utf-8');
        });
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString('utf-8');
        });
        stream.on('error', reject);
      });
    });
  }

  private normalizeRemotePath(p: string): string {
    return p.replace(/\\/g, '/').replace(/\/+$/g, '');
  }

  private async getCurrentBranch(): Promise<string> {
    const result = await this.exec('git branch --show-current', this.worktreePath);
    return (result.stdout || '').trim();
  }

  private async getDefaultBranchName(): Promise<string> {
    // Try gh CLI first
    const ghResult = await this.exec(
      'gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null',
      this.worktreePath
    );
    if (ghResult.exitCode === 0 && ghResult.stdout.trim()) {
      return ghResult.stdout.trim();
    }

    // Fallback: parse git remote show origin
    const remoteResult = await this.exec(
      'git remote show origin 2>/dev/null | sed -n "/HEAD branch/s/.*: //p"',
      this.worktreePath
    );
    if (remoteResult.exitCode === 0 && remoteResult.stdout.trim()) {
      return remoteResult.stdout.trim();
    }

    // Fallback: symbolic-ref
    const symrefResult = await this.exec(
      'git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null',
      this.worktreePath
    );
    if (symrefResult.exitCode === 0 && symrefResult.stdout.trim()) {
      const parts = symrefResult.stdout.trim().split('/');
      return parts[parts.length - 1] ?? 'main';
    }

    return 'main';
  }

  async getStatus(): Promise<GitChange[]> {
    const cwd = this.normalizeRemotePath(this.worktreePath);

    const verifyResult = await this.exec('git rev-parse --is-inside-work-tree', cwd);
    if (verifyResult.exitCode !== 0) return [];

    const statusResult = await this.exec('git status --porcelain --untracked-files=all', cwd);
    if (statusResult.exitCode !== 0) {
      throw new Error(`Git status failed: ${statusResult.stderr}`);
    }

    const statusOutput = statusResult.stdout;
    if (!statusOutput.trim()) return [];

    const statusLines = statusOutput
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter((l) => l.length > 0);

    const [stagedNumstat, unstagedNumstat] = await Promise.all([
      this.exec('git diff --numstat --cached', cwd),
      this.exec('git diff --numstat', cwd),
    ]);

    const parseNumstat = (stdout: string): Map<string, { add: number; del: number }> => {
      const map = new Map<string, { add: number; del: number }>();
      for (const line of stdout.split('\n').filter((l) => l.trim())) {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          const add = parts[0] === '-' ? 0 : parseInt(parts[0] ?? '0', 10) || 0;
          const del = parts[1] === '-' ? 0 : parseInt(parts[1] ?? '0', 10) || 0;
          map.set(parts[2] ?? '', { add, del });
        }
      }
      return map;
    };

    const stagedStats = parseNumstat(stagedNumstat.stdout || '');
    const unstagedStats = parseNumstat(unstagedNumstat.stdout || '');

    const untrackedPaths: string[] = [];
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

      const staged = stagedStats.get(filePath);
      const unstaged = unstagedStats.get(filePath);
      const additions = (staged?.add ?? 0) + (unstaged?.add ?? 0);
      const deletions = (staged?.del ?? 0) + (unstaged?.del ?? 0);

      if (additions === 0 && deletions === 0 && statusCode.includes('?')) {
        untrackedPaths.push(filePath);
      }

      changes.push({ path: filePath, status, additions, deletions, isStaged });
    }

    if (untrackedPaths.length > 0) {
      const escaped = untrackedPaths.map((f) => quoteShellArg(f)).join(' ');
      const script =
        `for f in ${escaped}; do ` +
        `s=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null); ` +
        `if [ "$s" -le ${MAX_DIFF_CONTENT_BYTES} ] 2>/dev/null; then ` +
        `wc -l < "$f" 2>/dev/null || echo -1; ` +
        `else echo -1; fi; done`;
      const countResult = await this.exec(script, cwd);
      if (countResult.exitCode === 0) {
        const counts = countResult.stdout
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        for (let i = 0; i < untrackedPaths.length && i < counts.length; i++) {
          const count = parseInt(counts[i] ?? '-1', 10);
          if (count >= 0) {
            const change = changes.find((c) => c.path === untrackedPaths[i]);
            if (change) change.additions = count;
          }
        }
      }
    }

    return changes;
  }

  async getFileDiff(filePath: string): Promise<DiffResult> {
    const cwd = this.normalizeRemotePath(this.worktreePath);

    const diffResult = await this.exec(
      `git diff --no-color --unified=2000 HEAD -- ${quoteShellArg(filePath)}`,
      cwd
    );

    let diffLines: ReturnType<typeof parseDiffLines>['lines'] = [];
    if (diffResult.exitCode === 0 && diffResult.stdout.trim()) {
      const { lines, isBinary } = parseDiffLines(diffResult.stdout);
      if (isBinary) return { lines: [], isBinary: true };
      diffLines = lines;
    }

    const [showResult, catResult] = await Promise.all([
      this.exec(
        `s=$(git cat-file -s HEAD:${quoteShellArg(filePath)} 2>/dev/null); ` +
          `if [ "$s" -le ${MAX_DIFF_CONTENT_BYTES} ] 2>/dev/null; then git show HEAD:${quoteShellArg(filePath)}; ` +
          `else echo "__EMDASH_TOO_LARGE__"; fi`,
        cwd
      ),
      this.exec(
        `s=$(stat -c%s ${quoteShellArg(filePath)} 2>/dev/null || stat -f%z ${quoteShellArg(filePath)} 2>/dev/null); ` +
          `if [ "$s" -le ${MAX_DIFF_CONTENT_BYTES} ] 2>/dev/null; then cat ${quoteShellArg(filePath)}; else echo "__EMDASH_TOO_LARGE__"; fi`,
        cwd
      ),
    ]);

    const rawOriginal =
      showResult.exitCode === 0 ? stripTrailingNewline(showResult.stdout) : undefined;
    const originalContent = rawOriginal === '__EMDASH_TOO_LARGE__' ? undefined : rawOriginal;

    const rawModified =
      catResult.exitCode === 0 ? stripTrailingNewline(catResult.stdout) : undefined;
    const modifiedContent = rawModified === '__EMDASH_TOO_LARGE__' ? undefined : rawModified;

    if (diffLines.length > 0) return { lines: diffLines, originalContent, modifiedContent };

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

  async stageFile(filePath: string): Promise<void> {
    const cwd = this.normalizeRemotePath(this.worktreePath);
    const result = await this.exec(`git add -- ${quoteShellArg(filePath)}`, cwd);
    if (result.exitCode !== 0) throw new Error(`Failed to stage file: ${result.stderr}`);
  }

  async stageAllFiles(): Promise<void> {
    const cwd = this.normalizeRemotePath(this.worktreePath);
    const result = await this.exec('git add -A', cwd);
    if (result.exitCode !== 0) throw new Error(`Failed to stage all files: ${result.stderr}`);
  }

  async unstageFile(filePath: string): Promise<void> {
    const cwd = this.normalizeRemotePath(this.worktreePath);
    const result = await this.exec(`git reset HEAD -- ${quoteShellArg(filePath)}`, cwd);
    if (result.exitCode !== 0) throw new Error(`Failed to unstage file: ${result.stderr}`);
  }

  async revertFile(filePath: string): Promise<{ action: string }> {
    const cwd = this.normalizeRemotePath(this.worktreePath);

    const catFileResult = await this.exec(`git cat-file -e HEAD:${quoteShellArg(filePath)}`, cwd);

    if (catFileResult.exitCode !== 0) {
      await this.exec(`rm -f -- ${quoteShellArg(filePath)}`, cwd);
      return { action: 'reverted' };
    }

    const checkoutResult = await this.exec(`git checkout HEAD -- ${quoteShellArg(filePath)}`, cwd);
    if (checkoutResult.exitCode !== 0) {
      throw new Error(`Failed to revert file: ${checkoutResult.stderr}`);
    }
    return { action: 'reverted' };
  }

  async commit(message: string): Promise<{ hash: string }> {
    const cwd = this.normalizeRemotePath(this.worktreePath);
    const result = await this.exec(`git commit -m ${quoteShellArg(message)}`, cwd);
    if (result.exitCode !== 0 && !/nothing to commit/i.test(result.stderr || '')) {
      throw new Error(result.stderr || 'Commit failed');
    }
    const hashMatch = (result.stdout || '').match(/\b([0-9a-f]{7,40})\b/);
    return { hash: hashMatch?.[1] ?? '' };
  }

  async push(): Promise<{ output: string }> {
    const cwd = this.normalizeRemotePath(this.worktreePath);
    const result = await this.exec('git push', cwd);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Push failed');
    return { output: result.stdout || '' };
  }

  async pull(): Promise<{ output: string }> {
    const cwd = this.normalizeRemotePath(this.worktreePath);
    const result = await this.exec('git pull', cwd);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Pull failed');
    return { output: result.stdout || '' };
  }

  async softReset(): Promise<{ subject: string; body: string }> {
    const cwd = this.normalizeRemotePath(this.worktreePath);
    const result = await this.exec('git reset --soft HEAD~1', cwd);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'Soft reset failed');
    return { subject: '', body: '' };
  }

  async getLog(
    maxCount?: number,
    skip?: number,
    _aheadCount?: number
  ): Promise<{ commits: unknown[]; aheadCount: number }> {
    const cwd = this.normalizeRemotePath(this.worktreePath);
    const args = [`--max-count=${maxCount ?? 50}`];
    if (skip) args.push(`--skip=${skip}`);
    await this.exec(`git log --format=%H|%s|%b|%ai|%an ${args.join(' ')}`, cwd);
    return { commits: [], aheadCount: 0 };
  }

  async getLatestCommit(): Promise<{
    hash: string;
    subject: string;
    body: string;
    isPushed: boolean;
  } | null> {
    const cwd = this.normalizeRemotePath(this.worktreePath);
    const result = await this.exec('git log -1 --format=%H|%s|%b|%ai|%an', cwd);
    if (result.exitCode !== 0 || !result.stdout.trim()) return null;
    const [hash = '', subject = ''] = result.stdout.trim().split('|');
    return { hash, subject, body: '', isPushed: false };
  }

  async getCommitFiles(
    commitHash: string
  ): Promise<Array<{ path: string; status: string; additions: number; deletions: number }>> {
    const cwd = this.normalizeRemotePath(this.worktreePath);
    const result = await this.exec(
      `git diff-tree --no-commit-id -r --name-status ${commitHash}`,
      cwd
    );
    if (result.exitCode !== 0) throw new Error(result.stderr || 'getCommitFiles failed');
    return (result.stdout || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = l.split('\t');
        return {
          status: parts[0] || 'modified',
          path: parts[1] || '',
          additions: 0,
          deletions: 0,
        };
      });
  }

  async getCommitFileDiff(commitHash: string, filePath: string): Promise<DiffResult> {
    const cwd = this.normalizeRemotePath(this.worktreePath);
    const result = await this.exec(`git show ${commitHash} -- ${filePath}`, cwd);
    if (result.exitCode !== 0) throw new Error(result.stderr || 'getCommitFileDiff failed');
    return { lines: [], rawDiff: result.stdout } as DiffResult & { rawDiff?: string };
  }

  async getBranchStatus(): Promise<{
    branch: string;
    defaultBranch: string;
    ahead: number;
    behind: number;
  }> {
    const cwd = this.normalizeRemotePath(this.worktreePath);
    const branch = await this.getCurrentBranch();
    const defaultBranch = await this.getDefaultBranchName();

    let ahead = 0;
    let behind = 0;
    const revListResult = await this.exec(
      `git rev-list --left-right --count origin/${quoteShellArg(defaultBranch)}...HEAD 2>/dev/null`,
      cwd
    );
    if (revListResult.exitCode === 0) {
      const parts = (revListResult.stdout || '').trim().split(/\s+/);
      if (parts.length >= 2) {
        behind = parseInt(parts[0] ?? '0', 10) || 0;
        ahead = parseInt(parts[1] ?? '0', 10) || 0;
      }
    } else {
      const statusResult = await this.exec('git status -sb', cwd);
      if (statusResult.exitCode === 0) {
        const line = (statusResult.stdout || '').split('\n')[0] || '';
        const aheadMatch = line.match(/ahead\s+(\d+)/i);
        const behindMatch = line.match(/behind\s+(\d+)/i);
        if (aheadMatch) ahead = parseInt(aheadMatch[1] ?? '0', 10) || 0;
        if (behindMatch) behind = parseInt(behindMatch[1] ?? '0', 10) || 0;
      }
    }

    return { branch, defaultBranch, ahead, behind };
  }

  async renameBranch(
    repoPath: string,
    oldBranch: string,
    newBranch: string
  ): Promise<{ remotePushed: boolean }> {
    const cwd = this.normalizeRemotePath(repoPath);

    let remotePushed = false;
    let remoteName = 'origin';
    const configResult = await this.exec(
      `git config --get branch.${quoteShellArg(oldBranch)}.remote 2>/dev/null`,
      cwd
    );
    if (configResult.exitCode === 0 && configResult.stdout.trim()) {
      remoteName = configResult.stdout.trim();
      remotePushed = true;
    } else {
      const lsResult = await this.exec(
        `git ls-remote --heads origin ${quoteShellArg(oldBranch)} 2>/dev/null`,
        cwd
      );
      if (lsResult.exitCode === 0 && lsResult.stdout.trim()) {
        remotePushed = true;
      }
    }

    const renameResult = await this.exec(
      `git branch -m ${quoteShellArg(oldBranch)} ${quoteShellArg(newBranch)}`,
      cwd
    );
    if (renameResult.exitCode !== 0) {
      throw new Error(`Failed to rename branch: ${renameResult.stderr}`);
    }

    if (remotePushed) {
      await this.exec(
        `git push ${quoteShellArg(remoteName)} --delete ${quoteShellArg(oldBranch)} 2>/dev/null`,
        cwd
      );
      const pushResult = await this.exec(
        `git push -u ${quoteShellArg(remoteName)} ${quoteShellArg(newBranch)}`,
        cwd
      );
      if (pushResult.exitCode !== 0) {
        throw new Error(`Failed to push renamed branch: ${pushResult.stderr}`);
      }
    }

    return { remotePushed };
  }

  async detectInfo(): Promise<GitInfo> {
    const cwd = this.normalizeRemotePath(this.worktreePath);
    // Check if it's a git repo at all
    const checkResult = await this.exec('git rev-parse --is-inside-work-tree 2>/dev/null', cwd);
    if (checkResult.exitCode !== 0) {
      return { isGitRepo: false, baseRef: 'main', rootPath: cwd };
    }
    let remote: string | undefined;
    const remoteResult = await this.exec('git remote get-url origin 2>/dev/null', cwd);
    if (remoteResult.exitCode === 0) remote = remoteResult.stdout.trim() || undefined;
    let branch: string | undefined;
    const branchResult = await this.exec('git branch --show-current', cwd);
    if (branchResult.exitCode === 0) branch = branchResult.stdout.trim() || undefined;
    if (!branch) {
      // same three-step fallback as getDefaultBranchName() already uses
      branch = await this.getDefaultBranchName();
    }

    let rootPath = cwd;
    const toplevelResult = await this.exec('git rev-parse --show-toplevel', cwd);
    if (toplevelResult.exitCode === 0 && toplevelResult.stdout.trim()) {
      rootPath = toplevelResult.stdout.trim();
    }
    return {
      isGitRepo: true,
      remote,
      branch,
      baseRef: computeBaseRef(remote, branch),
      rootPath,
    };
  }
}
