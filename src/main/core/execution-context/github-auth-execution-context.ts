import path from 'node:path';
import { buildGitHubAuthEnv } from '@main/core/utils/exec';
import type { ExecOptions, ExecResult, IExecutionContext } from './types';

export class GitHubAuthExecutionContext implements IExecutionContext {
  readonly root: string | undefined;
  readonly supportsLocalSpawn: boolean;

  constructor(
    private readonly inner: IExecutionContext,
    private readonly getToken: () => Promise<string | null>
  ) {
    this.root = inner.root;
    this.supportsLocalSpawn = inner.supportsLocalSpawn;
  }

  async exec(command: string, args: string[] = [], opts?: ExecOptions): Promise<ExecResult> {
    if (path.basename(command) === 'git') {
      const { args: nextArgs, env } = await buildGitHubAuthEnv(args, this.getToken);
      const mergedEnv = Object.keys(env).length > 0 ? { ...(opts?.env ?? {}), ...env } : opts?.env;
      return this.inner.exec(command, nextArgs, { ...opts, env: mergedEnv });
    }
    return this.inner.exec(command, args, opts);
  }

  execStreaming(
    command: string,
    args: string[],
    onChunk: (chunk: string) => boolean,
    opts?: { signal?: AbortSignal }
  ): Promise<void> {
    return this.inner.execStreaming(command, args, onChunk, opts);
  }

  dispose(): void {
    this.inner.dispose();
  }
}
