import { describe, expect, it, vi } from 'vitest';
import type { FileSystemProvider } from '@main/core/fs/types';
import type { ExecFn } from '@main/core/utils/exec';
import { cloneRepository, ensurePullRequestBranch, initializeNewProject } from './git-repo-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an ExecFn that records every call and returns pre-baked responses. */
function makeExec(map: Record<string, string> = {}): ExecFn & { calls: string[][] } {
  const calls: string[][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = async (_cmd: string, args: string[] = [], _opts?: any) => {
    calls.push(args);
    const key = args.join(' ');
    if (key in map) {
      return { stdout: map[key], stderr: '' };
    }
    // Default: succeed with empty stdout
    return { stdout: '', stderr: '' };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fn as any).calls = calls;
  return fn as ExecFn & { calls: string[][] };
}

/** Build an ExecFn that fails for a specific key. */
function makeFailingExec(
  failKey: string,
  errorMessage = 'command failed',
  fallbackMap: Record<string, string> = {}
): ExecFn & { calls: string[][] } {
  const calls: string[][] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fn = async (_cmd: string, args: string[] = [], _opts?: any) => {
    calls.push(args);
    const key = args.join(' ');
    if (key === failKey) {
      throw new Error(errorMessage);
    }
    if (key in fallbackMap) {
      return { stdout: fallbackMap[key], stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (fn as any).calls = calls;
  return fn as ExecFn & { calls: string[][] };
}

/** Build an ExecFn that fails for any key in a set. */
function makeExecWithFailKeys(
  failKeys: Set<string>,
  errorMessage = 'command failed'
): ExecFn & { calls: string[][] } {
  const calls: string[][] = [];
  const fn = async (_cmd: string, args: string[] = []) => {
    calls.push(args);
    const key = args.join(' ');
    if (failKeys.has(key)) {
      throw new Error(errorMessage);
    }
    return { stdout: '', stderr: '' };
  };
  return Object.assign(fn, { calls }) as ExecFn & { calls: string[][] };
}

function makeStubFs(overrides: Partial<FileSystemProvider> = {}): FileSystemProvider {
  return {
    list: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
    read: vi.fn().mockResolvedValue({ content: '', truncated: false, totalSize: 0 }),
    write: vi.fn().mockResolvedValue({ success: true, bytesWritten: 0 }),
    exists: vi.fn().mockResolvedValue(true),
    stat: vi.fn().mockResolvedValue(null),
    search: vi.fn().mockResolvedValue({ matches: [], total: 0 }),
    remove: vi.fn().mockResolvedValue({ success: true }),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// cloneRepository
// ---------------------------------------------------------------------------

describe('cloneRepository', () => {
  it('creates parent directory and runs git clone', async () => {
    const exec = makeExec();
    const fs = makeStubFs();

    const result = await cloneRepository(
      'https://github.com/org/repo.git',
      '/projects/repo',
      exec,
      fs
    );

    expect(result).toEqual({ success: true });
    expect(fs.mkdir).toHaveBeenCalledWith('/projects', { recursive: true });
    expect(exec.calls).toEqual([['clone', 'https://github.com/org/repo.git', '/projects/repo']]);
  });

  it('returns error on clone failure', async () => {
    const exec = makeFailingExec(
      'clone https://github.com/org/repo.git /projects/repo',
      'fatal: repository not found'
    );
    const fs = makeStubFs();

    const result = await cloneRepository(
      'https://github.com/org/repo.git',
      '/projects/repo',
      exec,
      fs
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('repository not found');
  });

  it('returns error when mkdir fails', async () => {
    const exec = makeExec();
    const fs = makeStubFs({
      mkdir: vi.fn().mockRejectedValue(new Error('permission denied')),
    });

    const result = await cloneRepository(
      'https://github.com/org/repo.git',
      '/projects/repo',
      exec,
      fs
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('permission denied');
  });

  it('handles deeply nested local path', async () => {
    const exec = makeExec();
    const fs = makeStubFs();

    await cloneRepository('git@github.com:org/repo.git', '/a/b/c/d/repo', exec, fs);

    expect(fs.mkdir).toHaveBeenCalledWith('/a/b/c/d', { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// initializeNewProject
// ---------------------------------------------------------------------------

describe('initializeNewProject', () => {
  it('writes README, stages, commits, and pushes to main', async () => {
    const exec = makeExec();
    const fs = makeStubFs();

    await initializeNewProject(
      {
        repoUrl: 'https://github.com/org/repo.git',
        localPath: '/projects/repo',
        name: 'My Project',
        description: 'A cool project',
      },
      exec,
      fs
    );

    // README written with description
    expect(fs.write).toHaveBeenCalledWith('README.md', '# My Project\n\nA cool project\n');

    // Correct git commands in order
    expect(exec.calls).toEqual([
      ['add', 'README.md'],
      ['commit', '-m', 'Initial commit'],
      ['push', '-u', 'origin', 'main'],
    ]);
  });

  it('writes README without description when not provided', async () => {
    const exec = makeExec();
    const fs = makeStubFs();

    await initializeNewProject(
      {
        repoUrl: 'https://github.com/org/repo.git',
        localPath: '/projects/repo',
        name: 'Bare Project',
      },
      exec,
      fs
    );

    expect(fs.write).toHaveBeenCalledWith('README.md', '# Bare Project\n');
  });

  it('falls back to master when push to main fails', async () => {
    const exec = makeFailingExec('push -u origin main');
    const fs = makeStubFs();

    await initializeNewProject(
      {
        repoUrl: 'https://github.com/org/repo.git',
        localPath: '/projects/repo',
        name: 'Project',
      },
      exec,
      fs
    );

    // Should have tried main first, then master
    expect(exec.calls).toEqual([
      ['add', 'README.md'],
      ['commit', '-m', 'Initial commit'],
      ['push', '-u', 'origin', 'main'],
      ['push', '-u', 'origin', 'master'],
    ]);
  });

  it('throws when both main and master push fail', async () => {
    const failKeys = new Set(['push -u origin main', 'push -u origin master']);
    const exec = makeExecWithFailKeys(failKeys, 'push failed');

    const fs = makeStubFs();

    await expect(
      initializeNewProject(
        {
          repoUrl: 'https://github.com/org/repo.git',
          localPath: '/projects/repo',
          name: 'Project',
        },
        exec,
        fs
      )
    ).rejects.toThrow('Failed to push to remote repository');
  });

  it('passes cwd option to all git commands', async () => {
    const execOpts: Array<{ args: string[]; opts: { cwd?: string } | undefined }> = [];
    const exec: ExecFn = async (_cmd, args = [], opts) => {
      execOpts.push({ args: [...args], opts });
      return { stdout: '', stderr: '' };
    };
    const fs = makeStubFs();

    await initializeNewProject(
      {
        repoUrl: 'https://github.com/org/repo.git',
        localPath: '/my/project',
        name: 'Test',
      },
      exec,
      fs
    );

    for (const entry of execOpts) {
      expect(entry.opts).toEqual({ cwd: '/my/project' });
    }
  });
});

// ---------------------------------------------------------------------------
// ensurePullRequestBranch
// ---------------------------------------------------------------------------

describe('ensurePullRequestBranch', () => {
  it('fetches PR ref into a named branch', async () => {
    const exec = makeExec();

    const result = await ensurePullRequestBranch('/projects/repo', 42, 'feature-branch', exec);

    expect(result).toBe('feature-branch');
    expect(exec.calls).toEqual([
      ['fetch', 'origin', 'refs/pull/42/head:refs/heads/feature-branch', '--force'],
    ]);
  });

  it('uses pr/{number} as branch name when branchName is empty', async () => {
    const exec = makeExec();

    const result = await ensurePullRequestBranch('/projects/repo', 99, '', exec);

    expect(result).toBe('pr/99');
    expect(exec.calls[0]).toContain('refs/pull/99/head:refs/heads/pr/99');
  });

  it('passes cwd to exec', async () => {
    let capturedOpts: { cwd?: string; timeout?: number; maxBuffer?: number } | undefined;
    const exec: ExecFn = async (_cmd, _args = [], opts) => {
      capturedOpts = opts;
      return { stdout: '', stderr: '' };
    };

    await ensurePullRequestBranch('/my/repo', 1, 'branch', exec);

    expect(capturedOpts).toEqual({ cwd: '/my/repo' });
  });

  it('throws when git fetch fails (no fallback)', async () => {
    const exec = makeFailingExec(
      'fetch origin refs/pull/5/head:refs/heads/pr-branch --force',
      'fatal: could not read from remote'
    );

    await expect(ensurePullRequestBranch('/projects/repo', 5, 'pr-branch', exec)).rejects.toThrow(
      'could not read from remote'
    );
  });
});
