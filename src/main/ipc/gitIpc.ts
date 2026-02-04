import { ipcMain } from 'electron';
import { log } from '../lib/logger';
import { exec, execFile } from 'child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'util';
import {
  getStatus as gitGetStatus,
  getFileDiff as gitGetFileDiff,
  stageFile as gitStageFile,
  unstageFile as gitUnstageFile,
  revertFile as gitRevertFile,
} from '../services/GitService';
import { prGenerationService } from '../services/PrGenerationService';
import { databaseService } from '../services/DatabaseService';
import { getDefaultBranchCached } from '../services/defaultBranchCache';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export function registerGitIpc() {
  function resolveGitBin(): string {
    // Allow override via env
    const fromEnv = (process.env.GIT_PATH || '').trim();
    const candidates = [
      fromEnv,
      '/opt/homebrew/bin/git',
      '/usr/local/bin/git',
      '/usr/bin/git',
    ].filter(Boolean) as string[];
    for (const p of candidates) {
      try {
        if (p && fs.existsSync(p)) return p;
      } catch {}
    }
    // Last resort: try /usr/bin/env git
    return 'git';
  }
  const GIT = resolveGitBin();
  // Git: Status (moved from Codex IPC)
  ipcMain.handle('git:get-status', async (_, taskPath: string) => {
    try {
      const changes = await gitGetStatus(taskPath);
      return { success: true, changes };
    } catch (error) {
      return { success: false, error: error as string };
    }
  });

  // Git: Per-file diff (moved from Codex IPC)
  ipcMain.handle('git:get-file-diff', async (_, args: { taskPath: string; filePath: string }) => {
    try {
      const diff = await gitGetFileDiff(args.taskPath, args.filePath);
      return { success: true, diff };
    } catch (error) {
      return { success: false, error: error as string };
    }
  });

  // Git: Stage file
  ipcMain.handle('git:stage-file', async (_, args: { taskPath: string; filePath: string }) => {
    try {
      log.info('Staging file:', { taskPath: args.taskPath, filePath: args.filePath });
      await gitStageFile(args.taskPath, args.filePath);
      log.info('File staged successfully:', args.filePath);
      return { success: true };
    } catch (error) {
      log.error('Failed to stage file:', { filePath: args.filePath, error });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Git: Unstage file
  ipcMain.handle('git:unstage-file', async (_, args: { taskPath: string; filePath: string }) => {
    try {
      log.info('Unstaging file:', { taskPath: args.taskPath, filePath: args.filePath });
      await gitUnstageFile(args.taskPath, args.filePath);
      log.info('File unstaged successfully:', args.filePath);
      return { success: true };
    } catch (error) {
      log.error('Failed to unstage file:', { filePath: args.filePath, error });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Git: Revert file
  ipcMain.handle('git:revert-file', async (_, args: { taskPath: string; filePath: string }) => {
    try {
      log.info('Reverting file:', { taskPath: args.taskPath, filePath: args.filePath });
      const result = await gitRevertFile(args.taskPath, args.filePath);
      log.info('File operation completed:', { filePath: args.filePath, action: result.action });
      return { success: true, action: result.action };
    } catch (error) {
      log.error('Failed to revert file:', { filePath: args.filePath, error });
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  // Git: Generate PR title and description
  ipcMain.handle(
    'git:generate-pr-content',
    async (
      _,
      args: {
        taskPath: string;
        base?: string;
      }
    ) => {
      const { taskPath, base = 'main' } = args || ({} as { taskPath: string; base?: string });
      try {
        // Try to get the task to find which provider was used
        let providerId: string | null = null;
        try {
          const task = await databaseService.getTaskByPath(taskPath);
          if (task?.agentId) {
            providerId = task.agentId;
            log.debug('Found task provider for PR generation', { taskPath, providerId });
          }
        } catch (error) {
          log.debug('Could not lookup task provider', { error });
          // Non-fatal - continue without provider
        }

        const result = await prGenerationService.generatePrContent(taskPath, base, providerId);
        return { success: true, ...result };
      } catch (error) {
        log.error('Failed to generate PR content:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  // Git: Create Pull Request via GitHub CLI
  ipcMain.handle(
    'git:create-pr',
    async (
      _,
      args: {
        taskPath: string;
        title?: string;
        body?: string;
        base?: string;
        head?: string;
        draft?: boolean;
        web?: boolean;
        fill?: boolean;
      }
    ) => {
      const { taskPath, title, body, base, head, draft, web, fill } =
        args ||
        ({} as {
          taskPath: string;
          title?: string;
          body?: string;
          base?: string;
          head?: string;
          draft?: boolean;
          web?: boolean;
          fill?: boolean;
        });
      try {
        const outputs: string[] = [];

        // Stage and commit any pending changes
        try {
          const { stdout: statusOut } = await execAsync(
            'git status --porcelain --untracked-files=all',
            {
              cwd: taskPath,
            }
          );
          if (statusOut && statusOut.trim().length > 0) {
            const { stdout: addOut, stderr: addErr } = await execAsync('git add -A', {
              cwd: taskPath,
            });
            if (addOut?.trim()) outputs.push(addOut.trim());
            if (addErr?.trim()) outputs.push(addErr.trim());

            const commitMsg = 'stagehand: prepare pull request';
            try {
              const { stdout: commitOut, stderr: commitErr } = await execAsync(
                `git commit -m ${JSON.stringify(commitMsg)}`,
                { cwd: taskPath }
              );
              if (commitOut?.trim()) outputs.push(commitOut.trim());
              if (commitErr?.trim()) outputs.push(commitErr.trim());
            } catch (commitErr) {
              const msg = commitErr as string;
              if (msg && /nothing to commit/i.test(msg)) {
                outputs.push('git commit: nothing to commit');
              } else {
                throw commitErr;
              }
            }
          }
        } catch (stageErr) {
          log.warn('Failed to stage/commit changes before PR:', stageErr as string);
          // Continue; PR may still be created for existing commits
        }

        // Ensure branch is pushed to origin so PR includes latest commit
        try {
          await execAsync('git push', { cwd: taskPath });
          outputs.push('git push: success');
        } catch (pushErr) {
          try {
            const { stdout: branchOut } = await execAsync('git rev-parse --abbrev-ref HEAD', {
              cwd: taskPath,
            });
            const branch = branchOut.trim();
            await execAsync(`git push --set-upstream origin ${JSON.stringify(branch)}`, {
              cwd: taskPath,
            });
            outputs.push(`git push --set-upstream origin ${branch}: success`);
          } catch (pushErr2) {
            log.error('Failed to push branch before PR:', pushErr2 as string);
            return {
              success: false,
              error:
                'Failed to push branch to origin. Please check your Git remotes and authentication.',
            };
          }
        }

        // Resolve repo owner/name (prefer gh, fallback to parsing origin url)
        let repoNameWithOwner = '';
        try {
          const { stdout: repoOut } = await execAsync(
            'gh repo view --json nameWithOwner -q .nameWithOwner',
            { cwd: taskPath }
          );
          repoNameWithOwner = (repoOut || '').trim();
        } catch {
          try {
            const { stdout: urlOut } = await execAsync('git remote get-url origin', {
              cwd: taskPath,
            });
            const url = (urlOut || '').trim();
            // Handle both SSH and HTTPS forms
            const m =
              url.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i) ||
              url.match(/([^/:]+)[:/]([^/]+)\/([^/.]+)(?:\.git)?$/i);
            if (m) {
              const owner = m[1].includes('github.com') ? m[1].split('github.com').pop() : m[1];
              const repo = m[2] || m[3];
              repoNameWithOwner = `${owner}/${repo}`.replace(/^\/*/, '');
            }
          } catch {}
        }

        // Determine current branch and default base branch (fallback to main)
        let currentBranch = '';
        try {
          const { stdout } = await execAsync('git branch --show-current', { cwd: taskPath });
          currentBranch = (stdout || '').trim();
        } catch {}
        let defaultBranch = 'main';
        try {
          const { stdout } = await execAsync(
            'gh repo view --json defaultBranchRef -q .defaultBranchRef.name',
            { cwd: taskPath }
          );
          const db = (stdout || '').trim();
          if (db) defaultBranch = db;
        } catch {
          try {
            const { stdout } = await execAsync(
              'git remote show origin | sed -n "/HEAD branch/s/.*: //p"',
              { cwd: taskPath }
            );
            const db2 = (stdout || '').trim();
            if (db2) defaultBranch = db2;
          } catch {}
        }

        // Guard: ensure there is at least one commit ahead of base
        try {
          const baseRef = base || defaultBranch;
          const { stdout: aheadOut } = await execAsync(
            `git rev-list --count ${JSON.stringify(`origin/${baseRef}`)}..HEAD`,
            { cwd: taskPath }
          );
          const aheadCount = parseInt((aheadOut || '0').trim(), 10) || 0;
          if (aheadCount <= 0) {
            return {
              success: false,
              error: `No commits to create a PR. Make a commit on 
current branch '${currentBranch}' ahead of base '${baseRef}'.`,
            };
          }
        } catch {
          // Non-fatal; continue
        }

        // Build gh pr create command with explicit repo/base/head for reliability
        const flags: string[] = [];
        if (repoNameWithOwner) flags.push(`--repo ${JSON.stringify(repoNameWithOwner)}`);
        if (title) flags.push(`--title ${JSON.stringify(title)}`);

        // Use temp file for body to properly handle newlines and multiline content
        let bodyFile: string | null = null;
        if (body) {
          try {
            bodyFile = path.join(
              os.tmpdir(),
              `gh-pr-body-${Date.now()}-${Math.random().toString(36).substring(7)}.txt`
            );
            // Write body with actual newlines preserved
            fs.writeFileSync(bodyFile, body, 'utf8');
            flags.push(`--body-file ${JSON.stringify(bodyFile)}`);
          } catch (writeError) {
            log.warn('Failed to write body to temp file, falling back to --body flag', {
              writeError,
            });
            // Fallback to direct --body flag if temp file creation fails
            flags.push(`--body ${JSON.stringify(body)}`);
          }
        }

        if (base || defaultBranch) flags.push(`--base ${JSON.stringify(base || defaultBranch)}`);
        if (head) {
          flags.push(`--head ${JSON.stringify(head)}`);
        } else if (currentBranch) {
          // Prefer owner:branch form when repo is known; otherwise branch name
          const headRef = repoNameWithOwner
            ? `${repoNameWithOwner.split('/')[0]}:${currentBranch}`
            : currentBranch;
          flags.push(`--head ${JSON.stringify(headRef)}`);
        }
        if (draft) flags.push('--draft');
        if (web) flags.push('--web');
        if (fill) flags.push('--fill');

        const cmd = `gh pr create ${flags.join(' ')}`.trim();

        let stdout: string;
        let stderr: string;
        try {
          const result = await execAsync(cmd, { cwd: taskPath });
          stdout = result.stdout || '';
          stderr = result.stderr || '';
        } finally {
          // Clean up temp file if it was created
          if (bodyFile && fs.existsSync(bodyFile)) {
            try {
              fs.unlinkSync(bodyFile);
            } catch (unlinkError) {
              log.debug('Failed to delete temp body file', { bodyFile, unlinkError });
            }
          }
        }
        const out = [...outputs, (stdout || '').trim() || (stderr || '').trim()]
          .filter(Boolean)
          .join('\n');

        // Try to extract PR URL from output
        const urlMatch = out.match(/https?:\/\/\S+/);
        const url = urlMatch ? urlMatch[0] : null;

        return { success: true, url, output: out };
      } catch (error: any) {
        // Capture rich error info from gh/child_process
        const errMsg = typeof error?.message === 'string' ? error.message : String(error);
        const errStdout = typeof error?.stdout === 'string' ? error.stdout : '';
        const errStderr = typeof error?.stderr === 'string' ? error.stderr : '';
        const combined = [errMsg, errStdout, errStderr].filter(Boolean).join('\n').trim();

        // Check for various error conditions
        const restrictionRe =
          /Auth App access restrictions|authorized OAuth apps|third-parties is limited/i;
        const prExistsRe = /already exists|already has.*pull request|pull request for branch/i;

        let code: string | undefined;
        if (restrictionRe.test(combined)) {
          code = 'ORG_AUTH_APP_RESTRICTED';
          log.warn('GitHub org restrictions detected during PR creation');
        } else if (prExistsRe.test(combined)) {
          code = 'PR_ALREADY_EXISTS';
          log.info('PR already exists for branch - push was successful');
        } else {
          log.error('Failed to create PR:', combined || error);
        }

        return {
          success: false,
          error: combined || errMsg || 'Failed to create PR',
          output: combined,
          code,
        } as any;
      }
    }
  );

  // Git: Get PR status for current branch via GitHub CLI
  ipcMain.handle('git:get-pr-status', async (_, args: { taskPath: string }) => {
    const { taskPath } = args || ({} as { taskPath: string });
    try {
      // Ensure we're in a git repo
      await execAsync('git rev-parse --is-inside-work-tree', { cwd: taskPath });

      const queryFields = [
        'number',
        'url',
        'state',
        'isDraft',
        'mergeStateStatus',
        'headRefName',
        'baseRefName',
        'title',
        'author',
        'additions',
        'deletions',
        'changedFiles',
      ];
      const cmd = `gh pr view --json ${queryFields.join(',')} -q .`;
      try {
        const { stdout } = await execAsync(cmd, { cwd: taskPath });
        const json = (stdout || '').trim();
        const data = json ? JSON.parse(json) : null;
        if (!data) return { success: false, error: 'No PR data returned' };

        // Fallback: if GH CLI didn't return diff stats, try to compute locally
        const asNumber = (v: any): number | null =>
          typeof v === 'number' && Number.isFinite(v)
            ? v
            : typeof v === 'string' && Number.isFinite(Number.parseInt(v, 10))
              ? Number.parseInt(v, 10)
              : null;

        const hasAdd = asNumber(data?.additions) !== null;
        const hasDel = asNumber(data?.deletions) !== null;
        const hasFiles = asNumber(data?.changedFiles) !== null;

        if (!hasAdd || !hasDel || !hasFiles) {
          const baseRef = typeof data?.baseRefName === 'string' ? data.baseRefName.trim() : '';
          const targetRef = baseRef ? `origin/${baseRef}` : '';
          const shortstatCmd = targetRef
            ? `git diff --shortstat ${JSON.stringify(targetRef)}...HEAD`
            : 'git diff --shortstat HEAD~1..HEAD';
          try {
            const { stdout: diffOut } = await execAsync(shortstatCmd, { cwd: taskPath });
            const statLine = (diffOut || '').trim();
            const m =
              statLine &&
              statLine.match(
                /(\d+)\s+files? changed(?:,\s+(\d+)\s+insertions?\(\+\))?(?:,\s+(\d+)\s+deletions?\(-\))?/
              );
            if (m) {
              const [, filesStr, addStr, delStr] = m;
              if (!hasFiles && filesStr) data.changedFiles = Number.parseInt(filesStr, 10);
              if (!hasAdd && addStr) data.additions = Number.parseInt(addStr, 10);
              if (!hasDel && delStr) data.deletions = Number.parseInt(delStr, 10);
            }
          } catch {
            // best-effort only; ignore failures
          }
        }

        return { success: true, pr: data };
      } catch (err) {
        const msg = String(err as string);
        if (/no pull requests? found/i.test(msg) || /not found/i.test(msg)) {
          return { success: true, pr: null };
        }
        return { success: false, error: msg || 'Failed to query PR status' };
      }
    } catch (error) {
      return { success: false, error: error as string };
    }
  });

  // Git: Commit all changes and push current branch (create feature branch if on default)
  ipcMain.handle(
    'git:commit-and-push',
    async (
      _,
      args: {
        taskPath: string;
        commitMessage?: string;
        createBranchIfOnDefault?: boolean;
        branchPrefix?: string;
      }
    ) => {
      const {
        taskPath,
        commitMessage = 'chore: apply task changes',
        createBranchIfOnDefault = true,
        branchPrefix = 'orch',
      } = (args ||
        ({} as {
          taskPath: string;
          commitMessage?: string;
          createBranchIfOnDefault?: boolean;
          branchPrefix?: string;
        })) as {
        taskPath: string;
        commitMessage?: string;
        createBranchIfOnDefault?: boolean;
        branchPrefix?: string;
      };

      try {
        // Ensure we're in a git repo
        await execAsync('git rev-parse --is-inside-work-tree', { cwd: taskPath });

        // Determine current branch
        const { stdout: currentBranchOut } = await execAsync('git branch --show-current', {
          cwd: taskPath,
        });
        const currentBranch = (currentBranchOut || '').trim();

        const defaultBranch = await getDefaultBranchCached(taskPath);

        // Optionally create a new branch if on default
        let activeBranch = currentBranch;
        if (createBranchIfOnDefault && (!currentBranch || currentBranch === defaultBranch)) {
          const short = Date.now().toString(36);
          const name = `${branchPrefix}/${short}`;
          await execAsync(`git checkout -b ${JSON.stringify(name)}`, { cwd: taskPath });
          activeBranch = name;
        }

        // Stage (only if needed) and commit
        try {
          const { stdout: st } = await execAsync('git status --porcelain --untracked-files=all', {
            cwd: taskPath,
          });
          const hasWorkingChanges = Boolean(st && st.trim().length > 0);

          const readStagedFiles = async () => {
            try {
              const { stdout } = await execAsync('git diff --cached --name-only', {
                cwd: taskPath,
              });
              return (stdout || '')
                .split('\n')
                .map((f) => f.trim())
                .filter(Boolean);
            } catch {
              return [];
            }
          };

          let stagedFiles = await readStagedFiles();

          // Only auto-stage everything when nothing is staged yet (preserves manual staging choices)
          if (hasWorkingChanges && stagedFiles.length === 0) {
            await execAsync('git add -A', { cwd: taskPath });
          }

          // Never commit plan mode artifacts
          try {
            await execAsync('git reset -q .emdash || true', { cwd: taskPath });
          } catch {}
          try {
            await execAsync('git reset -q PLANNING.md || true', { cwd: taskPath });
          } catch {}
          try {
            await execAsync('git reset -q planning.md || true', { cwd: taskPath });
          } catch {}

          stagedFiles = await readStagedFiles();

          if (stagedFiles.length > 0) {
            try {
              await execAsync(`git commit -m ${JSON.stringify(commitMessage)}`, {
                cwd: taskPath,
              });
            } catch (commitErr) {
              const msg = commitErr as string;
              if (!/nothing to commit/i.test(msg)) throw commitErr;
            }
          }
        } catch (e) {
          log.warn('Stage/commit step issue:', e as string);
        }

        // Push current branch (set upstream if needed)
        try {
          await execAsync('git push', { cwd: taskPath });
        } catch (pushErr) {
          await execAsync(`git push --set-upstream origin ${JSON.stringify(activeBranch)}`, {
            cwd: taskPath,
          });
        }

        const { stdout: out } = await execAsync('git status -sb', { cwd: taskPath });
        return { success: true, branch: activeBranch, output: (out || '').trim() };
      } catch (error) {
        log.error('Failed to commit and push:', error);
        return { success: false, error: error as string };
      }
    }
  );

  // Git: Get branch status (current branch, default branch, ahead/behind counts)
  ipcMain.handle('git:get-branch-status', async (_, args: { taskPath: string }) => {
    const { taskPath } = args || ({} as { taskPath: string });

    // Early exit for missing/invalid path
    if (!taskPath || !fs.existsSync(taskPath)) {
      log.warn(`getBranchStatus: path does not exist: ${taskPath}`);
      return { success: false, error: 'Path does not exist' };
    }

    // Check if it's a git repo - expected to fail often for non-git paths
    try {
      await execFileAsync(GIT, ['rev-parse', '--is-inside-work-tree'], { cwd: taskPath });
    } catch {
      log.warn(`getBranchStatus: not a git repository: ${taskPath}`);
      return { success: false, error: 'Not a git repository' };
    }

    try {
      // Current branch
      const { stdout: currentBranchOut } = await execFileAsync(GIT, ['branch', '--show-current'], {
        cwd: taskPath,
      });
      const branch = (currentBranchOut || '').trim();

      // Determine default branch
      let defaultBranch = 'main';
      try {
        const { stdout } = await execFileAsync(
          'gh',
          ['repo', 'view', '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'],
          { cwd: taskPath }
        );
        const db = (stdout || '').trim();
        if (db) defaultBranch = db;
      } catch {
        try {
          // Use symbolic-ref to resolve origin/HEAD then take the last path part
          const { stdout } = await execFileAsync(
            GIT,
            ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
            { cwd: taskPath }
          );
          const line = (stdout || '').trim();
          const last = line.split('/').pop();
          if (last) defaultBranch = last;
        } catch {}
      }

      // Ahead/behind relative to upstream or origin/<default>
      let ahead = 0;
      let behind = 0;
      try {
        // Try explicit compare with origin/default...HEAD
        const { stdout } = await execFileAsync(
          GIT,
          ['rev-list', '--left-right', '--count', `origin/${defaultBranch}...HEAD`],
          { cwd: taskPath }
        );
        const parts = (stdout || '').trim().split(/\s+/);
        if (parts.length >= 2) {
          behind = parseInt(parts[0] || '0', 10) || 0; // commits on left (origin/default)
          ahead = parseInt(parts[1] || '0', 10) || 0; // commits on right (HEAD)
        }
      } catch {
        try {
          const { stdout } = await execFileAsync(GIT, ['status', '-sb'], { cwd: taskPath });
          const line = (stdout || '').split(/\n/)[0] || '';
          const m = line.match(/ahead\s+(\d+)/i);
          const n = line.match(/behind\s+(\d+)/i);
          if (m) ahead = parseInt(m[1] || '0', 10) || 0;
          if (n) behind = parseInt(n[1] || '0', 10) || 0;
        } catch {}
      }

      return { success: true, branch, defaultBranch, ahead, behind };
    } catch (error) {
      log.error(`getBranchStatus: unexpected error for ${taskPath}:`, error);
      return { success: false, error: error as string };
    }
  });

  ipcMain.handle(
    'git:list-remote-branches',
    async (_, args: { projectPath: string; remote?: string }) => {
      const { projectPath, remote = 'origin' } = args || ({} as { projectPath: string });
      if (!projectPath) {
        return { success: false, error: 'projectPath is required' };
      }
      try {
        await execAsync('git rev-parse --is-inside-work-tree', { cwd: projectPath });
      } catch {
        return { success: false, error: 'Not a git repository' };
      }

      try {
        // Check if remote exists before attempting to fetch
        let hasRemote = false;
        try {
          await execAsync(`git remote get-url ${remote}`, { cwd: projectPath });
          hasRemote = true;
          // Remote exists, try to fetch
          try {
            await execAsync(`git fetch --prune ${remote}`, { cwd: projectPath });
          } catch (fetchError) {
            log.warn('Failed to fetch remote before listing branches', fetchError);
          }
        } catch {
          // Remote doesn't exist, skip fetch and will use local branches instead
          log.debug(`Remote '${remote}' not found, will use local branches`);
        }

        let branches: Array<{ ref: string; remote: string; branch: string; label: string }> = [];

        if (hasRemote) {
          // List remote branches
          const { stdout } = await execAsync(
            `git for-each-ref --format="%(refname:short)" refs/remotes/${remote}`,
            { cwd: projectPath }
          );

          branches =
            stdout
              ?.split('\n')
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
              .filter((line) => !line.endsWith('/HEAD'))
              .map((ref) => {
                const [remoteAlias, ...rest] = ref.split('/');
                const branch = rest.join('/') || ref;
                return {
                  ref,
                  remote: remoteAlias || remote,
                  branch,
                  label: `${remoteAlias || remote}/${branch}`,
                };
              }) ?? [];
        } else {
          // No remote - list local branches instead
          try {
            const { stdout } = await execAsync(
              'git for-each-ref --format="%(refname:short)" refs/heads/',
              { cwd: projectPath }
            );

            branches =
              stdout
                ?.split('\n')
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .map((branch) => ({
                  ref: branch,
                  remote: '', // No remote
                  branch,
                  label: branch, // Just the branch name, no remote prefix
                })) ?? [];
          } catch (localBranchError) {
            log.warn('Failed to list local branches', localBranchError);
          }
        }

        return { success: true, branches };
      } catch (error) {
        log.error('Failed to list branches:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  // Git: Rename branch (local and optionally remote)
  ipcMain.handle(
    'git:rename-branch',
    async (
      _,
      args: {
        repoPath: string;
        oldBranch: string;
        newBranch: string;
      }
    ) => {
      const { repoPath, oldBranch, newBranch } = args;
      try {
        log.info('Renaming branch:', { repoPath, oldBranch, newBranch });

        // Check remote tracking BEFORE rename (git branch -m renames config section)
        let remotePushed = false;
        let remoteName = 'origin';
        try {
          const { stdout: remoteOut } = await execFileAsync(
            GIT,
            ['config', '--get', `branch.${oldBranch}.remote`],
            { cwd: repoPath }
          );
          if (remoteOut?.trim()) {
            remoteName = remoteOut.trim();
            remotePushed = true;
          }
        } catch {
          // Branch wasn't tracking a remote, check if it exists on origin
          try {
            const { stdout: lsRemote } = await execFileAsync(
              GIT,
              ['ls-remote', '--heads', 'origin', oldBranch],
              { cwd: repoPath }
            );
            if (lsRemote?.trim()) {
              remotePushed = true;
            }
          } catch {
            // No remote branch
          }
        }

        // Rename local branch
        await execFileAsync(GIT, ['branch', '-m', oldBranch, newBranch], { cwd: repoPath });
        log.info('Local branch renamed successfully');

        // If pushed to remote, delete old and push new
        if (remotePushed) {
          log.info('Branch was pushed to remote, updating remote...');
          try {
            // Delete old remote branch
            await execFileAsync(GIT, ['push', remoteName, '--delete', oldBranch], {
              cwd: repoPath,
            });
            log.info('Deleted old remote branch');
          } catch (deleteErr) {
            // Remote branch might not exist or already deleted
            log.warn('Could not delete old remote branch (may not exist):', deleteErr);
          }

          // Push new branch and set upstream
          await execFileAsync(GIT, ['push', '-u', remoteName, newBranch], { cwd: repoPath });
          log.info('Pushed new branch to remote');
        }

        return { success: true, remotePushed };
      } catch (error) {
        log.error('Failed to rename branch:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
}
