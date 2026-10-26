import type { EnvSource } from '#primitives/exec/api';
import {
  createBoundExec,
  type BoundExec,
  type ExecBufferResult,
  type ExecOptions,
  type ExecResult,
  type ExecSpawnOptions,
} from '#services/exec/api';
import { nonInteractiveGitEnv } from '#services/exec/node/git-exec';

export type CreateGitExecOptions = {
  cwd: string;
  executable?: string;
  env: NodeJS.ProcessEnv | EnvSource;
};

export function createGitExec(options: CreateGitExecOptions): BoundExec {
  const source = options.env;
  const env =
    typeof source === 'function'
      ? async () => nonInteractiveGitEnv(await source())
      : nonInteractiveGitEnv(source);
  return createBoundExec({
    file: options.executable ?? 'git',
    cwd: options.cwd,
    env,
  });
}

/** Targets every command at one Git directory, independently of the executor's cwd. */
export function bindGitDir(base: BoundExec, gitDir: string): BoundExec {
  const prefix = [`--git-dir=${gitDir}`];
  return {
    file: base.file,
    cwd: base.cwd,
    env: base.env,
    exec(args: string[], options?: ExecOptions): Promise<ExecResult> {
      return base.exec([...prefix, ...args], options);
    },
    execStreaming(
      args: string[],
      onStdout: (chunk: string) => boolean | void,
      options?: ExecOptions
    ): Promise<void> {
      return base.execStreaming([...prefix, ...args], onStdout, options);
    },
    execBuffer(args: string[], options?: ExecOptions): Promise<ExecBufferResult> {
      return base.execBuffer([...prefix, ...args], options);
    },
    spawn(args: string[], options?: ExecSpawnOptions) {
      return base.spawn([...prefix, ...args], options);
    },
    withCwd(cwd: string): BoundExec {
      return bindGitDir(base.withCwd(cwd), gitDir);
    },
  };
}
