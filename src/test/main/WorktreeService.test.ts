import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'util';

type ExecFileCall = { file: string; args: string[] };
const execFileCalls: ExecFileCall[] = [];

let ghRepoViewError: any | null = null;
let ghApiDeleteError: any | null = null;
let gitPushDeleteError: any | null = null;
let defaultBranch = 'main';
let originUrl = 'git@github.com:test-owner/test-repo.git';

vi.mock('child_process', () => {
  const execFileImpl = (file: string, args?: any, options?: any, callback?: any) => {
    const cb = typeof options === 'function' ? options : callback;
    const argv = Array.isArray(args) ? args : [];
    execFileCalls.push({ file, args: [...argv] });

    const respond = (stdout: string, stderr = '') => {
      setImmediate(() => cb?.(null, stdout, stderr));
    };

    const respondError = (err: any, stderr = '') => {
      const e = err instanceof Error ? err : new Error(String(err || 'error'));
      (e as any).stderr = (e as any).stderr ?? stderr;
      setImmediate(() => cb?.(e, '', String((e as any).stderr || stderr || '')));
    };

    const cmdOffset =
      file === 'git' && argv[0] === '--git-dir' && argv[2] === '--work-tree' ? 4 : 0;
    const cmd = argv[cmdOffset];
    const sub = argv[cmdOffset + 1];

    if (file === 'git' && cmd === 'remote' && sub === 'show' && argv[cmdOffset + 2] === 'origin') {
      respond(`* remote origin\n  HEAD branch: ${defaultBranch}\n`);
    } else if (
      file === 'git' &&
      cmd === 'remote' &&
      sub === 'get-url' &&
      argv[cmdOffset + 2] === 'origin'
    ) {
      respond(`${originUrl}\n`);
    } else if (file === 'git' && cmd === 'push' && argv.includes('--delete')) {
      if (gitPushDeleteError) {
        respondError(gitPushDeleteError, (gitPushDeleteError as any)?.stderr);
      } else {
        respond('');
      }
    } else if (file === 'gh' && argv[0] === 'repo' && argv[1] === 'view') {
      if (ghRepoViewError) {
        respondError(ghRepoViewError);
      } else {
        respond('test-owner/test-repo\n');
      }
    } else if (file === 'gh' && argv[0] === 'api' && argv.includes('DELETE')) {
      if (ghApiDeleteError) {
        respondError(ghApiDeleteError, (ghApiDeleteError as any)?.stderr);
      } else {
        respond('');
      }
    } else {
      respond('');
    }

    return { kill: vi.fn() };
  };

  (execFileImpl as any)[promisify.custom] = (file: string, args?: any, options?: any) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      execFileImpl(file, args, options, (err: any, stdout: string, stderr: string) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({ stdout, stderr });
      });
    });
  };

  return { execFile: execFileImpl };
});

vi.mock('../../main/services/ProjectSettingsService', () => {
  return {
    projectSettingsService: {
      getBaseRef: vi.fn(),
      setBaseRef: vi.fn(),
      getSettings: vi.fn(),
      updateSettings: vi.fn(),
    },
  };
});

// eslint-disable-next-line import/first
import { WorktreeService } from '../../main/services/WorktreeService';

describe('WorktreeService.removeWorktree remote deletion', () => {
  beforeEach(() => {
    execFileCalls.length = 0;
    ghRepoViewError = null;
    ghApiDeleteError = null;
    gitPushDeleteError = null;
    defaultBranch = 'main';
    originUrl = 'git@github.com:test-owner/test-repo.git';
  });

  it('does not delete a GitHub branch unless explicitly requested', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    const worktreePath = path.join(projectPath, 'worktree-to-delete');
    fs.mkdirSync(worktreePath, { recursive: true });

    const service = new WorktreeService();
    await service.removeWorktree(projectPath, 'wt-test', worktreePath, 'feature/test');

    expect(fs.existsSync(worktreePath)).toBe(false);
    expect(execFileCalls.some((c) => c.file === 'gh')).toBe(false);
    expect(execFileCalls.some((c) => c.file === 'git' && c.args[0] === 'push')).toBe(false);
  });

  it('prefers git push --delete for remote branch deletion', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    const worktreePath = path.join(projectPath, 'worktree-to-delete');
    fs.mkdirSync(worktreePath, { recursive: true });

    const service = new WorktreeService();
    await service.removeWorktree(projectPath, 'wt-test', worktreePath, 'origin/feature/test', {
      deleteRemoteBranch: true,
    });

    expect(execFileCalls.some((c) => c.file === 'git' && c.args.includes('push'))).toBe(true);
    expect(execFileCalls.some((c) => c.file === 'gh' && c.args[0] === 'api')).toBe(false);
  });

  it('uses GitHub API fallback when git push fails, and encodes slashes', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    const worktreePath = path.join(projectPath, 'worktree-to-delete');
    fs.mkdirSync(worktreePath, { recursive: true });

    gitPushDeleteError = Object.assign(new Error('permission denied'), {
      stderr: 'permission denied',
    });

    const service = new WorktreeService();
    await service.removeWorktree(projectPath, 'wt-test', worktreePath, 'refs/heads/feature/test', {
      deleteRemoteBranch: true,
    });

    const ghApiCall = execFileCalls.find(
      (c) => c.file === 'gh' && c.args[0] === 'api' && c.args.includes('DELETE')
    );
    expect(ghApiCall).toBeDefined();
    expect(ghApiCall?.args.join(' ')).toContain('heads/feature%2Ftest');
  });

  it('skips remote deletion for the default branch even when requested', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    const worktreePath = path.join(projectPath, 'worktree-to-delete');
    fs.mkdirSync(worktreePath, { recursive: true });

    defaultBranch = 'main';

    const service = new WorktreeService();
    await service.removeWorktree(projectPath, 'wt-test', worktreePath, 'main', {
      deleteRemoteBranch: true,
    });

    expect(execFileCalls.some((c) => c.file === 'gh')).toBe(false);
    expect(execFileCalls.some((c) => c.file === 'git' && c.args[0] === 'push')).toBe(false);
  });

  it('handles git push failure and gh missing without throwing', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    const worktreePath = path.join(projectPath, 'worktree-to-delete');
    fs.mkdirSync(worktreePath, { recursive: true });

    gitPushDeleteError = Object.assign(new Error('permission denied'), {
      stderr: 'permission denied',
    });
    // gh api should fail (simulate missing gh)
    ghApiDeleteError = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });

    const service = new WorktreeService();
    await service.removeWorktree(projectPath, 'wt-test', worktreePath, 'feature/test', {
      deleteRemoteBranch: true,
    });

    expect(execFileCalls.some((c) => c.file === 'git' && c.args.includes('push'))).toBe(true);
  });

  it('treats GitHub 404 as already deleted (when using API fallback)', async () => {
    const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'emdash-project-'));
    const worktreePath = path.join(projectPath, 'worktree-to-delete');
    fs.mkdirSync(worktreePath, { recursive: true });

    ghApiDeleteError = Object.assign(new Error('HTTP 404: Not Found'), { stderr: 'HTTP 404' });
    gitPushDeleteError = Object.assign(new Error('permission denied'), {
      stderr: 'permission denied',
    });

    const service = new WorktreeService();
    await service.removeWorktree(projectPath, 'wt-test', worktreePath, 'feature/test', {
      deleteRemoteBranch: true,
    });

    expect(execFileCalls.some((c) => c.file === 'gh' && c.args[0] === 'api')).toBe(true);
  });
});
