import { SshService } from './ssh/SshService';
import type { ExecResult } from '../../shared/ssh/types';
import { quoteShellArg } from '../utils/shellEscape';
import type { GitChange } from './GitService';

export interface WorktreeInfo {
  path: string;
  branch: string;
  isMain: boolean;
}

export interface GitStatusFile {
  status: string;
  path: string;
}

export interface GitStatus {
  branch: string;
  isClean: boolean;
  files: GitStatusFile[];
}

export class RemoteGitService {
  constructor(private sshService: SshService) {}

  private normalizeRemotePath(p: string): string {
    // Remote paths should use forward slashes.
    return p.replace(/\\/g, '/').replace(/\/+$/g, '');
  }

  async getStatus(connectionId: string, worktreePath: string): Promise<GitStatus> {
    const result = await this.sshService.executeCommand(
      connectionId,
      'git status --porcelain -b',
      worktreePath
    );

    if (result.exitCode !== 0) {
      throw new Error(`Git status failed: ${result.stderr}`);
    }

    const lines = result.stdout.split('\n');
    const branchLine = lines[0];
    const files = lines.slice(1).filter((l) => l.trim());

    const branchMatch = branchLine.match(/^## (.+?)(?:\...|$)/);
    const branch = branchMatch ? branchMatch[1] : 'unknown';

    return {
      branch,
      isClean: files.length === 0,
      files: files.map((line) => ({
        status: line.substring(0, 2).trim(),
        path: line.substring(3),
      })),
    };
  }

  async getDefaultBranch(connectionId: string, projectPath: string): Promise<string> {
    const normalizedProjectPath = this.normalizeRemotePath(projectPath);

    // Try to get the current branch
    const currentBranchResult = await this.sshService.executeCommand(
      connectionId,
      'git rev-parse --abbrev-ref HEAD',
      normalizedProjectPath
    );

    if (
      currentBranchResult.exitCode === 0 &&
      currentBranchResult.stdout.trim() &&
      currentBranchResult.stdout.trim() !== 'HEAD'
    ) {
      return currentBranchResult.stdout.trim();
    }

    // Fallback: check common default branch names
    const commonBranches = ['main', 'master', 'develop', 'trunk'];
    for (const branch of commonBranches) {
      const checkResult = await this.sshService.executeCommand(
        connectionId,
        `git rev-parse --verify ${quoteShellArg(branch)} 2>/dev/null`,
        normalizedProjectPath
      );
      if (checkResult.exitCode === 0) {
        return branch;
      }
    }

    return 'HEAD';
  }

  async createWorktree(
    connectionId: string,
    projectPath: string,
    taskName: string,
    baseRef?: string
  ): Promise<WorktreeInfo> {
    const normalizedProjectPath = this.normalizeRemotePath(projectPath);
    const slug = taskName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const worktreeName = `${slug || 'task'}-${Date.now()}`;
    const relWorktreePath = `.emdash/worktrees/${worktreeName}`;
    const worktreePath = `${normalizedProjectPath}/${relWorktreePath}`.replace(/\/+/g, '/');

    // Create worktrees directory (relative so we avoid quoting issues)
    await this.sshService.executeCommand(
      connectionId,
      'mkdir -p .emdash/worktrees',
      normalizedProjectPath
    );

    // Auto-detect default branch if baseRef is not provided or is invalid
    let base = (baseRef || '').trim();

    // If no base provided, use auto-detection
    if (!base) {
      base = await this.getDefaultBranch(connectionId, normalizedProjectPath);
    } else {
      // Always verify the provided branch exists, regardless of what it is
      const verifyResult = await this.sshService.executeCommand(
        connectionId,
        `git rev-parse --verify ${quoteShellArg(base)} 2>/dev/null`,
        normalizedProjectPath
      );

      if (verifyResult.exitCode !== 0) {
        // Branch doesn't exist, auto-detect the actual default branch
        base = await this.getDefaultBranch(connectionId, normalizedProjectPath);
      }
    }

    if (!base) {
      base = 'HEAD';
    }

    const result = await this.sshService.executeCommand(
      connectionId,
      `git worktree add ${quoteShellArg(relWorktreePath)} -b ${quoteShellArg(worktreeName)} ${quoteShellArg(
        base
      )}`,
      normalizedProjectPath
    );

    if (result.exitCode !== 0) {
      throw new Error(`Failed to create worktree: ${result.stderr}`);
    }

    return {
      path: worktreePath,
      branch: worktreeName,
      isMain: false,
    };
  }

  async removeWorktree(
    connectionId: string,
    projectPath: string,
    worktreePath: string
  ): Promise<void> {
    const normalizedProjectPath = this.normalizeRemotePath(projectPath);
    const normalizedWorktreePath = this.normalizeRemotePath(worktreePath);
    const result = await this.sshService.executeCommand(
      connectionId,
      `git worktree remove ${quoteShellArg(normalizedWorktreePath)} --force`,
      normalizedProjectPath
    );

    if (result.exitCode !== 0) {
      throw new Error(`Failed to remove worktree: ${result.stderr}`);
    }
  }

  async listWorktrees(connectionId: string, projectPath: string): Promise<WorktreeInfo[]> {
    const normalizedProjectPath = this.normalizeRemotePath(projectPath);
    const result = await this.sshService.executeCommand(
      connectionId,
      'git worktree list --porcelain',
      normalizedProjectPath
    );

    if (result.exitCode !== 0) {
      throw new Error(`Failed to list worktrees: ${result.stderr}`);
    }

    // Porcelain output is blocks separated by blank lines.
    // Each block begins with: worktree <path>
    // Optional: branch <ref>
    // Optional: detached
    const blocks = result.stdout
      .split(/\n\s*\n/g)
      .map((b) => b.trim())
      .filter(Boolean);

    const out: WorktreeInfo[] = [];
    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim());
      const wtLine = lines.find((l) => l.startsWith('worktree '));
      if (!wtLine) continue;
      const wtPath = wtLine.slice('worktree '.length).trim();
      const branchLine = lines.find((l) => l.startsWith('branch '));
      const branchRef = branchLine ? branchLine.slice('branch '.length).trim() : '';
      const branch = branchRef.replace(/^refs\/heads\//, '') || 'HEAD';
      const isMain = this.normalizeRemotePath(wtPath) === normalizedProjectPath;
      out.push({ path: wtPath, branch, isMain });
    }
    return out;
  }

  async getWorktreeStatus(
    connectionId: string,
    worktreePath: string
  ): Promise<{
    hasChanges: boolean;
    stagedFiles: string[];
    unstagedFiles: string[];
    untrackedFiles: string[];
  }> {
    const normalizedWorktreePath = this.normalizeRemotePath(worktreePath);
    const result = await this.sshService.executeCommand(
      connectionId,
      'git status --porcelain --untracked-files=all',
      normalizedWorktreePath
    );

    if (result.exitCode !== 0) {
      throw new Error(`Git status failed: ${result.stderr}`);
    }

    const stagedFiles: string[] = [];
    const unstagedFiles: string[] = [];
    const untrackedFiles: string[] = [];
    const lines = (result.stdout || '')
      .trim()
      .split('\n')
      .filter((l) => l.length > 0);

    for (const line of lines) {
      const status = line.substring(0, 2);
      const file = line.substring(3);
      if (status.includes('A') || status.includes('M') || status.includes('D')) {
        stagedFiles.push(file);
      }
      if (status[1] === 'M' || status[1] === 'D') {
        unstagedFiles.push(file);
      }
      if (status.includes('??')) {
        untrackedFiles.push(file);
      }
    }

    return {
      hasChanges: stagedFiles.length > 0 || unstagedFiles.length > 0 || untrackedFiles.length > 0,
      stagedFiles,
      unstagedFiles,
      untrackedFiles,
    };
  }

  async getBranchList(connectionId: string, projectPath: string): Promise<string[]> {
    const result = await this.sshService.executeCommand(
      connectionId,
      'git branch -a --format="%(refname:short)"',
      this.normalizeRemotePath(projectPath)
    );

    if (result.exitCode !== 0) {
      return [];
    }

    return result.stdout.split('\n').filter((b) => b.trim());
  }

  async commit(
    connectionId: string,
    worktreePath: string,
    message: string,
    files?: string[]
  ): Promise<ExecResult> {
    let command = 'git commit';

    if (files && files.length > 0) {
      const fileList = files.map((f) => quoteShellArg(f)).join(' ');
      command = `git add ${fileList} && ${command}`;
    }

    command += ` -m ${quoteShellArg(message)}`;

    return this.sshService.executeCommand(
      connectionId,
      command,
      this.normalizeRemotePath(worktreePath)
    );
  }

  // ---------------------------------------------------------------------------
  // Git operations for IPC parity with local GitService
  // ---------------------------------------------------------------------------

  /**
   * Detailed git status matching the shape returned by local GitService.getStatus().
   * Parses porcelain output, numstat diffs, and untracked file line counts.
   */
  async getStatusDetailed(connectionId: string, worktreePath: string): Promise<GitChange[]> {
    const cwd = this.normalizeRemotePath(worktreePath);

    // Verify git repo
    const verifyResult = await this.sshService.executeCommand(
      connectionId,
      'git rev-parse --is-inside-work-tree',
      cwd
    );
    if (verifyResult.exitCode !== 0) {
      return [];
    }

    // Get porcelain status
    const statusResult = await this.sshService.executeCommand(
      connectionId,
      'git status --porcelain --untracked-files=all',
      cwd
    );
    if (statusResult.exitCode !== 0) {
      throw new Error(`Git status failed: ${statusResult.stderr}`);
    }

    const statusOutput = statusResult.stdout;
    if (!statusOutput.trim()) return [];

    const statusLines = statusOutput
      .split('\n')
      .map((l) => l.replace(/\r$/, ''))
      .filter((l) => l.length > 0);

    // Batch-fetch numstat for staged and unstaged changes (one SSH call each, not per-file)
    const [stagedNumstat, unstagedNumstat] = await Promise.all([
      this.sshService.executeCommand(connectionId, 'git diff --numstat --cached', cwd),
      this.sshService.executeCommand(connectionId, 'git diff --numstat', cwd),
    ]);

    const parseNumstat = (stdout: string): Map<string, { add: number; del: number }> => {
      const map = new Map<string, { add: number; del: number }>();
      for (const line of stdout.split('\n').filter((l) => l.trim())) {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          const add = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
          const del = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
          map.set(parts[2], { add, del });
        }
      }
      return map;
    };

    const stagedStats = parseNumstat(stagedNumstat.stdout || '');
    const unstagedStats = parseNumstat(unstagedNumstat.stdout || '');

    // Collect untracked file paths so we can batch their line counts
    const untrackedPaths: string[] = [];

    const changes: GitChange[] = [];
    for (const line of statusLines) {
      const statusCode = line.substring(0, 2);
      let filePath = line.substring(3);
      if (statusCode.includes('R') && filePath.includes('->')) {
        const parts = filePath.split('->');
        filePath = parts[parts.length - 1].trim();
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

    // Batch line-count for untracked files (skip files > 512KB)
    if (untrackedPaths.length > 0) {
      const escaped = untrackedPaths.map((f) => quoteShellArg(f)).join(' ');
      // For each file: if <= 512KB, count newlines; otherwise print -1
      const script =
        `for f in ${escaped}; do ` +
        `s=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null); ` +
        `if [ "$s" -le 524288 ] 2>/dev/null; then ` +
        `wc -l < "$f" 2>/dev/null || echo -1; ` +
        `else echo -1; fi; done`;
      const countResult = await this.sshService.executeCommand(connectionId, script, cwd);
      if (countResult.exitCode === 0) {
        const counts = countResult.stdout
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0);
        for (let i = 0; i < untrackedPaths.length && i < counts.length; i++) {
          const count = parseInt(counts[i], 10);
          if (count >= 0) {
            const change = changes.find((c) => c.path === untrackedPaths[i]);
            if (change) change.additions = count;
          }
        }
      }
    }

    return changes;
  }

  /**
   * Per-file diff matching the shape returned by local GitService.getFileDiff().
   */
  async getFileDiff(
    connectionId: string,
    worktreePath: string,
    filePath: string
  ): Promise<{ lines: Array<{ left?: string; right?: string; type: 'context' | 'add' | 'del' }> }> {
    const cwd = this.normalizeRemotePath(worktreePath);

    const parseDiffOutput = (
      stdout: string
    ): Array<{ left?: string; right?: string; type: 'context' | 'add' | 'del' }> => {
      const result: Array<{ left?: string; right?: string; type: 'context' | 'add' | 'del' }> = [];
      for (const line of stdout.split('\n')) {
        if (!line) continue;
        if (
          line.startsWith('diff ') ||
          line.startsWith('index ') ||
          line.startsWith('--- ') ||
          line.startsWith('+++ ') ||
          line.startsWith('@@')
        )
          continue;
        const prefix = line[0];
        const content = line.slice(1);
        if (prefix === ' ') result.push({ left: content, right: content, type: 'context' });
        else if (prefix === '-') result.push({ left: content, type: 'del' });
        else if (prefix === '+') result.push({ right: content, type: 'add' });
        else result.push({ left: line, right: line, type: 'context' });
      }
      return result;
    };

    // Try git diff HEAD
    const diffResult = await this.sshService.executeCommand(
      connectionId,
      `git diff --no-color --unified=2000 HEAD -- ${quoteShellArg(filePath)}`,
      cwd
    );

    if (diffResult.exitCode === 0 && diffResult.stdout.trim()) {
      const lines = parseDiffOutput(diffResult.stdout);
      if (lines.length > 0) return { lines };
    }

    // Fallback: untracked file (read content as "add" lines)
    const catResult = await this.sshService.executeCommand(
      connectionId,
      // Only read files <= 512KB
      `s=$(stat -c%s ${quoteShellArg(filePath)} 2>/dev/null || stat -f%z ${quoteShellArg(filePath)} 2>/dev/null); ` +
        `if [ "$s" -le 524288 ] 2>/dev/null; then cat ${quoteShellArg(filePath)}; else echo "__EMDASH_TOO_LARGE__"; fi`,
      cwd
    );
    if (
      catResult.exitCode === 0 &&
      catResult.stdout.trim() &&
      catResult.stdout.trim() !== '__EMDASH_TOO_LARGE__'
    ) {
      return {
        lines: catResult.stdout.split('\n').map((l) => ({ right: l, type: 'add' as const })),
      };
    }

    // Fallback: deleted file (show HEAD content as "del" lines)
    const showResult = await this.sshService.executeCommand(
      connectionId,
      `git show HEAD:${quoteShellArg(filePath)}`,
      cwd
    );
    if (showResult.exitCode === 0 && showResult.stdout) {
      return {
        lines: showResult.stdout.split('\n').map((l) => ({ left: l, type: 'del' as const })),
      };
    }

    return { lines: [] };
  }

  async stageFile(connectionId: string, worktreePath: string, filePath: string): Promise<void> {
    const cwd = this.normalizeRemotePath(worktreePath);
    const result = await this.sshService.executeCommand(
      connectionId,
      `git add -- ${quoteShellArg(filePath)}`,
      cwd
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to stage file: ${result.stderr}`);
    }
  }

  async stageAllFiles(connectionId: string, worktreePath: string): Promise<void> {
    const cwd = this.normalizeRemotePath(worktreePath);
    const result = await this.sshService.executeCommand(connectionId, 'git add -A', cwd);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to stage all files: ${result.stderr}`);
    }
  }

  async unstageFile(connectionId: string, worktreePath: string, filePath: string): Promise<void> {
    const cwd = this.normalizeRemotePath(worktreePath);
    const result = await this.sshService.executeCommand(
      connectionId,
      `git reset HEAD -- ${quoteShellArg(filePath)}`,
      cwd
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to unstage file: ${result.stderr}`);
    }
  }

  async revertFile(
    connectionId: string,
    worktreePath: string,
    filePath: string
  ): Promise<{ action: 'reverted' }> {
    const cwd = this.normalizeRemotePath(worktreePath);

    // Check if file exists in HEAD
    const catFileResult = await this.sshService.executeCommand(
      connectionId,
      `git cat-file -e HEAD:${quoteShellArg(filePath)}`,
      cwd
    );

    if (catFileResult.exitCode !== 0) {
      // File doesn't exist in HEAD — it's untracked. Delete it.
      await this.sshService.executeCommand(
        connectionId,
        `rm -f -- ${quoteShellArg(filePath)}`,
        cwd
      );
      return { action: 'reverted' };
    }

    // File exists in HEAD — revert it
    const checkoutResult = await this.sshService.executeCommand(
      connectionId,
      `git checkout HEAD -- ${quoteShellArg(filePath)}`,
      cwd
    );
    if (checkoutResult.exitCode !== 0) {
      throw new Error(`Failed to revert file: ${checkoutResult.stderr}`);
    }
    return { action: 'reverted' };
  }

  // ---------------------------------------------------------------------------
  // Commit, push, and branch operations
  // ---------------------------------------------------------------------------

  async getCurrentBranch(connectionId: string, worktreePath: string): Promise<string> {
    const cwd = this.normalizeRemotePath(worktreePath);
    const result = await this.sshService.executeCommand(
      connectionId,
      'git branch --show-current',
      cwd
    );
    return (result.stdout || '').trim();
  }

  /**
   * Detect the default branch name using the remote HEAD or common conventions.
   * Unlike getDefaultBranch(), this specifically queries origin's default (not current branch).
   */
  async getDefaultBranchName(connectionId: string, worktreePath: string): Promise<string> {
    const cwd = this.normalizeRemotePath(worktreePath);

    // Try gh CLI first
    const ghResult = await this.sshService.executeCommand(
      connectionId,
      'gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null',
      cwd
    );
    if (ghResult.exitCode === 0 && ghResult.stdout.trim()) {
      return ghResult.stdout.trim();
    }

    // Fallback: parse git remote show origin
    const remoteResult = await this.sshService.executeCommand(
      connectionId,
      'git remote show origin 2>/dev/null | sed -n "/HEAD branch/s/.*: //p"',
      cwd
    );
    if (remoteResult.exitCode === 0 && remoteResult.stdout.trim()) {
      return remoteResult.stdout.trim();
    }

    // Fallback: symbolic-ref
    const symrefResult = await this.sshService.executeCommand(
      connectionId,
      'git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null',
      cwd
    );
    if (symrefResult.exitCode === 0 && symrefResult.stdout.trim()) {
      const parts = symrefResult.stdout.trim().split('/');
      return parts[parts.length - 1];
    }

    return 'main';
  }

  async createBranch(connectionId: string, worktreePath: string, name: string): Promise<void> {
    const cwd = this.normalizeRemotePath(worktreePath);
    const result = await this.sshService.executeCommand(
      connectionId,
      `git checkout -b ${quoteShellArg(name)}`,
      cwd
    );
    if (result.exitCode !== 0) {
      throw new Error(`Failed to create branch: ${result.stderr}`);
    }
  }

  async push(
    connectionId: string,
    worktreePath: string,
    branch?: string,
    setUpstream?: boolean
  ): Promise<ExecResult> {
    const cwd = this.normalizeRemotePath(worktreePath);
    let cmd = 'git push';
    if (setUpstream && branch) {
      cmd = `git push --set-upstream origin ${quoteShellArg(branch)}`;
    }
    return this.sshService.executeCommand(connectionId, cmd, cwd);
  }

  async getBranchStatus(
    connectionId: string,
    worktreePath: string
  ): Promise<{ branch: string; defaultBranch: string; ahead: number; behind: number }> {
    const cwd = this.normalizeRemotePath(worktreePath);

    const branch = await this.getCurrentBranch(connectionId, worktreePath);
    const defaultBranch = await this.getDefaultBranchName(connectionId, worktreePath);

    let ahead = 0;
    let behind = 0;
    const revListResult = await this.sshService.executeCommand(
      connectionId,
      `git rev-list --left-right --count origin/${quoteShellArg(defaultBranch)}...HEAD 2>/dev/null`,
      cwd
    );
    if (revListResult.exitCode === 0) {
      const parts = (revListResult.stdout || '').trim().split(/\s+/);
      if (parts.length >= 2) {
        behind = parseInt(parts[0] || '0', 10) || 0;
        ahead = parseInt(parts[1] || '0', 10) || 0;
      }
    } else {
      // Fallback: parse git status -sb
      const statusResult = await this.sshService.executeCommand(
        connectionId,
        'git status -sb',
        cwd
      );
      if (statusResult.exitCode === 0) {
        const line = (statusResult.stdout || '').split('\n')[0] || '';
        const aheadMatch = line.match(/ahead\s+(\d+)/i);
        const behindMatch = line.match(/behind\s+(\d+)/i);
        if (aheadMatch) ahead = parseInt(aheadMatch[1], 10) || 0;
        if (behindMatch) behind = parseInt(behindMatch[1], 10) || 0;
      }
    }

    return { branch, defaultBranch, ahead, behind };
  }

  async listBranches(
    connectionId: string,
    projectPath: string,
    remote = 'origin'
  ): Promise<Array<{ ref: string; remote: string; branch: string; label: string }>> {
    const cwd = this.normalizeRemotePath(projectPath);

    // Check if remote exists
    let hasRemote = false;
    const remoteCheck = await this.sshService.executeCommand(
      connectionId,
      `git remote get-url ${quoteShellArg(remote)} 2>/dev/null`,
      cwd
    );
    if (remoteCheck.exitCode === 0) {
      hasRemote = true;
      // Try to fetch (non-fatal)
      await this.sshService.executeCommand(
        connectionId,
        `git fetch --prune ${quoteShellArg(remote)} 2>/dev/null`,
        cwd
      );
    }

    let branches: Array<{ ref: string; remote: string; branch: string; label: string }> = [];

    if (hasRemote) {
      const { stdout } = await this.sshService.executeCommand(
        connectionId,
        `git for-each-ref --format="%(refname:short)" refs/remotes/${quoteShellArg(remote)}`,
        cwd
      );
      branches = (stdout || '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.endsWith('/HEAD'))
        .map((ref) => {
          const [remoteAlias, ...rest] = ref.split('/');
          const branch = rest.join('/') || ref;
          return {
            ref,
            remote: remoteAlias || remote,
            branch,
            label: `${remoteAlias || remote}/${branch}`,
          };
        });

      // Include local-only branches
      const localResult = await this.sshService.executeCommand(
        connectionId,
        'git for-each-ref --format="%(refname:short)" refs/heads/',
        cwd
      );
      const remoteBranchNames = new Set(branches.map((b) => b.branch));
      const localOnly = (localResult.stdout || '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !remoteBranchNames.has(l))
        .map((branch) => ({ ref: branch, remote: '', branch, label: branch }));
      branches = [...branches, ...localOnly];
    } else {
      const localResult = await this.sshService.executeCommand(
        connectionId,
        'git for-each-ref --format="%(refname:short)" refs/heads/',
        cwd
      );
      branches = (localResult.stdout || '')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((branch) => ({ ref: branch, remote: '', branch, label: branch }));
    }

    return branches;
  }

  async renameBranch(
    connectionId: string,
    repoPath: string,
    oldBranch: string,
    newBranch: string
  ): Promise<{ remotePushed: boolean }> {
    const cwd = this.normalizeRemotePath(repoPath);

    // Check remote tracking before rename
    let remotePushed = false;
    let remoteName = 'origin';
    const configResult = await this.sshService.executeCommand(
      connectionId,
      `git config --get branch.${quoteShellArg(oldBranch)}.remote 2>/dev/null`,
      cwd
    );
    if (configResult.exitCode === 0 && configResult.stdout.trim()) {
      remoteName = configResult.stdout.trim();
      remotePushed = true;
    } else {
      const lsResult = await this.sshService.executeCommand(
        connectionId,
        `git ls-remote --heads origin ${quoteShellArg(oldBranch)} 2>/dev/null`,
        cwd
      );
      if (lsResult.exitCode === 0 && lsResult.stdout.trim()) {
        remotePushed = true;
      }
    }

    // Rename local branch
    const renameResult = await this.sshService.executeCommand(
      connectionId,
      `git branch -m ${quoteShellArg(oldBranch)} ${quoteShellArg(newBranch)}`,
      cwd
    );
    if (renameResult.exitCode !== 0) {
      throw new Error(`Failed to rename branch: ${renameResult.stderr}`);
    }

    // Update remote if needed
    if (remotePushed) {
      // Delete old remote branch (non-fatal)
      await this.sshService.executeCommand(
        connectionId,
        `git push ${quoteShellArg(remoteName)} --delete ${quoteShellArg(oldBranch)} 2>/dev/null`,
        cwd
      );
      // Push new branch
      const pushResult = await this.sshService.executeCommand(
        connectionId,
        `git push -u ${quoteShellArg(remoteName)} ${quoteShellArg(newBranch)}`,
        cwd
      );
      if (pushResult.exitCode !== 0) {
        throw new Error(`Failed to push renamed branch: ${pushResult.stderr}`);
      }
    }

    return { remotePushed };
  }

  // ---------------------------------------------------------------------------
  // GitHub CLI operations (run gh commands over SSH)
  // ---------------------------------------------------------------------------

  async execGh(connectionId: string, worktreePath: string, ghArgs: string): Promise<ExecResult> {
    const cwd = this.normalizeRemotePath(worktreePath);
    return this.sshService.executeCommand(connectionId, `gh ${ghArgs}`, cwd);
  }

  async execGit(connectionId: string, worktreePath: string, gitArgs: string): Promise<ExecResult> {
    const cwd = this.normalizeRemotePath(worktreePath);
    return this.sshService.executeCommand(connectionId, `git ${gitArgs}`, cwd);
  }
}
