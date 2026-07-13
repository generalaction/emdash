import { describe, expect, it, vi } from 'vitest';
import {
  GitHubAuthExecutionContext,
  type GitHubGitAuth,
} from './github-auth-execution-context';
import type { ExecOptions, ExecResult, IExecutionContext } from './types';

function fakeBase() {
  const exec = vi.fn(
    async (_command: string, _args: string[] = [], _opts: ExecOptions = {}): Promise<ExecResult> => ({
      stdout: '',
      stderr: '',
    })
  );
  const execStreaming = vi.fn(async () => {});
  const dispose = vi.fn();
  const base: IExecutionContext = {
    root: '/repo',
    supportsLocalSpawn: true,
    exec,
    execStreaming,
    dispose,
  };
  return { base, exec, execStreaming, dispose };
}

const AUTH: GitHubGitAuth = { host: 'github.com', token: 'tok' };

describe('GitHubAuthExecutionContext', () => {
  it('injects host-scoped auth env for git network operations', async () => {
    const { base, exec } = fakeBase();
    const ctx = new GitHubAuthExecutionContext(base, async () => AUTH);

    await ctx.exec('git', ['fetch', 'origin']);

    const opts = exec.mock.calls[0][2] as ExecOptions;
    expect(opts.env?.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader');
    expect(opts.env?.GIT_CONFIG_VALUE_0).toContain('Authorization: Basic ');
  });

  it('does not inject for local git operations', async () => {
    const { base, exec } = fakeBase();
    const ctx = new GitHubAuthExecutionContext(base, async () => AUTH);

    await ctx.exec('git', ['worktree', 'list']);

    const opts = (exec.mock.calls[0][2] ?? {}) as ExecOptions;
    expect(opts.env).toBeUndefined();
  });

  it('does not inject for non-git commands', async () => {
    const { base, exec } = fakeBase();
    const ctx = new GitHubAuthExecutionContext(base, async () => AUTH);

    await ctx.exec('gh', ['api', 'user']);

    const opts = (exec.mock.calls[0][2] ?? {}) as ExecOptions;
    expect(opts.env).toBeUndefined();
  });

  it('falls back to ambient credentials when no account is linked', async () => {
    const { base, exec } = fakeBase();
    const resolver = vi.fn(async () => null);
    const ctx = new GitHubAuthExecutionContext(base, resolver);

    await ctx.exec('git', ['fetch', 'origin']);

    expect(resolver).toHaveBeenCalledOnce();
    const opts = (exec.mock.calls[0][2] ?? {}) as ExecOptions;
    expect(opts.env).toBeUndefined();
  });

  it('preserves caller-provided env alongside injected auth env', async () => {
    const { base, exec } = fakeBase();
    const ctx = new GitHubAuthExecutionContext(base, async () => AUTH);

    await ctx.exec('git', ['fetch', 'origin'], { env: { FOO: 'bar' } });

    const opts = exec.mock.calls[0][2] as ExecOptions;
    expect(opts.env?.FOO).toBe('bar');
    expect(opts.env?.GIT_CONFIG_COUNT).toBe('1');
  });

  it('delegates root, supportsLocalSpawn and dispose to the base context', () => {
    const { base, dispose } = fakeBase();
    const ctx = new GitHubAuthExecutionContext(base, async () => AUTH);

    expect(ctx.root).toBe('/repo');
    expect(ctx.supportsLocalSpawn).toBe(true);
    ctx.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });
});
