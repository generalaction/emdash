import { buildGitHubAuthEnv, isNetworkGitCommand } from './github-auth-git-env';
import type { ExecOptions, ExecResult, IExecutionContext } from './types';

/** Resolved GitHub credential for git transport. */
export type GitHubGitAuth = { host: string; token: string };

/**
 * Resolves the credential to use for a git network operation, or null when
 * there is no usable linked account (callers then fall back to the ambient
 * git credential helper). Invoked per network operation so the token is always
 * current and account/project changes take effect without recreating the ctx.
 */
export type GitHubGitAuthResolver = () => Promise<GitHubGitAuth | null>;

/**
 * Wraps an execution context so git network operations (fetch/push/clone/
 * ls-remote) authenticate with a specific GitHub account's token via a
 * per-invocation, host-scoped `http.extraheader`, instead of relying on the
 * machine's ambient credential helper (which serves whichever `gh` account is
 * currently active).
 *
 * Everything else — non-git commands, local git commands, streaming — passes
 * through untouched. When the resolver returns null the call is a plain
 * passthrough, preserving the previous ambient-credential behavior. This makes
 * the wrapper strictly additive: it can only add auth where there was none.
 */
export class GitHubAuthExecutionContext implements IExecutionContext {
  constructor(
    private readonly base: IExecutionContext,
    private readonly resolveAuth: GitHubGitAuthResolver
  ) {}

  get root(): string | undefined {
    return this.base.root;
  }

  get supportsLocalSpawn(): boolean {
    return this.base.supportsLocalSpawn;
  }

  private async gitAuthEnv(
    command: string,
    args: string[]
  ): Promise<Record<string, string> | undefined> {
    if (!isNetworkGitCommand(command, args)) return undefined;
    const auth = await this.resolveAuth();
    if (!auth) return undefined;
    return buildGitHubAuthEnv(auth.host, auth.token);
  }

  async exec(command: string, args: string[] = [], opts: ExecOptions = {}): Promise<ExecResult> {
    const authEnv = await this.gitAuthEnv(command, args);
    if (!authEnv) return this.base.exec(command, args, opts);
    return this.base.exec(command, args, { ...opts, env: { ...opts.env, ...authEnv } });
  }

  execStreaming(
    command: string,
    args: string[],
    onChunk: (chunk: string) => boolean,
    opts: { signal?: AbortSignal } = {}
  ): Promise<void> {
    // Streaming git operations are not network-authenticated in this iteration:
    // workspace setup fetch/push (the flows this targets) go through exec().
    // Streamed network ops (if any are added) are a documented follow-up.
    return this.base.execStreaming(command, args, onChunk, opts);
  }

  async refreshShellEnv(): Promise<void> {
    await this.base.refreshShellEnv?.();
  }

  dispose(): void {
    this.base.dispose();
  }
}
