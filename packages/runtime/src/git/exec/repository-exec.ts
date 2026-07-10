import type { BoundExec, ExecBufferResult, ExecOptions, ExecResult } from '@emdash/core/exec';

/** Binds Git commands to shared repository metadata without borrowing a checkout cwd or HEAD. */
export function bindRepositoryExec(base: BoundExec, gitCommonDir: string): BoundExec {
  const prefix = [`--git-dir=${gitCommonDir}`];
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
    withCwd(cwd: string): BoundExec {
      return bindRepositoryExec(base.withCwd(cwd), gitCommonDir);
    },
  };
}
